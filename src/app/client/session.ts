// Client-side session orchestrator. One call from the TUI/Electron:
//   `await connectToDaemonSession(projectRoot, profile)`
// returns a live `DaemonSession` where every adapter already has its
// IpcClient reference, a shared event subscription is open, and events
// are routed to the matching adapter as they arrive.
//
// Lifecycle:
//   - `connectToDaemon` ensures a daemon is running at
//     <projectRoot>/.rn-dev/sock (auto-spawns if not).
//   - `events/subscribe` opens a single long-lived socket; every
//     adapter observes events through it.
//   - `session/start { profile }` kicks the daemon's supervisor.
//   - Callers await the "running" transition before treating the
//     session as usable — the daemon returns `starting` immediately.
//   - `stop()` issues `session/stop` then closes the subscription.
//   - `disconnect()` closes the subscription WITHOUT asking the daemon
//     to teardown. Electron's window-close goes through this; a
//     second client (MCP, another GUI instance) keeps the session
//     alive. Phase 13.4 prereq #1.
//
// The adapters are shaped for React (EventEmitter + async methods) but
// bear no direct dependency on React; MCP + Electron clients in 13.4
// / 13.5 reuse the same set.

import {
  connectToDaemon,
  type ConnectToDaemonOptions,
} from "../../daemon/spawn.js";
import type { IpcClient, IpcMessage } from "../../core/ipc.js";
import type { Profile } from "../../core/types.js";
import { MetroClient } from "./metro-adapter.js";
import { DevToolsClient } from "./devtools-adapter.js";
import { BuilderClient } from "./builder-adapter.js";
import { WatcherClient } from "./watcher-adapter.js";
import { ModuleHostClient } from "./module-host-adapter.js";

export interface DaemonSession {
  client: IpcClient;
  metro: MetroClient;
  devtools: DevToolsClient;
  builder: BuilderClient;
  watcher: WatcherClient;
  /**
   * Surfaces `modules/*` events (state-changed / crashed / failed)
   * from the daemon. Phase 13.4 prereq #3 added this adapter so
   * Electron's renderer-forwarding wiring has a stable source; the
   * TUI does not consume it but the field is present for uniformity
   * across clients.
   */
  modules: ModuleHostClient;
  worktreeKey: string;
  /**
   * Closes the event subscription + client without asking the daemon
   * to tear down the session. The daemon keeps the services alive for
   * any other connected client (another TUI, MCP, Electron renderer).
   * Idempotent — safe to call after the daemon already died.
   *
   * Note: `disconnect()` does NOT decrement the daemon's session
   * refcount on the wire. The daemon's socket-close auto-release
   * eventually catches up, but a graceful client should prefer
   * `release()` so the daemon's audit log captures the intent.
   */
  disconnect: () => void;
  /**
   * Phase 13.5 — graceful ref-counted detach. Sends `session/release`
   * to the daemon, then closes the subscription. Last client to release
   * triggers the daemon's `stop()` automatically; earlier releasers
   * leave the session running for the others. This is the right choice
   * for shared-daemon clients (Electron, MCP, second TUI).
   *
   * Idempotent — safe to call multiple times; the daemon's release is
   * idempotent on unknown connection ids.
   */
  release: () => Promise<void>;
  /**
   * Graceful session teardown: sends `session/stop` so the supervisor
   * drives its `running → stopping → stopped` transitions, then closes
   * the subscription. This is the kill-for-everyone variant — every
   * other connected client's services go down too. Used by the CLI
   * path where the user quitting the TUI legitimately means "return
   * the daemon to idle". For shared-daemon clients (Electron, MCP)
   * prefer `release()`.
   */
  stop: () => Promise<void>;
}

export interface ConnectToDaemonSessionOptions extends ConnectToDaemonOptions {
  /** Upper bound for waiting on the session to transition to "running". */
  sessionReadyTimeoutMs?: number;
}

export async function connectToDaemonSession(
  projectRoot: string,
  profile: Profile,
  opts: ConnectToDaemonSessionOptions = {},
): Promise<DaemonSession> {
  const { sessionReadyTimeoutMs = 30_000, ...connectOpts } = opts;

  const client = await connectToDaemon(projectRoot, connectOpts);
  const idGen = makeIdGenerator();
  const metro = new MetroClient(client, idGen);
  const devtools = new DevToolsClient(client, idGen);
  const builder = new BuilderClient(client, idGen);
  const watcher = new WatcherClient(client, idGen);
  const modules = new ModuleHostClient(client, idGen);

  let worktreeKey: string | null = null;
  let runningSettled = false;
  let resolveRunningRaw!: () => void;
  let rejectRunningRaw!: (err: Error) => void;
  const runningPromise = new Promise<void>((res, rej) => {
    resolveRunningRaw = res;
    rejectRunningRaw = rej;
  });
  // If connectToDaemonSession throws BEFORE reaching `await runningPromise`
  // (e.g. subscribe rejected), the rejection emitted on disconnect can
  // surface as an unhandled rejection because no consumer ever awaits.
  // Attach a no-op catch eagerly so the rejection is silenced; callers
  // that DO reach `await runningPromise` still get the rejection because
  // the catch handler is detached after the original branch consumes
  // the promise (the `await` chain has its own handler).
  runningPromise.catch(() => {
    /* swallow late rejections — see comment above */
  });
  // Single-shot wrappers — calling resolve/reject after the promise
  // settled is a no-op as far as the Promise machinery is concerned,
  // but every late call still allocates an Error and emits an
  // unhandled-rejection warning if no .catch is attached. The
  // wrappers swallow the late call before it produces noise.
  const resolveRunning = (): void => {
    if (runningSettled) return;
    runningSettled = true;
    resolveRunningRaw();
  };
  const rejectRunning = (err: Error): void => {
    if (runningSettled) return;
    runningSettled = true;
    rejectRunningRaw(err);
  };

  // Track whether the caller has asked us to close. A voluntary close
  // must not trigger the "daemon died" path — that's reserved for an
  // unexpected socket drop (daemon crashed, SIGKILLed, host lost).
  let voluntaryClose = false;
  let closed = false;

  const notifyDisconnected = (err?: Error): void => {
    if (closed) return;
    closed = true;
    if (voluntaryClose) return;
    // Unblock any caller still awaiting the running transition —
    // otherwise a daemon death mid-boot hangs `connectToDaemonSession`
    // for the full sessionReadyTimeoutMs.
    rejectRunning(
      err ?? new Error("connectToDaemonSession: daemon disconnected during boot"),
    );
    metro.notifyDisconnected(err);
    devtools.notifyDisconnected(err);
    builder.notifyDisconnected(err);
    watcher.notifyDisconnected(err);
    modules.notifyDisconnected(err);
  };

  const onIncomingEvent = (msg: IpcMessage): void => {
    const evt = parseSessionEventEnvelope(msg.payload);
    if (!evt) return;
    if (!worktreeKey) worktreeKey = evt.worktreeKey;
    // Pre-running session/status edges drive the runningPromise:
    //   starting → running   → resolve
    //   starting → stopped   → reject  (bootSessionServices failed)
    //   starting → stopping  → reject  (stop raced the boot)
    // Without this the caller waits the full sessionReadyTimeoutMs to
    // discover a failed boot — Kieran P0-1 on PR #17.
    if (evt.kind === "session/status") {
      const status = readStatus(evt.data);
      if (status === "running") {
        resolveRunning();
      } else if (status === "stopped" || status === "stopping") {
        rejectRunning(
          new Error(
            `connectToDaemonSession: session transitioned to "${status}" before reaching "running"`,
          ),
        );
      }
    }
    routeEventToAdapters(evt.kind, evt.data, {
      metro,
      devtools,
      builder,
      watcher,
      modules,
    });
  };

  // Phase 13.5 — refcount lives on the events/subscribe socket. The
  // profile travels in the subscribe payload so the daemon can boot
  // (or join) the session in a single round-trip. The subscribe
  // response includes `connectionId` so we can later send an explicit
  // `session/release` over a separate short-lived conn (the audit-
  // log "intent capture" path).
  //
  // `onClose` / `onError` route into `notifyDisconnected` so an
  // unexpected daemon death surfaces as a 'disconnected' event on
  // every adapter (Phase 13.4 prereq #1).
  const sub = await client.subscribe(
    {
      type: "command",
      action: "events/subscribe",
      id: idGen(),
      payload: { profile },
    },
    {
      onEvent: onIncomingEvent,
      onClose: () => notifyDisconnected(),
      onError: (err) => notifyDisconnected(err),
    },
  );

  // The subscribe response either confirms (`subscribed: true` +
  // attach metadata) or rejects (profile-mismatch, no-session-to-
  // subscribe, etc.). Translate rejection into a thrown error here
  // before the caller starts using adapters.
  const subPayload = sub.initial.payload as {
    subscribed?: boolean;
    connectionId?: string;
    status?: string;
    started?: boolean;
    code?: string;
    message?: string;
  };
  if (!subPayload.subscribed) {
    sub.close();
    throw new Error(
      `connectToDaemonSession: events/subscribe rejected (${subPayload.code ?? "unknown"}): ${subPayload.message ?? ""}`,
    );
  }
  const subscribeConnectionId = subPayload.connectionId ?? null;

  const readyTimer = setTimeout(() => {
    rejectRunning(
      new Error(
        `connectToDaemonSession: session did not reach "running" within ${sessionReadyTimeoutMs}ms`,
      ),
    );
  }, sessionReadyTimeoutMs);

  // Phase 13.5 — joiner short-circuit. If the daemon reports an
  // already-running session in the subscribe response, the running
  // edge we'd otherwise wait for already fired before we subscribed.
  // Resolve runningPromise immediately and backfill the worktreeKey
  // via session/status (no edge will recur to fill it).
  if (subPayload.status === "running" && subPayload.started === false) {
    if (!worktreeKey) {
      try {
        const statusResp = await client.send({
          type: "command",
          action: "session/status",
          id: idGen(),
        });
        const sp = statusResp.payload as { worktreeKey?: string } | undefined;
        if (sp && typeof sp.worktreeKey === "string") {
          worktreeKey = sp.worktreeKey;
        }
      } catch {
        // Backfill is best-effort — the next event will populate it.
      }
    }
    resolveRunning();
  }

  try {
    await runningPromise;
  } catch (err) {
    clearTimeout(readyTimer);
    sub.close();
    throw err;
  }
  clearTimeout(readyTimer);

  if (!worktreeKey) {
    sub.close();
    throw new Error(
      "connectToDaemonSession: session became running without emitting a worktreeKey",
    );
  }

  const disconnect = (): void => {
    if (closed) return;
    closed = true;
    voluntaryClose = true;
    sub.close();
  };

  const release = async (): Promise<void> => {
    // Phase 13.5 — explicit ref-counted detach. We send `session/release
    // { connectionId }` over a short-lived send conn so the daemon's
    // audit log captures the intent, then close the subscribe socket.
    // The daemon's subscribe-close auto-release is the safety net if
    // the explicit release fails or the connectionId wasn't captured.
    if (closed) return;
    if (subscribeConnectionId) {
      try {
        await client.send({
          type: "command",
          action: "session/release",
          id: idGen(),
          payload: { connectionId: subscribeConnectionId },
        });
      } catch {
        // Daemon may have died between attach and release. The local
        // close still happens via `disconnect()` below; we don't
        // surface the error since the caller's intent is already
        // satisfied by the daemon being gone.
      }
    }
    disconnect();
  };

  const stop = async (): Promise<void> => {
    try {
      await client.send({
        type: "command",
        action: "session/stop",
        id: idGen(),
      });
    } finally {
      disconnect();
    }
  };

  return {
    client,
    metro,
    devtools,
    builder,
    watcher,
    modules,
    worktreeKey,
    disconnect,
    release,
    stop,
  };
}

/**
 * Runtime guard for the event envelopes the daemon pushes over
 * `events/subscribe`. Every variant of SessionEvent carries a string
 * `kind`, a string `worktreeKey`, and a `data` field. Anything else
 * is discarded rather than silently narrowed downstream (Kieran P1-3
 * on PR #17).
 */
function parseSessionEventEnvelope(
  payload: unknown,
): { kind: string; worktreeKey: string; data: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.kind !== "string" || typeof p.worktreeKey !== "string") {
    return null;
  }
  return { kind: p.kind, worktreeKey: p.worktreeKey, data: p.data };
}

function readStatus(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const v = (data as Record<string, unknown>).status;
  return typeof v === "string" ? v : null;
}

function routeEventToAdapters(
  kind: string | undefined,
  data: unknown,
  adapters: {
    metro: MetroClient;
    devtools: DevToolsClient;
    builder: BuilderClient;
    watcher: WatcherClient;
    modules: ModuleHostClient;
  },
): void {
  switch (kind) {
    case "metro/status":
    case "metro/log":
      adapters.metro.dispatch(kind, data);
      return;
    case "devtools/status":
    case "devtools/delta":
      adapters.devtools.dispatch(kind, data);
      return;
    case "builder/line":
    case "builder/progress":
    case "builder/done":
      adapters.builder.dispatch(kind, data);
      return;
    case "watcher/action-complete":
      adapters.watcher.dispatch(kind, data);
      return;
    case "modules/state-changed":
    case "modules/crashed":
    case "modules/failed":
      adapters.modules.dispatch(kind, data);
      return;
    default:
      // session/status + session/log stay in the subscribe stream's
      // raw form — callers that need them (Electron for status-bar
      // updates, MCP for log fan-out) subscribe via
      // `client.subscribe(...)` directly. Adding them here would
      // pull in a session-level adapter that no client consumes
      // uniformly today.
      return;
  }
}

function makeIdGenerator(): () => string {
  let n = 0;
  const base = Math.random().toString(36).slice(2, 8);
  return () => `rn-dev-tui-${base}-${n++}`;
}
