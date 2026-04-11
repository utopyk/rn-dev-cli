import path from "path";
import fs, { existsSync, rmSync } from "fs";
import { EventEmitter } from "events";
import { type Subprocess } from "bun";
import { parseXcodebuildErrors, parseGradleErrors, parseXcresultErrors } from "./build-parser.js";

function resolveRnBin(projectRoot: string): [string, ...string[]] {
  const localBin = path.join(projectRoot, "node_modules", ".bin", "react-native");
  if (fs.existsSync(localBin)) {
    return [localBin];
  }
  return ["npx", "react-native"];
}
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
  private process: Subprocess | null = null;
  private rawOutput = "";
  private xcresultPath: string | null = null;
  private detectedXcresultPath: string | null = null;

  build(options: BuildOptions): void {
    const { projectRoot, platform, deviceId, port, variant, env } = options;

    const args = [`run-${platform}`, "--port", String(port)];

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

    const [cmd, ...cmdPrefix] = resolveRnBin(projectRoot);

    this.emit("progress", { phase: "Building" });
    this.emit("line", { text: `Building for ${platform}...`, stream: "stdout" });
    this.emit("line", { text: `  ${cmd} ${[...cmdPrefix, ...args].join(" ")}`, stream: "stdout" });

    this.rawOutput = "";

    // Always write build output to a file for debugging
    const buildLogPath = `/tmp/rn-dev-logs/build-${platform}.log`;
    try { require("fs").mkdirSync("/tmp/rn-dev-logs", { recursive: true }); } catch {}
    try { require("fs").writeFileSync(buildLogPath, `Build started: ${new Date().toISOString()}\n${cmd} ${[...cmdPrefix, ...args].join(" ")}\n\n`); } catch {}

    let proc: Subprocess;
    try {
      proc = Bun.spawn([cmd, ...cmdPrefix, ...args], {
        cwd: projectRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...env },
      });
    } catch (err: any) {
      this.emit("done", {
        success: false,
        errors: [{
          source: platform === "ios" ? "xcodebuild" : "gradle",
          summary: `Failed to spawn build process: ${err.message}`,
          rawOutput: err.message,
        }],
      });
      return;
    }

    this.process = proc;

    // Async stream reader — non-blocking, yields to event loop
    const readStream = async (stream: ReadableStream<Uint8Array> | null, streamName: "stdout" | "stderr") => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = stripAnsi(decoder.decode(value, { stream: true }));
          this.rawOutput += text;
          try { require("fs").appendFileSync(buildLogPath, text); } catch {}

          // Detect xcresult bundle path
          const xcresultMatch = text.match(/(?:Writing|Wrote)\s+(?:error\s+)?result\s+bundle\s+to\s+(.+?\.xcresult)/i);
          if (xcresultMatch) {
            this.detectedXcresultPath = xcresultMatch[1].trim();
          }

          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

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
              /^\/.+:\d+:\d+: (error|fatal error):/.test(trimmed) ||
              // xcbeautify emoji-prefixed errors and warnings
              trimmed.startsWith("❌") ||
              trimmed.startsWith("⚠️") ||
              trimmed.includes("ld: symbol(s) not found") ||
              trimmed.includes("ld: Could not find") ||
              trimmed.includes("linker command failed") ||
              trimmed.includes("clang: error") ||
              trimmed.includes("not found for architecture") ||
              trimmed.includes("framework not found");

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
              this.emit("line", { text: trimmed, stream: streamName, replace: false });
            } else {
              this.emit("line", { text: `  ${trimmed.slice(0, 100)}`, stream: streamName, replace: true });
            }
          }
        }
      } catch {
        // Stream closed
      }
    };

    readStream(proc.stdout as ReadableStream<Uint8Array>, "stdout");
    readStream(proc.stderr as ReadableStream<Uint8Array>, "stderr");

    proc.exited.then((code) => {
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
  }

  cancel(): void {
    if (this.process) {
      try {
        process.kill(-this.process.pid, "SIGKILL");
      } catch {
        try {
          this.process.kill();
        } catch {}
      }
      this.process = null;
    }
  }

  get isBuilding(): boolean {
    return this.process !== null;
  }
}
