import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { IpcServer, type IpcMessage, type IpcMessageEvent } from "../core/ipc.js";
import { ModuleLockfile } from "../core/module-host/lockfile.js";

// ---------------------------------------------------------------------------
// Daemon entry for `rn-dev daemon <worktree>`. Phase 13.1 ships lifecycle
// primitives only — pid arbitration, socket listen, daemon/ping, and
// daemon/shutdown. Session + service ownership arrive in Phase 13.2.
//
// The daemon detaches from its parent by default via a self-respawn:
//   `rn-dev daemon <wt>` (no flag)  → fork a child with `--foreground`,
//                                     detached + stdio:ignore, then exit 0.
//   `rn-dev daemon <wt> --foreground` → stay attached and run the loop
//                                       in-process. Used by tests and by
//                                       operators debugging the daemon.
// ---------------------------------------------------------------------------

// Kept in sync with `src/cli/commands.ts::program.version(...)`. When we
// grow a shared version constant that both can import, retire the literal.
const DAEMON_VERSION = "0.1.0";
const HOST_RANGE = ">=0.1.0";

export interface RunDaemonOptions {
  worktree: string;
  foreground?: boolean;
}

export async function runDaemon(opts: RunDaemonOptions): Promise<void> {
  const worktree = resolve(opts.worktree);
  const foreground = opts.foreground === true;

  if (!foreground) {
    detachAndExit(worktree);
    return;
  }

  const rnDevDir = join(worktree, ".rn-dev");
  mkdirSync(rnDevDir, { recursive: true });

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

  const server = new IpcServer(sockPath);
  server.on("message", (event: IpcMessageEvent) => handleMessage(event));
  await server.start();

  // Owner-only permissions — blocks cross-user attacks on shared machines.
  try {
    chmodSync(sockPath, 0o600);
  } catch {
    // Platforms without chmod semantics (shouldn't apply on our POSIX-only
    // target) are best-effort.
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.stop();
    } catch {
      /* ignore — best-effort cleanup */
    }
    try {
      lock.release();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  process.stdout.write(
    `rn-dev daemon: listening at ${sockPath}, pid=${process.pid}, version=${DAEMON_VERSION}\n`,
  );
}

function handleMessage(event: IpcMessageEvent): void {
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
      // Ack first, then trigger shutdown on the next tick so the reply
      // drains through the socket before we close it.
      setImmediate(() => {
        process.kill(process.pid, "SIGTERM");
      });
      return;

    default:
      reply({
        type: "response",
        action: message.action,
        id: message.id,
        payload: { error: "E_UNKNOWN_ACTION", action: message.action },
      } satisfies IpcMessage);
      return;
  }
}

function detachAndExit(worktree: string): never {
  // Re-invoke ourselves with --foreground so the child runs the daemon
  // loop in-process. `detached: true` + `stdio: "ignore"` gives us the
  // POSIX setsid + close-stdio shape we need; `.unref()` lets the parent
  // exit without waiting.
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) {
    process.stderr.write(
      "rn-dev daemon: cannot detach (missing process.argv[1]); re-run with --foreground\n",
    );
    process.exit(1);
  }

  const child = spawn(
    process.execPath,
    [entry, "daemon", worktree, "--foreground"],
    {
      detached: true,
      stdio: "ignore",
      cwd: worktree,
    },
  );
  child.unref();
  process.stdout.write(
    `rn-dev daemon: spawned detached pid=${child.pid ?? "?"}, worktree=${worktree}\n`,
  );
  process.exit(0);
}
