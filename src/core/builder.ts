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
  private detectedXcresultPath: string | null = null;

  build(options: BuildOptions): void {
    const { projectRoot, platform, deviceId, port, variant, env } = options;

    const args = ["react-native", `run-${platform}`, "--port", String(port)];

    this.detectedXcresultPath = null;

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

      // Detect auto-generated xcresult bundle path from stderr
      const xcresultMatch = text.match(/(?:Writing|Wrote)\s+(?:error\s+)?result\s+bundle\s+to\s+(.+?\.xcresult)/i);
      if (xcresultMatch) {
        this.detectedXcresultPath = xcresultMatch[1].trim();
      }

      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Milestone lines — always emitted immediately
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

        // Detect build phases
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
        // Use detected auto-generated path from stderr
        const xcresult = this.detectedXcresultPath;
        if (platform === "ios" && xcresult && existsSync(xcresult)) {
          try {
            errors = parseXcresultErrors(xcresult);
            if (errors.length > 0) {
              this.emit("line", { text: `  📋 Extracted ${errors.length} error(s) from xcresult bundle`, stream: "stdout" });
            }
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

        // Strategy 3: Extract context from raw output
        // When we only have the generic wrapper error, show the last
        // meaningful lines before "Failed to build" for context
        if (errors.length === 0 || errors.every(e => e.summary.includes("exited with error code"))) {
          const rawLines = this.rawOutput.split("\n").map(l => l.trim()).filter(Boolean);
          const contextLines: string[] = [];
          for (let i = rawLines.length - 1; i >= 0 && contextLines.length < 15; i--) {
            const l = rawLines[i];
            // Skip the generic wrapper and empty/decorative lines
            if (l.includes("exited with error code") || l.includes("To debug build logs") || l.length < 3) continue;
            // Capture anything that looks useful
            if (l.includes("error") || l.includes("Error") || l.includes("FAIL") ||
                l.includes("fatal") || l.includes("warning:") || l.includes("note:") ||
                l.includes("Reason:") || l.includes("required") || l.includes("missing") ||
                l.includes("not found") || l.includes("denied") || l.includes("could not") ||
                l.includes("unable to") || l.includes("BUILD FAILED")) {
              contextLines.unshift(l);
            }
          }

          if (contextLines.length > 0 && errors.every(e => e.summary.includes("exited with error code"))) {
            // Replace the generic error with actual context
            errors = contextLines.map(line => ({
              source: (platform === "ios" ? "xcodebuild" : "gradle") as "xcodebuild" | "gradle",
              summary: line.slice(0, 200),
              rawOutput: line,
            }));
          }

          // If still nothing, add the generic fallback
          if (errors.length === 0) {
            errors.push({
              source: platform === "ios" ? "xcodebuild" : "gradle",
              summary: `Build failed with exit code ${code}. Check Xcode for details.`,
              rawOutput: this.rawOutput.slice(-2000),
            });
          }
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
