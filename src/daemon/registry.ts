// Active-daemon registry. Phase 13.5 — Phase 13.4 didn't need this
// because each client knew its own worktree and could find the per-
// worktree socket directly. Phase 13.5 grows the world to "MCP attaches
// to whichever daemon is running this project," for which the client
// needs a side-channel listing of what daemons are alive.
//
// File layout: `~/.rn-dev/registry.json` — a JSON object keyed by
// worktree absolute path:
//
//   {
//     "daemons": {
//       "/home/martin/projects/foo": {
//         "pid": 12345,
//         "sockPath": "/home/martin/projects/foo/.rn-dev/sock",
//         "since": "2026-04-25T01:23:45.000Z",
//         "hostVersion": "0.1.0"
//       }
//     }
//   }
//
// Every daemon writes its entry on boot (after lock acquisition + socket
// bind) and removes it on graceful shutdown. A stale-entry sweep at
// boot filters out entries whose pid is dead, so a crashed daemon's
// stale row doesn't accumulate.
//
// Writes use the rename-after-write atomic pattern so a crashed daemon
// mid-write doesn't leave a half-formed JSON file the next boot can't
// parse. File mode is 0o600 — single-user; daemons running under
// different UIDs use their own home directories anyway.
//
// Concurrent writers: the registry's only writers are daemons starting
// up or shutting down on this same machine. We accept the standard
// last-writer-wins race for the rare case where two daemons start
// simultaneously — the worst case is one entry briefly missing, which
// the next boot's sweep adds back.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DaemonRegistration {
  /** OS pid of the daemon process. */
  pid: number;
  /** Absolute path of the daemon's Unix-domain socket. */
  sockPath: string;
  /** ISO-8601 timestamp of when the daemon registered itself. */
  since: string;
  /** Daemon version string (per `DAEMON_VERSION` in src/daemon/index.ts). */
  hostVersion: string;
}

/** On-disk registry shape. Versioned for future evolution. */
export interface DaemonRegistry {
  daemons: Record<string, DaemonRegistration>;
}

const EMPTY_REGISTRY: DaemonRegistry = Object.freeze({
  daemons: {},
}) as DaemonRegistry;

/**
 * Default registry path. Tests override via `RN_DEV_REGISTRY_PATH` so the
 * shared `~/.rn-dev/registry.json` doesn't get clobbered by integration
 * runs.
 */
export function defaultRegistryPath(): string {
  const override = process.env.RN_DEV_REGISTRY_PATH;
  if (override) return override;
  return join(homedir(), ".rn-dev", "registry.json");
}

/**
 * Read + parse the registry. Returns an empty registry if the file is
 * missing or malformed — the latter is a defensive choice: a corrupted
 * file shouldn't permanently block daemon boot.
 */
export function readRegistry(path: string = defaultRegistryPath()): DaemonRegistry {
  if (!existsSync(path)) return { daemons: {} };
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return { daemons: {} };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return { daemons: {} };
    const daemons = (parsed as { daemons?: unknown }).daemons;
    if (!daemons || typeof daemons !== "object") return { daemons: {} };
    // Light shape validation per row — drop anything malformed rather
    // than fail the whole read.
    const out: Record<string, DaemonRegistration> = {};
    for (const [worktree, raw] of Object.entries(
      daemons as Record<string, unknown>,
    )) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (
        typeof r.pid !== "number" ||
        typeof r.sockPath !== "string" ||
        typeof r.since !== "string" ||
        typeof r.hostVersion !== "string"
      ) {
        continue;
      }
      out[worktree] = {
        pid: r.pid,
        sockPath: r.sockPath,
        since: r.since,
        hostVersion: r.hostVersion,
      };
    }
    return { daemons: out };
  } catch {
    return { daemons: {} };
  }
}

/**
 * Atomically write the registry — temp-file + rename so a crash mid-
 * write can't leave a half-formed file. Mode 0o600 because the
 * registration includes pid + sockPath which leak local-machine
 * topology to other unprivileged users on the same box.
 */
export function writeRegistry(
  registry: DaemonRegistry,
  path: string = defaultRegistryPath(),
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  renameSync(tmp, path);
}

/**
 * Liveness check — `kill(pid, 0)` raises ESRCH if the pid is dead and
 * returns true if it's alive. We don't bother distinguishing EPERM
 * (alive but owned by a different uid) because in practice every
 * daemon we register here runs under the current uid; an EPERM there
 * would be an anomaly worth surfacing as "alive" and letting the
 * caller's connect attempt fail informatively.
 */
function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Register a daemon entry, sweeping stale entries (pid not alive) at
 * the same time. Idempotent on re-registration of the same worktree —
 * the latest entry wins.
 */
export function registerDaemon(
  worktree: string,
  entry: DaemonRegistration,
  path: string = defaultRegistryPath(),
): void {
  const current = readRegistry(path);
  const next: DaemonRegistry = { daemons: {} };
  for (const [wt, reg] of Object.entries(current.daemons)) {
    // Skip self-entries (we'll write the fresh row at the end) and any
    // stale entries pointing at a dead pid.
    if (wt === worktree) continue;
    if (!isAlive(reg.pid)) continue;
    next.daemons[wt] = reg;
  }
  next.daemons[worktree] = entry;
  writeRegistry(next, path);
}

/**
 * Remove a daemon entry from the registry. No-op if the worktree isn't
 * present. Used at graceful shutdown so the next boot's sweep doesn't
 * have to clean it up.
 */
export function unregisterDaemon(
  worktree: string,
  path: string = defaultRegistryPath(),
): void {
  const current = readRegistry(path);
  if (!(worktree in current.daemons)) return;
  const next: DaemonRegistry = { daemons: {} };
  for (const [wt, reg] of Object.entries(current.daemons)) {
    if (wt === worktree) continue;
    next.daemons[wt] = reg;
  }
  writeRegistry(next, path);
}

/**
 * Find every active daemon — entries whose pid is alive at read time.
 * Stale rows are filtered but not removed (the next register/unregister
 * pass will rewrite the file). Returns rows pinned to a `worktree`
 * field so callers don't have to thread the keys separately.
 */
export function findActiveDaemons(
  path: string = defaultRegistryPath(),
): Array<DaemonRegistration & { worktree: string }> {
  const current = readRegistry(path);
  const out: Array<DaemonRegistration & { worktree: string }> = [];
  for (const [worktree, reg] of Object.entries(current.daemons)) {
    if (!isAlive(reg.pid)) continue;
    out.push({ worktree, ...reg });
  }
  return out;
}
