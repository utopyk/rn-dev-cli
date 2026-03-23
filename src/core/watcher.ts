import { EventEmitter } from "node:events";
import { spawn } from "child_process";
import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import picomatch from "picomatch";
import type { OnSaveAction } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WatcherConfig {
  actions: OnSaveAction[];
  debounceMs?: number;
  ignorePatterns?: string[];
  projectRoot: string;
}

export interface PipelineResult {
  action: string;
  success: boolean;
  output: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Default config values
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.rn-dev/**",
  "**/build/**",
  "**/dist/**",
  "**/Pods/**",
];

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

/**
 * Watches a project directory for file changes and runs a configurable
 * pipeline of actions on every save.
 *
 * Emits:
 *   'pipeline-start'    — { files: string[] }
 *   'action-start'      — { name: string }
 *   'action-complete'   — { name: string, result: PipelineResult }
 *   'pipeline-complete' — { results: PipelineResult[] }
 */
export class FileWatcher extends EventEmitter {
  private enabled: boolean = true;
  private running: boolean = false;

  private chokidarWatcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles: Set<string> = new Set();

  // Used to signal cancellation to a running pipeline
  private pipelineAbortController: AbortController | null = null;

  constructor(private config: WatcherConfig) {
    super();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start watching the projectRoot for file changes. */
  start(): void {
    const ignorePatterns =
      this.config.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;

    this.chokidarWatcher = watch(this.config.projectRoot, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
    });

    this.chokidarWatcher.on("change", (filePath: string) => {
      this.handleFileChange(filePath);
    });

    this.chokidarWatcher.on("add", (filePath: string) => {
      this.handleFileChange(filePath);
    });

    this.running = true;
  }

  /** Stop watching and close the chokidar watcher. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.chokidarWatcher) {
      this.chokidarWatcher.close();
      this.chokidarWatcher = null;
    }

    // Cancel any running pipeline
    this.pipelineAbortController?.abort();

    this.running = false;
  }

  /**
   * Toggle whether the watcher runs the pipeline on save.
   * Returns the new enabled state.
   */
  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Private: debounce and pipeline entry point
  // -------------------------------------------------------------------------

  private handleFileChange(filePath: string): void {
    this.pendingFiles.add(filePath);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const debounceMs = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;

      if (!this.enabled) {
        this.pendingFiles.clear();
        return;
      }

      const files = [...this.pendingFiles];
      this.pendingFiles.clear();

      // Cancel any currently running pipeline
      this.pipelineAbortController?.abort();
      const controller = new AbortController();
      this.pipelineAbortController = controller;

      this.runPipeline(files, controller.signal).catch(() => {
        // Errors in pipeline are swallowed — the TUI subscribes to events
      });
    }, debounceMs);
  }

  // -------------------------------------------------------------------------
  // Private: pipeline execution
  // -------------------------------------------------------------------------

  private async runPipeline(
    changedFiles: string[],
    signal: AbortSignal
  ): Promise<void> {
    this.emit("pipeline-start", { files: changedFiles });

    const results: PipelineResult[] = [];

    for (const action of this.config.actions) {
      if (signal.aborted) break;

      // Skip disabled actions
      if (!action.enabled) continue;

      // Skip if a glob is defined but no changed file matches
      if (action.glob) {
        const isMatch = picomatch(action.glob);
        const anyMatch = changedFiles.some((f) => isMatch(f));
        if (!anyMatch) continue;
      }

      // Skip actions without a command
      if (!action.command) continue;

      this.emit("action-start", { name: action.name });

      const result = await this.runAction(action, changedFiles, signal);
      results.push(result);

      this.emit("action-complete", { name: action.name, result });

      if (!result.success && action.haltOnFailure) {
        break;
      }
    }

    if (!signal.aborted) {
      this.emit("pipeline-complete", { results });
    }
  }

  private runAction(
    action: OnSaveAction,
    changedFiles: string[],
    signal: AbortSignal
  ): Promise<PipelineResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      // Substitute {files} placeholder
      const fileList = changedFiles.join(" ");
      const command = (action.command ?? "").replace(/\{files\}/g, fileList);

      // Run via shell so the full command string (pipes, operators) works
      const child = spawn("sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      child.on("close", (code: number | null) => {
        const durationMs = Date.now() - startTime;
        resolve({
          action: action.name,
          success: code === 0,
          output,
          durationMs,
        });
      });

      child.on("error", (err: Error) => {
        const durationMs = Date.now() - startTime;
        resolve({
          action: action.name,
          success: false,
          output: err.message,
          durationMs,
        });
      });

      // If the pipeline is cancelled, kill the child process
      signal.addEventListener(
        "abort",
        () => {
          try {
            child.kill("SIGTERM");
          } catch {
            // Already exited
          }
          const durationMs = Date.now() - startTime;
          resolve({
            action: action.name,
            success: false,
            output: "cancelled",
            durationMs,
          });
        },
        { once: true }
      );
    });
  }
}
