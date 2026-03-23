import { EventEmitter } from "node:events";
import { spawn } from "child_process";
import * as net from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ArtifactStore } from "./artifact.js";
import type { MetroInstance } from "./types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// MetroManager
// ---------------------------------------------------------------------------

/**
 * Manages multiple Metro bundler instances, one per worktree.
 *
 * Emits:
 *   'log'    — { worktreeKey, line, stream: 'stdout' | 'stderr' }
 *   'status' — { worktreeKey, status, error?: string }
 */
export class MetroManager extends EventEmitter {
  private instances: Map<string, MetroInstance> = new Map();

  constructor(
    private artifacts: ArtifactStore,
    private portRange: [number, number] = [8081, 8099]
  ) {
    super();
  }

  // -------------------------------------------------------------------------
  // Port management
  // -------------------------------------------------------------------------

  /**
   * Allocate a port for the given worktree key.
   *
   * Strategy:
   *   1. Check artifact for a persisted port — reuse it if found.
   *   2. Otherwise find the first port in portRange not used by a running instance.
   *   3. Persist the chosen port in the artifact.
   *
   * Throws if no ports are available in the configured range.
   */
  allocatePort(worktreeKey: string): number {
    const artifact = this.artifacts.load(worktreeKey);

    if (artifact?.metroPort != null) {
      return artifact.metroPort;
    }

    const [min, max] = this.portRange;
    const usedPorts = new Set<number>();
    for (const instance of this.instances.values()) {
      usedPorts.add(instance.port);
    }

    for (let port = min; port <= max; port++) {
      if (!usedPorts.has(port)) {
        this.artifacts.save(worktreeKey, { metroPort: port });
        return port;
      }
    }

    throw new Error(
      `No ports available in range [${min}, ${max}]. All ports are in use.`
    );
  }

  /**
   * Returns true if the given port is not currently bound on this machine.
   * Uses a temporary TCP server to probe — if it listens successfully, the
   * port is free.
   */
  isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", () => {
        resolve(false);
      });

      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
  }

  /**
   * Find the PID of any process listening on `port` using `lsof -i :PORT -t`.
   * Returns null if no process is found or lsof is unavailable.
   */
  async findProcessOnPort(port: number): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync("lsof", [
        "-i",
        `:${port}`,
        "-t",
      ]);
      const pid = parseInt(stdout.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Kill the process on `port` via SIGTERM.
   * Returns true if a process was found and signalled, false otherwise.
   */
  async killProcessOnPort(port: number): Promise<boolean> {
    const pid = await this.findProcessOnPort(port);
    if (pid == null) {
      return false;
    }
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle
  // -------------------------------------------------------------------------

  /**
   * Spawn a Metro bundler for the given worktree.
   *
   * Runs `npx react-native start --port PORT` as a detached child process so
   * Metro continues running even if the TUI exits.
   *
   * Log lines from stdout/stderr are emitted as 'log' events so the TUI can
   * subscribe without MetroManager needing to buffer them.
   */
  start(options: {
    worktreeKey: string;
    projectRoot: string;
    port?: number;
    resetCache?: boolean;
    verbose?: boolean;
    env?: Record<string, string>;
  }): MetroInstance {
    const {
      worktreeKey,
      projectRoot,
      port: explicitPort,
      resetCache = false,
      verbose = false,
      env,
    } = options;

    const port = explicitPort ?? this.allocatePort(worktreeKey);

    const args = ["react-native", "start", "--port", String(port)];
    if (resetCache) {
      args.push("--reset-cache");
    }
    if (verbose) {
      args.push("--verbose");
    }

    const child = spawn("npx", args, {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });

    // Unref so the parent process can exit independently of Metro
    child.unref();

    const instance: MetroInstance = {
      worktree: worktreeKey,
      port,
      pid: child.pid ?? 0,
      status: "starting",
      startedAt: new Date(),
      projectRoot,
    };

    this.instances.set(worktreeKey, instance);

    // Pipe stdout lines to subscribers
    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          // Detect Metro ready signal
          if (
            line.includes("Metro waiting on") ||
            line.includes("Metro is running") ||
            line.includes("Welcome to Metro")
          ) {
            instance.status = "running";
            this.emit("status", { worktreeKey, status: "running" });
          }
          this.emit("log", { worktreeKey, line, stream: "stdout" });
        }
      }
    });

    // Pipe stderr lines to subscribers
    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          this.emit("log", { worktreeKey, line, stream: "stderr" });
        }
      }
    });

    // Handle process exit
    child.on("exit", (code) => {
      const current = this.instances.get(worktreeKey);
      if (current) {
        const newStatus = code === 0 ? "stopped" : "error";
        current.status = newStatus;
        const payload: { worktreeKey: string; status: string; error?: string } =
          { worktreeKey, status: newStatus };
        if (code !== 0) {
          payload.error = `Metro exited with code ${code}`;
        }
        this.emit("status", payload);
      }
    });

    child.on("error", (err) => {
      const current = this.instances.get(worktreeKey);
      if (current) {
        current.status = "error";
        this.emit("status", {
          worktreeKey,
          status: "error",
          error: err.message,
        });
      }
    });

    return instance;
  }

  /**
   * Stop the Metro instance for `worktreeKey` by sending SIGTERM.
   * Returns true if an instance was found and signalled, false otherwise.
   */
  stop(worktreeKey: string): boolean {
    const instance = this.instances.get(worktreeKey);
    if (!instance) {
      return false;
    }

    try {
      process.kill(instance.pid, "SIGTERM");
    } catch {
      // Process may have already exited — that's fine
    }

    instance.status = "stopped";
    this.instances.delete(worktreeKey);
    this.emit("status", { worktreeKey, status: "stopped" });
    return true;
  }

  /** Stop all running Metro instances. */
  stopAll(): void {
    for (const key of [...this.instances.keys()]) {
      this.stop(key);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getInstance(worktreeKey: string): MetroInstance | null {
    return this.instances.get(worktreeKey) ?? null;
  }

  getAll(): MetroInstance[] {
    return [...this.instances.values()];
  }

  /**
   * Send a reload signal to the Metro instance's connected device.
   * Uses the Metro dev server's /reload endpoint.
   */
  reload(worktreeKey: string): boolean {
    const instance = this.instances.get(worktreeKey);
    if (!instance || instance.status !== "running") return false;
    try {
      const http = require("http") as typeof import("http");
      const req = http.request(
        { hostname: "localhost", port: instance.port, path: "/reload", method: "POST" },
        () => {}
      );
      req.on("error", () => {});
      req.end();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open dev menu on the connected device.
   * Uses the Metro dev server's /open-debugger endpoint.
   */
  devMenu(worktreeKey: string): boolean {
    const instance = this.instances.get(worktreeKey);
    if (!instance || instance.status !== "running") return false;
    try {
      const http = require("http") as typeof import("http");
      const req = http.request(
        { hostname: "localhost", port: instance.port, path: "/open-debugger", method: "POST" },
        () => {}
      );
      req.on("error", () => {});
      req.end();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Build requirement detection
  // -------------------------------------------------------------------------

  /**
   * Returns true if the native app needs to be rebuilt because the Metro port
   * has changed since the last build.
   *
   * A rebuild is needed when:
   *   - No artifact exists for the worktree, OR
   *   - The artifact has no `lastBuildPort`, OR
   *   - `lastBuildPort` differs from `currentPort`.
   */
  needsRebuild(worktreeKey: string, currentPort: number): boolean {
    const artifact = this.artifacts.load(worktreeKey);
    if (!artifact || artifact.lastBuildPort == null) {
      return true;
    }
    return artifact.lastBuildPort !== currentPort;
  }
}
