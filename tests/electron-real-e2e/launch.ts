import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared launch + teardown helper for the long-session real-e2e suite.
// Mirrors the smoke harness in `tests/electron-smoke/smoke.spec.ts` but
// returns a richer handle: the real-e2e tests need both stderr capture
// and the daemon's pid file path so they can assert process liveness +
// scan stderr for `subscribe.send: connection already closed`.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SMOKE_FIXTURE_SRC = join(REPO_ROOT, "tests", "electron-smoke", "fixtures", "smoke-rn");

export interface RealE2eHandle {
  app: ElectronApplication;
  page: Page;
  tmpdir: string;
  /** Captured stderr from Electron main + spawned daemon. */
  getStderr: () => string;
  /** Captured stdout. */
  getStdout: () => string;
}

export interface LaunchOptions {
  metroPort?: number;
  /** Extra .rn-dev/profiles/*.json entries to write before launch. Each
   * gets a UUID-ish filename to avoid collisions. */
  extraProfiles?: Array<{
    name: string;
    metroPort: number;
    branch?: string;
  }>;
}

export async function launchRealE2e(opts: LaunchOptions = {}): Promise<RealE2eHandle> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "rn-dev-real-e2e-"));
  cpSync(SMOKE_FIXTURE_SRC, tmpRoot, { recursive: true });

  const profilesDir = join(tmpRoot, ".rn-dev", "profiles");
  mkdirSync(profilesDir, { recursive: true });

  const metroPort = opts.metroPort ?? 8099;
  writeFileSync(
    join(profilesDir, "default.json"),
    JSON.stringify(
      {
        name: "default",
        isDefault: true,
        worktree: null,
        branch: "main",
        platform: "ios",
        mode: "quick",
        metroPort,
        devices: {},
        buildVariant: "debug",
        preflight: { checks: [], frequency: "once" },
        onSave: [],
        env: {},
        projectRoot: tmpRoot,
      },
      null,
      2,
    ),
  );

  for (const extra of opts.extraProfiles ?? []) {
    writeFileSync(
      join(profilesDir, `${extra.name}.json`),
      JSON.stringify(
        {
          name: extra.name,
          isDefault: false,
          worktree: null,
          branch: extra.branch ?? "main",
          platform: "ios",
          mode: "quick",
          metroPort: extra.metroPort,
          devices: {},
          buildVariant: "debug",
          preflight: { checks: [], frequency: "once" },
          onSave: [],
          env: {},
          projectRoot: tmpRoot,
        },
        null,
        2,
      ),
    );
  }

  const userDataDir = join(tmpRoot, ".electron-user-data");
  mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: [
      join(REPO_ROOT, "electron", "launcher.cjs"),
      `--user-data-dir=${userDataDir}`,
    ],
    cwd: tmpRoot,
    stderr: "pipe",
    stdout: "pipe",
    env: {
      ...process.env,
      // Fake-boot keeps Metro/Builder/Watcher stubbed; the daemon process
      // itself is real, which is what we need to exercise daemon-survival
      // assertions.
      RN_DEV_DAEMON_BOOT_MODE: "fake",
      RN_DEV_PROJECT_ROOT: tmpRoot,
      RN_DEV_SMOKE: "1",
    },
    timeout: 30_000,
  });

  let stderr = "";
  let stdout = "";
  app.process().stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(`[electron-stderr] ${text}`);
  });
  app.process().stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(`[electron-stdout] ${text}`);
  });

  const page = await app.firstWindow({ timeout: 30_000 });
  return {
    app,
    page,
    tmpdir: tmpRoot,
    getStderr: () => stderr,
    getStdout: () => stdout,
  };
}

export async function teardownRealE2e(handle: RealE2eHandle): Promise<void> {
  // Pre-fix `app.close()` left the spawned daemon (a detached process
  // group leader, not Electron's child) running forever — every
  // `npm run test:real-e2e` accumulated 2 leaked
  // `bun … daemon /var/folders/.../rn-dev-real-e2e-*` processes.
  // Same class as Bug F. Read the pid BEFORE app.close + rmSync so
  // the SIGKILL fallback has something to target.
  const pid = readDaemonPidFromWorktree(handle.tmpdir);
  await handle.app.close().catch(() => {
    /* Electron sometimes refuses clean close under harness */
  });
  if (pid !== null) {
    await terminateDaemonPid(pid);
  }
  try {
    rmSync(handle.tmpdir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Read the pid recorded by the daemon's lockfile at
 * `<worktree>/.rn-dev/pid`. Returns null if missing/unparseable —
 * either the daemon never started, or it crashed before writing.
 * Pid file format set by `ModuleLockfile.acquire`.
 */
function readDaemonPidFromWorktree(worktree: string): number | null {
  const pidPath = join(worktree, ".rn-dev", "pid");
  if (!existsSync(pidPath)) return null;
  try {
    const raw = readFileSync(pidPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateDaemonPid(pid: number): Promise<void> {
  if (!processIsAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* best-effort */
  }
  // Poll up to 1.5s for graceful exit before SIGKILL.
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (processIsAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* best-effort */
    }
  }
}
