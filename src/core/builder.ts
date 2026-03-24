import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, rmSync } from "fs";
import { EventEmitter } from "events";
import { parseXcodebuildErrors, parseGradleErrors, parseXcresultErrors } from "./build-parser.js";
import type { BuildError } from "./types.js";

// Strip ANSI escape codes
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildOptions {
  projectRoot: string;
  platform: "ios" | "android";
  deviceId?: string;
  port: number;
  variant: "debug" | "release";
  env?: Record<string, string>;
}

export interface BuildResult {
  success: boolean;
  errors: BuildError[];
  rawOutput: string;
}

/**
 * Manages app builds. Spawns `react-native run-ios` or `run-android`
 * as a child process and streams output line-by-line via events.
 *
 * Emits:
 *   'line'     — { text: string, stream: 'stdout' | 'stderr', replace?: boolean }
 *   'progress' — { phase: string }
 *   'done'     — { success: boolean, errors: BuildError[] }
 */
export class Builder extends EventEmitter {
  private process: ChildProcess | null = null;
  private rawOutput = "";
  private xcresultPath: string | null = null;

  build(options: BuildOptions): void {
    const { projectRoot, platform, deviceId, port, variant, env } = options;

    const args = ["react-native", `run-${platform}`, "--port", String(port), "--verbose"];

    if (platform === "ios") {
      // Create a unique xcresult path for structured error extraction
      this.xcresultPath = `/tmp/rn-dev-build-${Date.now()}.xcresult`;
      // Clean up any previous result bundle at this path
      if (existsSync(this.xcresultPath)) {
        rmSync(this.xcresultPath, { recursive: true, force: true });
      }
      args.push("--extra-params", `-resultBundlePath ${this.xcresultPath}`);

      if (deviceId) {
        args.push("--udid", deviceId);
      }
      if (variant === "release") {
        args.push("--configuration", "Release");
      }
    } else {
      this.xcresultPath = null;
      if (deviceId) {
        args.push("--deviceId", deviceId);
      }
      if (variant === "release") {
        args.push("--variant", "release");
      }
    }

    this.emit("progress", { phase: "Building" });
    this.emit("line", { text: `Building for ${platform}...`, stream: "stdout" });
    this.emit("line", { text: `  npx ${args.join(" ")}`, stream: "stdout" });

    this.rawOutput = "";

    const child = spawn("npx", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.process = child;

    const handleData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      this.rawOutput += text;

      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Milestone lines — appended permanently (important status messages)
        const isMilestone =
          trimmed.startsWith("BUILD SUCCESSFUL") ||
          trimmed.startsWith("Build Succeeded") ||
          trimmed.includes("BUILD FAILED") ||
          trimmed.startsWith("error ") ||
          trimmed.startsWith("info Found") ||
          trimmed.startsWith("info Building") ||
          trimmed.startsWith("info Installing") ||
          trimmed.startsWith("info Launching") ||
          trimmed.startsWith("success ") ||
          trimmed.startsWith("warn ") ||
          trimmed.includes("FAILURE:") ||
          /^\s*error:/.test(trimmed) ||
          /^\/.+:\d+:\d+: (error|fatal error):/.test(trimmed);

        // Detect build phases for progress indicator
        if (trimmed.includes("Compiling") || trimmed.includes("CompileC")) {
          this.emit("progress", { phase: "Compiling" });
        } else if (trimmed.includes("Linking") || trimmed.includes("Ld ")) {
          this.emit("progress", { phase: "Linking" });
        } else if (trimmed.startsWith("info Installing")) {
          this.emit("progress", { phase: "Installing" });
        } else if (trimmed.startsWith("info Launching")) {
          this.emit("progress", { phase: "Launching" });
        }

        if (isMilestone) {
          this.emit("line", { text: trimmed, stream, replace: false });
        } else {
          // Verbose: replace the current progress line (truncated)
          this.emit("line", { text: `  ${trimmed.slice(0, 100)}`, stream, replace: true });
        }
      }
    };

    child.stdout?.on("data", handleData("stdout"));
    child.stderr?.on("data", handleData("stderr"));

    child.on("exit", (code) => {
      const success = code === 0;
      let errors: BuildError[] = [];

      if (!success) {
        // Strategy 1: Parse xcresult bundle (iOS only, most reliable)
        if (platform === "ios" && this.xcresultPath && existsSync(this.xcresultPath)) {
          try {
            errors = parseXcresultErrors(this.xcresultPath);
          } catch {
            // Fall through to regex parsing
          }
        }

        // Strategy 2: Parse raw output with regex
        if (errors.length === 0) {
          if (platform === "ios") {
            errors = parseXcodebuildErrors(this.rawOutput);
          } else {
            errors = parseGradleErrors(this.rawOutput);
          }
        }

        // Strategy 3: Generic fallback
        if (errors.length === 0) {
          errors.push({
            source: platform === "ios" ? "xcodebuild" : "gradle",
            summary: `Build failed with exit code ${code}`,
            rawOutput: this.rawOutput.slice(-2000),
          });
        }
      }

      // Clean up xcresult bundle
      if (this.xcresultPath && existsSync(this.xcresultPath)) {
        try {
          rmSync(this.xcresultPath, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }

      this.emit("done", { success, errors });
      this.process = null;
    });

    child.on("error", (err) => {
      this.emit("done", {
        success: false,
        errors: [{
          source: platform === "ios" ? "xcodebuild" : "gradle",
          summary: `Failed to spawn build process: ${err.message}`,
          rawOutput: err.message,
        }],
      });
      this.process = null;
    });
  }

  cancel(): void {
    if (this.process) {
      try {
        process.kill(-this.process.pid!, "SIGKILL");
      } catch {
        try {
          this.process.kill("SIGKILL");
        } catch {}
      }
      this.process = null;
    }
  }

  get isBuilding(): boolean {
    return this.process !== null;
  }
}
