import { execSync } from "child_process";
import {
  existsSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "fs";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
import type { Platform, RunMode } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CleanStep {
  name: string;
  description: string;
  action: () => Promise<{ success: boolean; output: string }>;
  platform: "ios" | "android" | "all";
  mode: RunMode[];
}

export interface CleanResult {
  step: string;
  success: boolean;
  output: string;
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Helper: run a shell command safely
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  options: { cwd?: string; ignoreFailure?: boolean } = {}
): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { success: true, output: (output ?? "").trim() };
  } catch (err: unknown) {
    if (options.ignoreFailure) {
      const msg =
        err instanceof Error ? err.message : String(err);
      return { success: true, output: msg };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: msg };
  }
}

// ---------------------------------------------------------------------------
// Helper: remove a directory path (no-op if absent)
// ---------------------------------------------------------------------------

function removeDir(
  dirPath: string
): { success: boolean; output: string } {
  try {
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
      return { success: true, output: `Removed ${dirPath}` };
    }
    return { success: true, output: `${dirPath} not found, skipping` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: msg };
  }
}

// ---------------------------------------------------------------------------
// Helper: detect package manager
// ---------------------------------------------------------------------------

export function detectPackageManager(
  projectRoot: string
): "npm" | "yarn" | "pnpm" {
  if (existsSync(join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  return "npm";
}

// ---------------------------------------------------------------------------
// Helper: read bundle ID
// ---------------------------------------------------------------------------

export function readBundleId(
  projectRoot: string,
  platform: Platform
): string | null {
  if (platform === "android" || platform === "both") {
    const buildGradle = join(
      projectRoot,
      "android",
      "app",
      "build.gradle"
    );
    if (existsSync(buildGradle)) {
      try {
        const content = readFileSync(buildGradle, "utf8");
        const match = content.match(/applicationId\s+["']([^"']+)["']/);
        if (match) return match[1];
      } catch {
        // ignore
      }
    }
  }

  if (platform === "ios" || platform === "both") {
    // Try ios/*.xcodeproj/project.pbxproj
    const iosDir = join(projectRoot, "ios");
    if (existsSync(iosDir)) {
      try {
        const entries = readdirSync(iosDir);
        for (const entry of entries) {
          if (entry.endsWith(".xcodeproj")) {
            const pbxproj = join(iosDir, entry, "project.pbxproj");
            if (existsSync(pbxproj)) {
              const content = readFileSync(pbxproj, "utf8");
              const match = content.match(
                /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/
              );
              if (match) return match[1].trim();
            }
          }
        }
      } catch {
        // ignore
      }

      // Fallback: read from ios/*/Info.plist
      try {
        const entries = readdirSync(iosDir);
        for (const entry of entries) {
          const infoPlist = join(iosDir, entry, "Info.plist");
          if (existsSync(infoPlist)) {
            const content = readFileSync(infoPlist, "utf8");
            const match = content.match(
              /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/
            );
            if (match) return match[1].trim();
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Xcode process utilities
// ---------------------------------------------------------------------------

export function isXcodeRunning(): boolean {
  try {
    const output = execSync("pgrep -x Xcode", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return (output ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

export function killXcode(): boolean {
  try {
    execSync("killall Xcode", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Give it up to 5 seconds to exit
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isXcodeRunning()) return true;
    }
    return !isXcodeRunning();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CleanManager
// ---------------------------------------------------------------------------

export class CleanManager {
  constructor(private projectRoot: string) {}

  // -------------------------------------------------------------------------
  // Step definitions
  // -------------------------------------------------------------------------

  private buildAllSteps(): CleanStep[] {
    const root = this.projectRoot;
    const iosDir = join(root, "ios");
    const androidDir = join(root, "android");

    // ------------------------------------------------------------------
    // CLEAN-mode steps (also included in ultra-clean)
    // ------------------------------------------------------------------

    const killWatchman: CleanStep = {
      name: "kill-watchman",
      description: "Kill watchman watches",
      platform: "all",
      mode: ["clean", "ultra-clean"],
      action: async () =>
        run("watchman watch-del-all", { ignoreFailure: true }),
    };

    const removeNodeModules: CleanStep = {
      name: "remove-node-modules",
      description: "Remove node_modules directory",
      platform: "all",
      mode: ["clean", "ultra-clean"],
      action: async () => removeDir(join(root, "node_modules")),
    };

    const clearMetroCache: CleanStep = {
      name: "clear-metro-cache",
      description: "Remove Metro temporary files",
      platform: "all",
      mode: ["clean", "ultra-clean"],
      action: async () => {
        const tmp = tmpdir();
        const results: string[] = [];
        let overallSuccess = true;

        // Remove metro-* and haste-map-* from TMPDIR
        try {
          const entries = readdirSync(tmp);
          for (const entry of entries) {
            if (entry.startsWith("metro-") || entry.startsWith("haste-map-")) {
              const r = removeDir(join(tmp, entry));
              if (!r.success) overallSuccess = false;
              results.push(r.output);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, output: msg };
        }

        return {
          success: overallSuccess,
          output: results.length > 0 ? results.join("\n") : "No Metro cache files found",
        };
      },
    };

    const installDependencies: CleanStep = {
      name: "install-dependencies",
      description: "Install npm/yarn/pnpm dependencies",
      platform: "all",
      mode: ["clean", "ultra-clean"],
      action: async () => {
        const pm = detectPackageManager(root);
        const cmd =
          pm === "yarn"
            ? "yarn install"
            : pm === "pnpm"
            ? "pnpm install"
            : "npm install";
        return run(cmd, { cwd: root });
      },
    };

    const podInstall: CleanStep = {
      name: "pod-install",
      description: "Run pod install",
      platform: "ios",
      mode: ["clean", "ultra-clean"],
      action: async () => run("pod install", { cwd: iosDir }),
    };

    // ------------------------------------------------------------------
    // ULTRA-CLEAN additional steps
    // ------------------------------------------------------------------

    const podDeintegrate: CleanStep = {
      name: "pod-deintegrate",
      description: "Deintegrate CocoaPods",
      platform: "ios",
      mode: ["ultra-clean"],
      action: async () =>
        run("pod deintegrate", { cwd: iosDir, ignoreFailure: true }),
    };

    const removePods: CleanStep = {
      name: "remove-pods",
      description: "Remove Pods directory",
      platform: "ios",
      mode: ["ultra-clean"],
      action: async () => removeDir(join(iosDir, "Pods")),
    };

    const removeDerivedData: CleanStep = {
      name: "remove-derived-data",
      description: "Remove DerivedData (ios/build and Xcode global)",
      platform: "ios",
      mode: ["ultra-clean"],
      action: async () => {
        const r1 = removeDir(join(iosDir, "build"));
        const globalDerivedData = resolve(
          homedir(),
          "Library",
          "Developer",
          "Xcode",
          "DerivedData"
        );
        const r2 = removeDir(globalDerivedData);
        const success = r1.success && r2.success;
        return { success, output: [r1.output, r2.output].join("\n") };
      },
    };

    const gradleStop: CleanStep = {
      name: "gradle-stop",
      description: "Stop Gradle daemon",
      platform: "android",
      mode: ["ultra-clean"],
      action: async () =>
        run("./gradlew --stop", { cwd: androidDir, ignoreFailure: true }),
    };

    const cleanGradleCaches: CleanStep = {
      name: "clean-gradle-caches",
      description: "Clean Gradle caches",
      platform: "android",
      mode: ["ultra-clean"],
      action: async () => {
        const paths = [
          join(androidDir, ".gradle"),
          join(androidDir, "build"),
          join(androidDir, "app", "build"),
        ];
        let overallSuccess = true;
        const outputs: string[] = [];
        for (const p of paths) {
          const r = removeDir(p);
          if (!r.success) overallSuccess = false;
          outputs.push(r.output);
        }
        return { success: overallSuccess, output: outputs.join("\n") };
      },
    };

    const uninstallAndroidApp: CleanStep = {
      name: "uninstall-android-app",
      description: "Uninstall Android app via adb",
      platform: "android",
      mode: ["ultra-clean"],
      action: async () => {
        const bundleId = readBundleId(root, "android");
        if (!bundleId) {
          return { success: true, output: "Bundle ID not found, skipping uninstall" };
        }
        return run(`adb uninstall ${bundleId}`, { ignoreFailure: true });
      },
    };

    const uninstallIosApp: CleanStep = {
      name: "uninstall-ios-app",
      description: "Uninstall iOS app from booted simulator",
      platform: "ios",
      mode: ["ultra-clean"],
      action: async () => {
        const bundleId = readBundleId(root, "ios");
        if (!bundleId) {
          return { success: true, output: "Bundle ID not found, skipping uninstall" };
        }
        return run(`xcrun simctl uninstall booted ${bundleId}`, {
          ignoreFailure: true,
        });
      },
    };

    return [
      // Clean steps (shared)
      killWatchman,
      removeNodeModules,
      clearMetroCache,
      installDependencies,
      // Clean steps (iOS)
      podInstall,
      // Ultra-clean steps (iOS)
      podDeintegrate,
      removePods,
      removeDerivedData,
      uninstallIosApp,
      // Ultra-clean steps (Android)
      gradleStop,
      cleanGradleCaches,
      uninstallAndroidApp,
    ];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getStepsForMode(mode: RunMode, platform: Platform): CleanStep[] {
    if (mode === "dirty") {
      return [];
    }

    const allSteps = this.buildAllSteps();

    return allSteps.filter((step) => {
      // Must be included in this mode
      if (!step.mode.includes(mode)) {
        return false;
      }
      // Must apply to the given platform
      if (step.platform === "all") {
        return true;
      }
      if (platform === "both") {
        return true; // include ios and android steps
      }
      return step.platform === platform;
    });
  }

  async execute(
    mode: RunMode,
    platform: Platform,
    onProgress?: (step: string, status: string) => void
  ): Promise<CleanResult[]> {
    const steps = this.getStepsForMode(mode, platform);
    const results: CleanResult[] = [];

    for (const step of steps) {
      onProgress?.(step.name, "running");

      let result: CleanResult;
      try {
        const outcome = await step.action();
        result = {
          step: step.name,
          success: outcome.success,
          output: outcome.output,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          step: step.name,
          success: false,
          output: msg,
        };
      }

      results.push(result);
    }

    return results;
  }
}
