import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  IpcServer,
  type IpcMessage,
  type IpcMessageEvent,
} from "../core/ipc.js";
import { ModuleLockfile } from "../core/module-host/lockfile.js";
import {
  DaemonSupervisor,
  type SessionBootFn,
  type AttachSessionResult,
} from "./supervisor.js";
import { bootSessionServices } from "../core/session/boot.js";
import { fakeBootSessionServices } from "./fake-boot.js";
import { spawnDetachedDaemon } from "./spawn.js";
import { sweepOrphanModules } from "./orphan-sweep.js";
import { validateProfile } from "./profile-guard.js";
import type { SessionEvent } from "./session.js";
import { handleClientRpc, isClientRpcAction } from "./client-rpcs.js";
import { MODULES_ACTIONS } from "../app/modules-ipc.js";

// ---------------------------------------------------------------------------
// Daemon entry for `rn-dev daemon <worktree>`.
//
// Phase 13.1 shipped lifecycle primitives (pid arbitration, socket listen,
// daemon/ping, daemon/shutdown). Phase 13.2 moves services into the
// daemon via DaemonSupervisor and adds the session/* + events/subscribe
// RPCs. TUI + Electron + MCP continue with their existing in-process
// paths until 13.3 / 13.4 flip them to clients.
//
// The daemon detaches from its parent by default via a self-respawn:
//   `rn-dev daemon <wt>` (no flag)  → fork a child with `--foreground`,
//                                     detached + stdio:ignore, then exit 0.
//   `rn-dev daemon <wt> --foreground` → stay attached and run the loop
//                                       in-process. Used by tests and by
//                                       operators debugging the daemon.
//
// Security posture (RPC authorization = filesystem permissions):
//   - <worktree>/.rn-dev/     directory is 0o700 (owner-only)
//   - <worktree>/.rn-dev/sock socket is 0o600 at creation (umask gate)
//   - <worktree>/.rn-dev/pid  lockfile is chmod'd 0o600 after write
// Relax any of these and daemon/shutdown becomes a trivial local DoS —
// there is no SO_PEERCRED check in v1. Keep them tight.
// ---------------------------------------------------------------------------

// Kept in sync with `src/cli/commands.ts::program.version(...)`. When we
// grow a shared version constant that both can import, retire the literal.
const DAEMON_VERSION = "0.1.0";
const HOST_RANGE = ">=0.1.0";

export interface RunDaemonOptions {
  worktree: string;
  foreground?: boolean;
  /**
   * Optional absolute path to the CLI entry used when detaching via
   * self-respawn. Threading this explicitly lets callers in packaged
   * environments (Electron, bundled binaries) override `process.argv[1]`
   * which otherwise points at the host bundle, not the CLI.
   */
  daemonEntry?: string;
}

export async function runDaemon(opts: RunDaemonOptions): Promise<void> {
  const worktree = resolve(opts.worktree);
  const foreground = opts.foreground === true;

  if (!foreground) {
    detachAndExit(worktree, opts.daemonEntry);
    return;
  }

  const rnDevDir = join(worktree, ".rn-dev");
  // 0o700 owner-only. If the dir already exists (common — the wizard
  // writes profiles here first), re-chmod to tighten permissions.
  mkdirSync(rnDevDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(rnDevDir, 0o700);
  } catch {
    // Unusual but not fatal on odd filesystems; socket/pid file modes
    // below are the second line of defense.
  }

  const pidPath = join(rnDevDir, "pid");
  const sockPath = join(rnDevDir, "sock");

  const lock = new ModuleLockfile(pidPath);
  const acquisition = lock.acquire({
    pid: process.pid,
    uid: process.getuid?.() ?? 0,
    socketPath: sockPath,
  });
  if (acquisition.kind === "held-by-other") {
    process.stderr.write(
      `rn-dev daemon: already running, pid=${acquisition.holder.pid}\n`,
    );
    process.exit(1);
  }
  // Lock file shouldn't be world-readable — pid + uid + socketPath leak
  // daemon topology to other local users.
  try {
    chmodSync(pidPath, 0o600);
  } catch {
    /* best-effort — ModuleLockfile.writeFileSync doesn't take a mode. */
  }

  // Orphan module sweep — kill module subprocesses whose parent daemon
  // crashed (PPID=1 → init reaped them). Runs after lock acquisition so
  // we can trust that no live daemon is still spawning modules into the
  // tree. The kill is POSIX-only; see src/daemon/orphan-sweep.ts for
  // platform notes.
  try {
    const sweep = sweepOrphanModules({
      log: (line) => process.stdout.write(`${line}\n`),
    });
    if (sweep.killed > 0) {
      process.stdout.write(
        `rn-dev daemon: orphan-sweep cleared ${sweep.killed} module${sweep.killed === 1 ? "" : "s"} (${sweep.cleared.join(", ")})\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `rn-dev daemon: orphan-sweep failed (${err instanceof Error ? err.message : String(err)}) — continuing\n`,
    );
  }

  // Pre-bind unlink of a stale socket file. Phase 13.1 reviewer P1#3:
  // previously hidden inside IpcServer.start() where it ran AFTER the
  // pid-file lock was acquired, leaving a post-lock / pre-bind window
  // where a racing client could `connect()` the stale inode. Doing it
  // here — outside the server — keeps the unlink scoped to the
  // lock-holder and under the daemon's own umask/chmod discipline.
  if (existsSync(sockPath)) {
    try {
      unlinkSync(sockPath);
    } catch {
      /* best-effort — may race with a crashed daemon's cleanup */
    }
  }

  const server = new IpcServer(sockPath);

  // Select boot implementation. Production path uses the real
  // bootSessionServices; tests opt into a stub via RN_DEV_DAEMON_BOOT_MODE=fake
  // so the state machine + event fan-out can be exercised without
  // spawning real Metro.
  const bootFn: SessionBootFn =
    process.env.RN_DEV_DAEMON_BOOT_MODE === "fake"
      ? fakeBootSessionServices
      : bootSessionServices;
  const supervisor = new DaemonSupervisor({ worktree, ipc: server, bootFn });

  server.on("message", (event: IpcMessageEvent) =>
    handleMessage(event, supervisor, shutdown),
  );

  // Gate the bind with a restrictive umask so the socket file is 0o600
  // from the first `listen()` byte. Plain chmod-after-bind leaves a
  // TOCTOU window where any local user can `connect()` and send RPCs.
  const prevUmask = process.umask(0o177);
  try {
    await server.start();
  } finally {
    process.umask(prevUmask);
  }
  // Belt-and-suspenders: some platforms (Solaris, BSD) ignore UDS file
  // modes at creation time. Re-assert owner-only.
  try {
    chmodSync(sockPath, 0o600);
  } catch {
    /* best-effort */
  }

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await supervisor.stop();
    } catch {
      /* ignore — best-effort cleanup */
    }
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
    try {
      lock.release();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGHUP", () => {
    void shutdown();
  });

  process.stdout.write(
    `rn-dev daemon: listening at ${sockPath}, pid=${process.pid}, version=${DAEMON_VERSION}\n`,
  );
}

function handleMessage(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
  shutdown: () => Promise<void>,
): void {
  const { message, reply } = event;
  switch (message.action) {
    case "daemon/ping":
      reply({
        type: "response",
        action: "daemon/ping",
        id: message.id,
        payload: { daemonVersion: DAEMON_VERSION, hostRange: HOST_RANGE },
      });
      return;

    case "daemon/shutdown":
      reply({
        type: "response",
        action: "daemon/shutdown",
        id: message.id,
        payload: { ok: true },
      });
      // Ack first; flip to shutdown on the next tick so the reply drains
      // through the socket before we close it.
      setImmediate(() => {
        void shutdown();
      });
      return;

    case "session/start":
      void handleSessionStart(event, supervisor);
      return;

    case "session/release":
      void handleSessionRelease(event, supervisor);
      return;

    case "session/stop":
      void handleSessionStop(event, supervisor);
      return;

    case "session/status":
      handleSessionStatus(event, supervisor);
      return;

    case "events/subscribe":
      void handleEventsSubscribe(event, supervisor);
      return;

    default:
      if (isClientRpcAction(message.action)) {
        void handleClientRpc(event, supervisor);
        return;
      }
      // `registerModulesIpc` attaches a second `ipc.on("message")` listener
      // that asynchronously dispatches `modules/*` + `marketplace/*` actions
      // (see src/app/modules-ipc.ts). Both listeners fire on every message,
      // so a synchronous E_UNKNOWN_ACTION reply here would race ahead of the
      // modules dispatcher's async reply and the client would see "unknown
      // action" for every modules RPC. Skip those actions and let the
      // dispatcher answer. The dispatcher is only wired once a session has
      // booted (`registerModulesIpc` is called inside `bootSessionServices`
      // / `fakeBootSessionServices`); before that, modules actions fall
      // through to E_SESSION_NOT_RUNNING via the pre-session guard below
      // rather than E_UNKNOWN_ACTION, which is the more accurate signal.
      if (MODULES_ACTIONS.has(message.action)) {
        if (!supervisor.getServices()) {
          reply({
            type: "response",
            action: message.action,
            id: message.id,
            payload: {
              code: "E_SESSION_NOT_RUNNING",
              message:
                "no session is currently running — call session/start before issuing modules RPCs",
            },
          });
        }
        return;
      }
      reply({
        type: "response",
        action: "daemon/error",
        id: message.id,
        payload: {
          code: "E_UNKNOWN_ACTION",
          requestedAction: message.action,
        },
      } satisfies IpcMessage);
      return;
  }
}

async function handleSessionStart(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): Promise<void> {
  // Phase 13.5 — refcount migrated to the long-lived events/subscribe
  // socket (handleEventsSubscribe is the new attach point). This
  // handler stays for backwards compatibility with callers that
  // expect a separate session/start RPC, but it does NOT participate
  // in the refcount. It's effectively a no-op when a session is
  // already running with a matching profile, and triggers the boot
  // when stopped — but without an attacher, the next subscribe close
  // (if any) would tear it down. Real clients should send `profile`
  // with `events/subscribe` and skip session/start entirely.
  const payloadCandidate = event.message.payload;
  const profileCandidate =
    payloadCandidate &&
    typeof payloadCandidate === "object" &&
    "profile" in payloadCandidate
      ? (payloadCandidate as { profile: unknown }).profile
      : undefined;

  const validation = validateProfile(profileCandidate);
  if (!validation.ok) {
    event.reply({
      type: "response",
      action: "session/start",
      id: event.message.id,
      payload: { code: validation.code, message: validation.message },
    });
    return;
  }

  const result = await supervisor.start({ profile: validation.profile });
  if (result.kind === "error") {
    event.reply({
      type: "response",
      action: "session/start",
      id: event.message.id,
      payload: { code: result.code, message: result.message },
    });
    return;
  }
  event.reply({
    type: "response",
    action: "session/start",
    id: event.message.id,
    payload: { status: result.status },
  });
}

async function handleSessionRelease(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): Promise<void> {
  // Phase 13.5 — explicit ref-counted detach for clients that want
  // to capture the intent in the audit log without dropping their
  // events/subscribe socket. The released conn id comes from the
  // payload because the request itself runs on a short-lived
  // send-conn whose own connectionId is irrelevant. Idempotent on
  // unknown ids.
  const payload = event.message.payload as
    | { connectionId?: unknown }
    | null
    | undefined;
  const subscribeConnId =
    payload && typeof payload.connectionId === "string"
      ? payload.connectionId
      : null;
  if (!subscribeConnId) {
    event.reply({
      type: "response",
      action: "session/release",
      id: event.message.id,
      payload: {
        code: "E_RPC_INVALID_PAYLOAD",
        message:
          "session/release requires { connectionId } from the events/subscribe response",
      },
    });
    return;
  }
  const result = await supervisor.release(subscribeConnId);
  event.reply({
    type: "response",
    action: "session/release",
    id: event.message.id,
    payload: {
      ok: true,
      attached: result.attached,
      stoppedSession: result.stoppedSession,
    },
  });
}

async function handleSessionStop(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): Promise<void> {
  const result = await supervisor.stop();
  if (result.kind === "error") {
    event.reply({
      type: "response",
      action: "session/stop",
      id: event.message.id,
      payload: { code: result.code, message: result.message },
    });
    return;
  }
  event.reply({
    type: "response",
    action: "session/stop",
    id: event.message.id,
    payload: { status: result.status },
  });
}

function handleSessionStatus(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): void {
  const state = supervisor.getState();
  event.reply({
    type: "response",
    action: "session/status",
    id: event.message.id,
    payload: {
      status: state.status,
      services: state.services ?? {},
      // Phase 13.5 — joiners use this to backfill `worktreeKey` when
      // they attach to an already-running session and miss the
      // session/status edge that would otherwise carry it.
      worktreeKey: supervisor.getSessionWorktreeKey(),
      attached: supervisor.getAttachedCount(),
    },
  });
}

async function handleEventsSubscribe(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): Promise<void> {
  // Phase 13.5 — `events/subscribe` carries an optional `profile`:
  //   - profile present  → "attacher" subscription. Boots the session
  //                        if stopped, joins if running with matching
  //                        profile, rejects on profile mismatch. The
  //                        connection holds a refcount; socket-close
  //                        decrements via `supervisor.release`.
  //   - profile absent   → "listener" subscription. Backwards-compat
  //                        path for tests + tooling that drives the
  //                        boot via `session/start` separately. No
  //                        refcount entry; socket-close just detaches
  //                        the event listener.
  // Both shapes still receive every session event on the same socket.
  //
  // Critical ordering: we register the supervisor.onEvent listener
  // BEFORE calling supervisor.attach(). If we awaited attach() first
  // — which awaits start() — the bootAsync continuation can run to
  // completion (including the "running" emitStateChanged call) on
  // the same microtask drain, BEFORE this function resumes to attach
  // its listener. The result was a silent missed-event regression
  // diagnosed during Phase 13.5: every "running" edge fired into
  // listeners=0 and the client hung waiting for an edge that had
  // already passed. The workaround is to subscribe to `event` first;
  // any "starting" edges that fire before attach validates the
  // profile are forwarded but harmless (the client filters by kind +
  // status).
  const payload = event.message.payload as
    | { profile?: unknown }
    | null
    | undefined;

  // Register the event listener and onClose hook FIRST (see comment
  // above). detach() is captured here so a subsequent attach error
  // can tear it down before we return.
  const push = (evt: SessionEvent): void => {
    event.reply({
      type: "event",
      action: "session/event",
      id: event.message.id,
      payload: evt,
    });
  };
  const detach = supervisor.onEvent(push);
  const subscribeConnId = event.connectionId;
  let isAttacher = false;
  event.onClose(() => {
    detach();
    if (isAttacher) {
      // supervisor.release is idempotent on unknown ids so an explicit
      // `session/release` followed by socket-close is safe.
      void supervisor.release(subscribeConnId);
    }
  });

  let attachResult: AttachSessionResult | null = null;
  if (payload && payload.profile !== undefined) {
    const validation = validateProfile(payload.profile);
    if (!validation.ok) {
      detach();
      event.reply({
        type: "response",
        action: "events/subscribe",
        id: event.message.id,
        payload: { code: validation.code, message: validation.message },
      });
      return;
    }
    attachResult = await supervisor.attach(event.connectionId, {
      profile: validation.profile,
    });
    if (attachResult.kind === "error") {
      detach();
      event.reply({
        type: "response",
        action: "events/subscribe",
        id: event.message.id,
        payload: { code: attachResult.code, message: attachResult.message },
      });
      return;
    }
    isAttacher = true;
  }

  // Confirm the subscription. The response shape stays
  // backwards-compatible — `subscribed: true` is the only field old
  // clients read. New fields (`connectionId`, `status`, `started`,
  // `attached`) populate when this is an attacher subscription so
  // joiners can detect the running-already case without a separate
  // status RPC.
  event.reply({
    type: "response",
    action: "events/subscribe",
    id: event.message.id,
    payload: {
      subscribed: true,
      connectionId: event.connectionId,
      status: attachResult?.status,
      started: attachResult?.started,
      attached: attachResult?.attached,
    },
  });
}

function detachAndExit(worktree: string, daemonEntryOverride?: string): never {
  // The child runs the daemon loop in-process via --foreground; see
  // `spawnDetachedDaemon` for the detach mechanics (detached=true,
  // stdio=ignore, unref). This function is the "I am the CLI-level
  // daemon command, now fork myself and exit" wrapper around that
  // primitive.
  try {
    const child = spawnDetachedDaemon(worktree, daemonEntryOverride);
    process.stdout.write(
      `rn-dev daemon: spawned detached pid=${child.pid ?? "?"}, worktree=${worktree}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `rn-dev daemon: ${err instanceof Error ? err.message : String(err)} — re-run with --foreground\n`,
    );
    process.exit(1);
  }
}
