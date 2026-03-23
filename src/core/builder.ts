import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { parseXcodebuildErrors, parseGradleErrors } from "./build-parser.js";
import type { BuildError } from "./types.js";

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

    this.emit("line", { text: `⏳ Building for ${platform}...`, stream: "stdout" });
    this.emit("line", { text: `  npx ${args.join(" ")}`, stream: "stdout" });
    this.emit("line", { text: "", stream: "stdout" });

    this.rawOutput = "";

    const child = spawn("npx", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.process = child;

    const handleData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString();
      this.rawOutput += text;

      const lines = text.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;

        // Detect build phases for progress
        if (line.includes("Compiling") || line.includes("CompileC")) {
          this.emit("progress", { phase: "Compiling" });
        } else if (line.includes("Linking") || line.includes("Ld ")) {
          this.emit("progress", { phase: "Linking" });
        } else if (line.includes("Installing") || line.includes("install")) {
          this.emit("progress", { phase: "Installing" });
        } else if (line.includes("Launching") || line.includes("launch")) {
          this.emit("progress", { phase: "Launching" });
        } else if (line.includes("BUILD SUCCESSFUL") || line.includes("Build Succeeded")) {
          this.emit("progress", { phase: "Build Succeeded" });
        }

        this.emit("line", { text: line, stream });
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
