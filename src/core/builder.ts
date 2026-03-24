import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { parseXcodebuildErrors, parseGradleErrors } from "./build-parser.js";
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
 *   'line'     — { text: string, stream: 'stdout' | 'stderr' }
 *   'progress' — { phase: string }  (e.g. "Compiling", "Linking", "Installing")
 *   'done'     — { success: boolean, errors: BuildError[] }
 */
export class Builder extends EventEmitter {
  private process: ChildProcess | null = null;
  private rawOutput = "";

  build(options: BuildOptions): void {
    const { projectRoot, platform, deviceId, port, variant, env } = options;

    const args = ["react-native", `run-${platform}`, "--port", String(port)];

    if (platform === "ios") {
      if (deviceId) {
        args.push("--udid", deviceId);
      }
      if (variant === "release") {
        args.push("--configuration", "Release");
      }
    } else {
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
          trimmed.startsWith("error ") ||           // RN CLI: "error Failed to build..."
          trimmed.startsWith("info Found") ||        // RN CLI: "info Found Xcode workspace..."
          trimmed.startsWith("info Building") ||     // RN CLI: "info Building (using..."
          trimmed.startsWith("info Installing") ||   // RN CLI: "info Installing..."
          trimmed.startsWith("info Launching") ||    // RN CLI: "info Launching..."
          trimmed.startsWith("success ") ||          // RN CLI: "success Successfully built..."
          trimmed.startsWith("warn ") ||             // RN CLI: "warn ..."
          trimmed.includes("FAILURE:") ||
          /^\s*error:/.test(trimmed) ||              // xcodebuild: "error: ..."
          /^\/.+:\d+:\d+: (error|fatal error):/.test(trimmed); // compiler: "/path:line:col: error: msg"

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
        // Parse errors from raw output
        if (platform === "ios") {
          errors = parseXcodebuildErrors(this.rawOutput);
        } else {
          errors = parseGradleErrors(this.rawOutput);
        }

        // If no structured errors found, create a generic one
        if (errors.length === 0) {
          errors.push({
            source: platform === "ios" ? "xcodebuild" : "gradle",
            summary: `Build failed with exit code ${code}`,
            rawOutput: this.rawOutput.slice(-2000),
          });
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
