import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { IpcClient } from "../core/ipc.js";
import { ModuleLockfile } from "../core/module-host/lockfile.js";

// ---------------------------------------------------------------------------
// Client-side primitive. Later phases wire this into Electron/TUI/MCP so
// that every client path unconditionally ends up with a live daemon to
// talk to. Phase 13.1 ships it additive — nothing in the existing tree
// calls `connectToDaemon` yet.
// ---------------------------------------------------------------------------

export interface ConnectToDaemonOptions {
  /** Max wall-clock to wait for the socket to appear after a cold spawn. */
  spawnTimeoutMs?: number;
  /** Poll cadence for the socket-appearance check. */
  pollMs?: number;
}

export async function connectToDaemon(
  worktree: string,
  opts: ConnectToDaemonOptions = {},
): Promise<IpcClient> {
  const { spawnTimeoutMs = 5_000, pollMs = 100 } = opts;

  const wt = resolve(worktree);
  const sockPath = join(wt, ".rn-dev", "sock");
  const pidPath = join(wt, ".rn-dev", "pid");

  if (await isDaemonAlive(pidPath, sockPath)) {
    return new IpcClient(sockPath);
  }

  unlinkStale(sockPath);
  spawnDetachedDaemon(wt);
  await waitForSocket(sockPath, spawnTimeoutMs, pollMs);
  return new IpcClient(sockPath);
}

export async function isDaemonAlive(
  pidPath: string,
  sockPath: string,
): Promise<boolean> {
  if (!existsSync(sockPath)) return false;
  const lock = new ModuleLockfile(pidPath);
  const holder = lock.peek();
  if (!holder) return false;
  const client = new IpcClient(sockPath);
  return client.isServerRunning();
}

export function unlinkStale(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // best-effort — the daemon will overwrite on bind
  }
}

export function spawnDetachedDaemon(worktree: string): void {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) {
    throw new Error(
      "connectToDaemon: cannot locate CLI entry (process.argv[1] empty)",
    );
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
}

export async function waitForSocket(
  sockPath: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(sockPath)) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `connectToDaemon: timed out after ${timeoutMs}ms waiting for ${sockPath}`,
  );
}
