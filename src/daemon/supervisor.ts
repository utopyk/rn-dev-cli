// Session supervisor. Owns the transition ladder
// stopped → starting → running → stopping → stopped and fans session
// events out to events/subscribe consumers via an EventEmitter.
//
// Named `DaemonSupervisor` to avoid colliding with the unrelated
// `Supervisor` in src/core/module-host/supervisor.ts (module-host
// crash-loop detector).
//
// The state machine lives in-process; cross-daemon coordination is
// outside scope — one daemon per worktree.

import path from "node:path";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { IpcServer } from "../core/ipc.js";
import { ArtifactStore } from "../core/artifact.js";
import { ModuleRegistry } from "../modules/registry.js";
import type { Profile } from "../core/types.js";
import {
  INITIAL_SESSION_STATE,
  type SessionState,
  type SessionStatus,
  type SessionEvent,
  type ServicesSnapshot,
} from "./session.js";
import type {
  BootSessionServicesOptions,
  SessionServices,
} from "../core/session/boot.js";

export type SessionBootFn = (
  opts: BootSessionServicesOptions,
) => Promise<SessionServices>;

export interface DaemonSupervisorOptions {
  /** Absolute path to the worktree. */
  worktree: string;
  /** Pre-started IpcServer — shared with the daemon's RPC dispatch. */
  ipc: IpcServer;
  /** Pluggable boot function. Production uses `bootSessionServices`; tests inject a fake. */
  bootFn: SessionBootFn;
}

export interface StartSessionOptions {
  profile: Profile;
}

export type StartSessionResult =
  | { kind: "ok"; status: "starting" }
  | { kind: "error"; code: string; message: string };

export type StopSessionResult =
  | { kind: "ok"; status: "stopping" | "stopped" }
  | { kind: "error"; code: string; message: string };

type WiredServices = {
  services: SessionServices;
  detach: () => void;
};

/**
 * Emits:
 *   - "event"         (SessionEvent)  — forwarded to events/subscribe streams.
 *   - "state-changed" (SessionState)  — transition edges. Also forwarded as
 *                                        a `session/status` event.
 */
export class DaemonSupervisor extends EventEmitter {
  private readonly worktree: string;
  private readonly ipc: IpcServer;
  private readonly bootFn: SessionBootFn;
  private state: SessionState = INITIAL_SESSION_STATE;
  /** Populated while the session is running; null in stopped/starting. */
  private wired: WiredServices | null = null;
  /** Snapshot profile from session/start. Mid-session edits are ignored. */
  private activeProfile: Profile | null = null;

  constructor(opts: DaemonSupervisorOptions) {
    super();
    this.worktree = opts.worktree;
    this.ipc = opts.ipc;
    this.bootFn = opts.bootFn;
  }

  getState(): SessionState {
    return this.state;
  }

  async start(opts: StartSessionOptions): Promise<StartSessionResult> {
    if (this.state.status !== "stopped") {
      return {
        kind: "error",
        code: "E_SESSION_ALREADY_RUNNING",
        message: `session is ${this.state.status}; stop it before starting a new one`,
      };
    }

    this.activeProfile = opts.profile;
    this.transition("starting");

    // Kick off the boot asynchronously — the RPC response is "starting"
    // so the client can subscribe to events for the running transition.
    void this.bootAsync(opts.profile).catch((err) => {
      this.emitSessionEvent({
        kind: "session/log",
        worktreeKey: this.worktreeKey(),
        data: {
          level: "error",
          message: `bootSessionServices failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      });
      // Roll back to stopped; the supervisor doesn't auto-retry.
      this.activeProfile = null;
      this.transition("stopped");
    });

    return { kind: "ok", status: "starting" };
  }

  async stop(): Promise<StopSessionResult> {
    if (this.state.status === "stopped") {
      return { kind: "ok", status: "stopped" };
    }
    if (this.state.status === "stopping") {
      return { kind: "ok", status: "stopping" };
    }
    if (this.state.status === "starting") {
      // Rare — caller hit stop before boot finished. Fall through to
      // teardown; if `wired` isn't populated yet, there's nothing to
      // dispose beyond the profile reset.
    }

    this.transition("stopping");
    const wired = this.wired;
    this.wired = null;
    this.activeProfile = null;

    if (wired) {
      // Dispose first so teardown-time emits (metro stopped, module
      // crashed-on-exit, etc.) propagate to events/subscribe listeners
      // who need them. Detach only after the last event fires, otherwise
      // the "stopped" edge of the session arrives at the client as
      // silence.
      try {
        await wired.services.dispose();
      } catch {
        /* best-effort — teardown errors are non-fatal */
      }
      wired.detach();
    }

    this.transition("stopped");
    return { kind: "ok", status: "stopped" };
  }

  /** Attach a listener for events/subscribe fan-out. Returns detach fn. */
  onEvent(listener: (evt: SessionEvent) => void): () => void {
    this.on("event", listener);
    return () => {
      this.off("event", listener);
    };
  }

  private async bootAsync(profile: Profile): Promise<void> {
    const artifactStore = new ArtifactStore(
      path.join(this.worktree, ".rn-dev", "artifacts"),
    );
    const moduleRegistry = new ModuleRegistry();
    const emit = (line: string): void => {
      this.emitSessionEvent({
        kind: "session/log",
        worktreeKey: this.worktreeKey(),
        data: { level: "info", message: line },
      });
    };
    const hostVersion = readHostVersion();

    const services = await this.bootFn({
      profile,
      projectRoot: this.worktree,
      artifactStore,
      moduleRegistry,
      emit,
      hostVersion,
      ipc: this.ipc,
    });

    // If stop() ran while we were booting, throw away what we built.
    // Cast needed because `this.state.status` has narrowed from the
    // original "starting" guard but the supervisor is concurrent.
    if ((this.state.status as SessionStatus) !== "starting") {
      try {
        await services.dispose();
      } catch {
        /* ignore */
      }
      return;
    }

    const detach = this.wireServiceEvents(services);
    this.wired = { services, detach };
    this.state = {
      status: "running",
      services: this.snapshotServices(services),
    };
    this.emitStateChanged();
  }

  private wireServiceEvents(services: SessionServices): () => void {
    const worktreeKey = services.worktreeKey;
    const onMetroStatus = (evt: { worktreeKey: string; status: string }): void => {
      this.emitSessionEvent({
        kind: "metro/status",
        worktreeKey,
        data: { status: evt.status },
      });
    };
    const onMetroLog = (evt: {
      worktreeKey: string;
      line: string;
      stream: "stdout" | "stderr";
    }): void => {
      this.emitSessionEvent({
        kind: "metro/log",
        worktreeKey,
        data: { line: evt.line, stream: evt.stream },
      });
    };
    const onDevtoolsStatus = (payload: unknown): void => {
      this.emitSessionEvent({
        kind: "devtools/status",
        worktreeKey,
        data: { payload },
      });
    };
    const onModuleStateChanged = (p: {
      moduleId: string;
      scopeUnit: string;
      from: string;
      to: string;
    }): void => {
      this.emitSessionEvent({
        kind: "modules/state-changed",
        worktreeKey,
        data: p,
      });
    };
    const onModuleCrashed = (p: {
      moduleId: string;
      scopeUnit: string;
      reason: string;
    }): void => {
      this.emitSessionEvent({
        kind: "modules/crashed",
        worktreeKey,
        data: p,
      });
    };
    const onModuleFailed = (p: {
      moduleId: string;
      scopeUnit: string;
      reason: string;
    }): void => {
      this.emitSessionEvent({
        kind: "modules/failed",
        worktreeKey,
        data: p,
      });
    };

    services.metro.on("status", onMetroStatus);
    services.metro.on("log", onMetroLog);
    services.devtools.on("status", onDevtoolsStatus);
    services.moduleHost.on("state-changed", onModuleStateChanged);
    services.moduleHost.on("crashed", onModuleCrashed);
    services.moduleHost.on("failed", onModuleFailed);

    return () => {
      services.metro.off("status", onMetroStatus);
      services.metro.off("log", onMetroLog);
      services.devtools.off("status", onDevtoolsStatus);
      services.moduleHost.off("state-changed", onModuleStateChanged);
      services.moduleHost.off("crashed", onModuleCrashed);
      services.moduleHost.off("failed", onModuleFailed);
    };
  }

  private snapshotServices(services: SessionServices): ServicesSnapshot {
    // Phase 13.2 — minimum viable snapshot. Phase 13.3+ can deepen this
    // by asking each service for its live status (metro.isRunning() etc).
    return {
      metro: { status: "starting" },
      devtools: { status: "unknown" },
      modules: { count: services.moduleRegistry.getAllManifests().length },
    };
  }

  private transition(next: SessionStatus): void {
    if (this.state.status === next) return;
    this.state = {
      status: next,
      services: next === "running" ? this.state.services : null,
    };
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    this.emit("state-changed", this.state);
    this.emitSessionEvent({
      kind: "session/status",
      worktreeKey: this.worktreeKey(),
      data: { status: this.state.status },
    });
  }

  private emitSessionEvent(evt: SessionEvent): void {
    this.emit("event", evt);
  }

  private worktreeKey(): string {
    // Before boot we don't have the ArtifactStore-hashed key yet. Fall
    // back to the worktree path so lifecycle events still carry a
    // stable id; downstream subscribers can ignore it until boot
    // stamps the real key.
    return this.wired?.services.worktreeKey ?? this.worktree;
  }
}

function readHostVersion(): string {
  try {
    // Daemon process.cwd() is the worktree at runDaemon time, so resolve
    // package.json relative to this file's module. For now, trust
    // process.cwd()'s package.json; if absent, fall back to the tree
    // the daemon is running against.
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
