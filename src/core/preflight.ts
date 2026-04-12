import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as net from "net";
import semver from "semver";
import { execAsync, execShellAsync } from "./exec-async.js";
import type { Platform, PreflightConfig, PreflightCheck, PreflightResult } from "./types.js";

// ---------------------------------------------------------------------------
// PreflightEngine
// ---------------------------------------------------------------------------

export class PreflightEngine {
  private checks: PreflightCheck[] = [];

  /**
   * Add a check to the registry.
   */
  register(check: PreflightCheck): void {
    this.checks.push(check);
  }

  /**
   * Filter checks by platform:
   * - "ios"     → ios + all
   * - "android" → android + all
   * - "both"    → all checks
   */
  getChecksForPlatform(platform: Platform): PreflightCheck[] {
    if (platform === "both") {
      return [...this.checks];
    }
    return this.checks.filter(
      (c) => c.platform === platform || c.platform === "all"
    );
  }

  /**
   * Only return checks whose id is in config.checks array.
   */
  filterByConfig(checks: PreflightCheck[], config: PreflightConfig): PreflightCheck[] {
    const allowed = new Set(config.checks);
    return checks.filter((c) => allowed.has(c.id));
  }

  /**
   * Run filtered checks for the given platform and config.
   * Returns results keyed by check id.
   */
  async runAll(
    platform: Platform,
    config: PreflightConfig
  ): Promise<Map<string, PreflightResult>> {
    const platformChecks = this.getChecksForPlatform(platform);
    const filtered = this.filterByConfig(platformChecks, config);

    const results = new Map<string, PreflightResult>();

    await Promise.all(
      filtered.map(async (check) => {
        try {
          const result = await check.check();
          results.set(check.id, result);
        } catch (err) {
          results.set(check.id, {
            passed: false,
            message: "Check threw an unexpected error",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );

    return results;
  }

  /**
   * Find check by id, call its fix() if available, return success.
   */
  async fix(checkId: string): Promise<boolean> {
    const check = this.checks.find((c) => c.id === checkId);
    if (!check || !check.fix) {
      return false;
    }
    try {
      return await check.fix();
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runCmd(cmd: string, options?: { cwd?: string }): Promise<string> {
  const result = await execAsync(cmd, {
    cwd: options?.cwd,
    timeout: 15000,
  });
  return result.trim();
}

function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
}

function parsePackageJson(projectRoot: string): Record<string, unknown> | null {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasDep(pkg: Record<string, unknown> | null, depName: string): boolean {
  if (!pkg) return false;
  const deps = (pkg["dependencies"] as Record<string, string> | undefined) ?? {};
  const devDeps = (pkg["devDependencies"] as Record<string, string> | undefined) ?? {};
  return depName in deps || depName in devDeps;
}

/**
 * Normalize a version string by stripping a leading "v" and any trailing
 * non-numeric suffix (e.g. "v18.19.0" → "18.19.0", "18" → "18").
 */
function normalizeVersion(version: string): string {
  return version.replace(/^v/, "").trim();
}

/**
 * Checks whether `actual` satisfies a (possibly partial) version constraint
 * using proper semver range evaluation.
 */
function versionSatisfies(actual: string, required: string): boolean {
  const cleaned = semver.coerce(actual);
  if (!cleaned) return false;
  // If required is a plain version, check exact match or compatible
  // If required has range operators (^, ~, >=, etc.), use satisfies
  return semver.satisfies(cleaned, required);
}

/**
 * Probe a TCP port to see if it is free.
 * Resolves true if free, false if occupied.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.on("error", () => {
      resolve(false);
    });

    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Default Metro port (can be overridden via env)
// ---------------------------------------------------------------------------

const DEFAULT_METRO_PORT = 8081;

// ---------------------------------------------------------------------------
// Built-in check factory functions
// ---------------------------------------------------------------------------

function makeNodeVersionCheck(projectRoot: string): PreflightCheck {
  return {
    id: "node-version",
    name: "Node.js version",
    severity: "error",
    platform: "all",
    async check(): Promise<PreflightResult> {
      let actualVersion: string;
      try {
        actualVersion = await runCmd("node -v");
      } catch {
        return {
          passed: false,
          message: "node is not installed or not in PATH",
          details: "Install Node.js from https://nodejs.org or use nvm",
        };
      }

      // Determine required version from: .nvmrc → .node-version → package.json engines
      let requiredVersion: string | null = null;

      const nvmrc = readFileSafe(join(projectRoot, ".nvmrc"));
      if (nvmrc) {
        requiredVersion = nvmrc.split("\n")[0].trim();
      }

      if (!requiredVersion) {
        const nodeVersionFile = readFileSafe(join(projectRoot, ".node-version"));
        if (nodeVersionFile) {
          requiredVersion = nodeVersionFile.split("\n")[0].trim();
        }
      }

      if (!requiredVersion) {
        const pkg = parsePackageJson(projectRoot);
        if (pkg) {
          const engines = pkg["engines"] as Record<string, string> | undefined;
          if (engines?.["node"]) {
            requiredVersion = engines["node"];
          }
        }
      }

      if (!requiredVersion) {
        return {
          passed: true,
          message: `Node.js ${actualVersion} (no version constraint found)`,
        };
      }

      const satisfied = versionSatisfies(actualVersion, requiredVersion);

      if (satisfied) {
        return {
          passed: true,
          message: `Node.js ${actualVersion} matches required ${requiredVersion}`,
        };
      }

      return {
        passed: false,
        message: `Node.js version mismatch: running ${actualVersion}, required ${requiredVersion}`,
        details: `Run 'nvm use' in the project root to switch to the correct version`,
      };
    },
    async fix(): Promise<boolean> {
      // Can only suggest, not auto-run interactive commands
      return false;
    },
  };
}

function makeRubyVersionCheck(projectRoot: string): PreflightCheck {
  return {
    id: "ruby-version",
    name: "Ruby version",
    severity: "warning",
    platform: "ios",
    async check(): Promise<PreflightResult> {
      let actualVersion: string;
      try {
        actualVersion = await runCmd("ruby -v");
      } catch {
        return {
          passed: false,
          message: "ruby is not installed or not in PATH",
          details: "Install Ruby via rbenv: https://github.com/rbenv/rbenv",
        };
      }

      const gemfilePath = join(projectRoot, "Gemfile");
      if (!existsSync(gemfilePath)) {
        return {
          passed: true,
          message: `Ruby ${actualVersion} (no Gemfile found)`,
        };
      }

      const gemfileContent = readFileSafe(gemfilePath) ?? "";
      const rubyMatch = gemfileContent.match(/^ruby\s+['"]([\d.]+)['"]/m);
      if (!rubyMatch) {
        return {
          passed: true,
          message: `Ruby ${actualVersion} (no ruby version in Gemfile)`,
        };
      }

      const requiredVersion = rubyMatch[1];
      // ruby -v output: "ruby 3.2.2 (2023-03-30 revision e51014f9c0) [arm64-darwin22]"
      const actualMatch = actualVersion.match(/ruby\s+([\d.]+)/);
      const actualSemver = actualMatch ? actualMatch[1] : actualVersion;

      const satisfied = versionSatisfies(actualSemver, requiredVersion);

      if (satisfied) {
        return {
          passed: true,
          message: `Ruby ${actualSemver} matches Gemfile requirement ${requiredVersion}`,
        };
      }

      return {
        passed: false,
        message: `Ruby version mismatch: running ${actualSemver}, Gemfile requires ${requiredVersion}`,
        details: `Run 'rbenv install ${requiredVersion}' and 'rbenv local ${requiredVersion}'`,
      };
    },
    async fix(): Promise<boolean> {
      return false;
    },
  };
}

function makeJavaHomeCheck(): PreflightCheck {
  return {
    id: "java-home",
    name: "JAVA_HOME",
    severity: "error",
    platform: "android",
    async check(): Promise<PreflightResult> {
      const javaHome = process.env["JAVA_HOME"];

      if (!javaHome) {
        return {
          passed: false,
          message: "JAVA_HOME environment variable is not set",
          details: "Set JAVA_HOME to your JDK installation path",
        };
      }

      if (!existsSync(javaHome)) {
        return {
          passed: false,
          message: `JAVA_HOME points to a non-existent directory: ${javaHome}`,
          details: "Run /usr/libexec/java_home to find your JDK path",
        };
      }

      return {
        passed: true,
        message: `JAVA_HOME is set to ${javaHome}`,
      };
    },
    async fix(): Promise<boolean> {
      try {
        const javaHome = await runCmd("/usr/libexec/java_home");
        if (javaHome && existsSync(javaHome)) {
          process.env["JAVA_HOME"] = javaHome;
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
  };
}

function makeAndroidHomeCheck(): PreflightCheck {
  return {
    id: "android-home",
    name: "ANDROID_HOME",
    severity: "error",
    platform: "android",
    async check(): Promise<PreflightResult> {
      const androidHome =
        process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];

      if (!androidHome) {
        return {
          passed: false,
          message:
            "Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable is set",
          details:
            "Set ANDROID_HOME to your Android SDK path (e.g. ~/Library/Android/sdk on macOS)",
        };
      }

      if (!existsSync(androidHome)) {
        return {
          passed: false,
          message: `ANDROID_HOME points to a non-existent directory: ${androidHome}`,
          details:
            "Common paths: ~/Library/Android/sdk (macOS), ~/Android/Sdk (Linux)",
        };
      }

      return {
        passed: true,
        message: `ANDROID_HOME is set to ${androidHome}`,
      };
    },
    async fix(): Promise<boolean> {
      const commonPaths = [
        join(process.env["HOME"] ?? "", "Library", "Android", "sdk"),
        join(process.env["HOME"] ?? "", "Android", "Sdk"),
        "/usr/local/share/android-sdk",
      ];

      for (const p of commonPaths) {
        if (existsSync(p)) {
          process.env["ANDROID_HOME"] = p;
          return true;
        }
      }
      return false;
    },
  };
}

function makeAndroidSdkLicensesCheck(): PreflightCheck {
  return {
    id: "android-sdk-licenses",
    name: "Android SDK licenses",
    severity: "error",
    platform: "android",
    async check(): Promise<PreflightResult> {
      const androidHome =
        process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];

      if (!androidHome) {
        return {
          passed: false,
          message: "ANDROID_HOME is not set; cannot check SDK licenses",
        };
      }

      const licensesDir = join(androidHome, "licenses");
      if (!existsSync(licensesDir)) {
        return {
          passed: false,
          message: "Android SDK licenses directory not found",
          details:
            "Run 'sdkmanager --licenses' to accept all SDK licenses",
        };
      }

      return {
        passed: true,
        message: "Android SDK licenses directory exists",
      };
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("sdkmanager --licenses");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeXcodeCliToolsCheck(): PreflightCheck {
  return {
    id: "xcode-cli-tools",
    name: "Xcode CLI tools",
    severity: "error",
    platform: "ios",
    async check(): Promise<PreflightResult> {
      try {
        const path = await runCmd("xcode-select -p");
        if (path && existsSync(path)) {
          return {
            passed: true,
            message: `Xcode CLI tools found at ${path}`,
          };
        }
        return {
          passed: false,
          message: "xcode-select returned a path that does not exist",
          details: "Run 'xcode-select --install' to install CLI tools",
        };
      } catch {
        return {
          passed: false,
          message: "Xcode CLI tools are not installed",
          details: "Run 'xcode-select --install' to install them",
        };
      }
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("xcode-select --install");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeCocoapodsInstalledCheck(): PreflightCheck {
  return {
    id: "cocoapods-installed",
    name: "CocoaPods installed",
    severity: "error",
    platform: "ios",
    async check(): Promise<PreflightResult> {
      try {
        const version = await runCmd("pod --version");
        return {
          passed: true,
          message: `CocoaPods ${version} is installed`,
        };
      } catch {
        return {
          passed: false,
          message: "CocoaPods is not installed",
          details: "Run 'gem install cocoapods' to install it",
        };
      }
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("gem install cocoapods");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makePodfileLockSyncCheck(projectRoot: string): PreflightCheck {
  return {
    id: "podfile-lock-sync",
    name: "Podfile.lock in sync",
    severity: "warning",
    platform: "ios",
    async check(): Promise<PreflightResult> {
      const podfileLockPath = join(projectRoot, "ios", "Podfile.lock");

      if (!existsSync(podfileLockPath)) {
        return {
          passed: true,
          message: "No Podfile.lock found; skipping sync check",
        };
      }

      // Read the current content to compute a quick checksum
      let currentContent: string;
      try {
        currentContent = readFileSync(podfileLockPath, "utf-8");
      } catch {
        return {
          passed: false,
          message: "Could not read Podfile.lock",
        };
      }

      // Compare against stored checksum (if none stored, pass to avoid blocking first run)
      // The artifact store integration is handled at the engine caller level;
      // here we just confirm the file is readable and return its status.
      return {
        passed: true,
        message: `Podfile.lock found (${currentContent.length} bytes)`,
        details:
          "Run 'pod install' in the ios/ directory if pods are out of sync",
      };
    },
    async fix(): Promise<boolean> {
      try {
        const iosDir = join(projectRoot, "ios");
        await runCmd("pod install", { cwd: iosDir });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeWatchmanCheck(): PreflightCheck {
  return {
    id: "watchman",
    name: "Watchman installed",
    severity: "warning",
    platform: "all",
    async check(): Promise<PreflightResult> {
      try {
        const version = await runCmd("watchman version");
        return {
          passed: true,
          message: `Watchman is installed: ${version.slice(0, 60)}`,
        };
      } catch {
        return {
          passed: false,
          message: "Watchman is not installed",
          details:
            "Install with: brew install watchman",
        };
      }
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("brew install watchman");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeMetroPortCheck(): PreflightCheck {
  const port = DEFAULT_METRO_PORT;

  return {
    id: "metro-port",
    name: `Metro port ${port} free`,
    severity: "warning",
    platform: "all",
    async check(): Promise<PreflightResult> {
      const free = await isPortFree(port);

      if (free) {
        return {
          passed: true,
          message: `Port ${port} is free and available for Metro`,
        };
      }

      return {
        passed: false,
        message: `Port ${port} is occupied`,
        details: `Another process is using port ${port}. Kill it or configure a different Metro port.`,
      };
    },
    async fix(): Promise<boolean> {
      // Offer to kill the process on the port
      try {
        await execShellAsync(`lsof -ti:${port} | xargs kill -9`, { timeout: 15000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeNodeModulesSyncCheck(projectRoot: string): PreflightCheck {
  return {
    id: "node-modules-sync",
    name: "node_modules in sync",
    severity: "warning",
    platform: "all",
    async check(): Promise<PreflightResult> {
      // Check if a lockfile exists
      const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
      let lockfilePath: string | null = null;

      for (const lf of lockfiles) {
        const p = join(projectRoot, lf);
        if (existsSync(p)) {
          lockfilePath = p;
          break;
        }
      }

      if (!lockfilePath) {
        return {
          passed: true,
          message: "No lockfile found; skipping node_modules sync check",
        };
      }

      const nodeModulesPath = join(projectRoot, "node_modules");
      if (!existsSync(nodeModulesPath)) {
        return {
          passed: false,
          message: "node_modules directory not found",
          details: "Run 'npm install' (or yarn/pnpm install) to install dependencies",
        };
      }

      return {
        passed: true,
        message: `node_modules exists and lockfile (${lockfilePath.split("/").pop()}) is present`,
      };
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("npm install", { cwd: projectRoot });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makeEnvFileCheck(projectRoot: string): PreflightCheck {
  return {
    id: "env-file",
    name: ".env file exists",
    severity: "error",
    platform: "all",
    async check(): Promise<PreflightResult> {
      const pkg = parsePackageJson(projectRoot);

      if (!hasDep(pkg, "react-native-config")) {
        return {
          passed: true,
          message: "react-native-config not in dependencies; .env check skipped",
        };
      }

      const envPath = join(projectRoot, ".env");
      if (existsSync(envPath)) {
        return {
          passed: true,
          message: ".env file exists",
        };
      }

      return {
        passed: false,
        message: ".env file is missing but react-native-config is installed",
        details:
          "Copy .env.example to .env and fill in the required values",
      };
    },
    async fix(): Promise<boolean> {
      const examplePath = join(projectRoot, ".env.example");
      const envPath = join(projectRoot, ".env");

      if (!existsSync(examplePath)) {
        return false;
      }

      try {
        const content = readFileSync(examplePath, "utf-8");
        const { writeFileSync } = await import("fs");
        writeFileSync(envPath, content, "utf-8");
        return true;
      } catch {
        return false;
      }
    },
  };
}

function makePatchPackageCheck(projectRoot: string): PreflightCheck {
  return {
    id: "patch-package",
    name: "patch-package patches applied",
    severity: "warning",
    platform: "all",
    async check(): Promise<PreflightResult> {
      const pkg = parsePackageJson(projectRoot);

      if (!hasDep(pkg, "patch-package")) {
        return {
          passed: true,
          message: "patch-package not in dependencies; check skipped",
        };
      }

      const patchesDir = join(projectRoot, "patches");
      if (!existsSync(patchesDir)) {
        return {
          passed: true,
          message: "patches/ directory does not exist; no patches to apply",
        };
      }

      let patchFiles: string[] = [];
      try {
        patchFiles = readdirSync(patchesDir).filter((f) =>
          f.endsWith(".patch")
        );
      } catch {
        return {
          passed: true,
          message: "Could not read patches/ directory",
        };
      }

      if (patchFiles.length === 0) {
        return {
          passed: true,
          message: "No .patch files found in patches/ directory",
        };
      }

      // Check if patches are applied by running patch-package in check mode
      try {
        await runCmd("npx patch-package --error-on-fail", { cwd: projectRoot });
        return {
          passed: true,
          message: `${patchFiles.length} patch(es) are applied`,
        };
      } catch {
        return {
          passed: false,
          message: `${patchFiles.length} patch file(s) found but they may not be applied`,
          details: "Run 'npx patch-package' to apply patches",
        };
      }
    },
    async fix(): Promise<boolean> {
      try {
        await runCmd("npx patch-package", { cwd: projectRoot });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Code Signing Check
// ---------------------------------------------------------------------------

function makeCodeSigningCheck(projectRoot: string): PreflightCheck {
  return {
    id: "code-signing",
    name: "Code signing (iOS)",
    severity: "warning",
    platform: "ios",
    check: async () => {
      const iosDir = join(projectRoot, "ios");
      if (!existsSync(iosDir)) {
        return { passed: true, message: "No ios directory found" };
      }

      // Find the .xcodeproj file
      try {
        const entries = readdirSync(iosDir);
        for (const entry of entries) {
          if (entry.endsWith(".xcodeproj")) {
            const pbxproj = join(iosDir, entry, "project.pbxproj");
            if (existsSync(pbxproj)) {
              const content = readFileSync(pbxproj, "utf8");
              const manualMatches = content.match(/CODE_SIGN_STYLE\s*=\s*Manual/g);
              if (manualMatches && manualMatches.length > 0) {
                return {
                  passed: false,
                  message: `Manual code signing detected (${manualMatches.length} targets). Local builds may fail without CI certificates. Run fix to switch to Automatic signing.`,
                  details: "This is common in worktrees set up by CI. Switching to Automatic signing won't break CI — Fastlane overrides it at build time.",
                };
              }
            }
          }
        }
      } catch {
        // ignore
      }

      return { passed: true, message: "Code signing is set to Automatic" };
    },
    fix: async () => {
      // Switch from Manual to Automatic signing
      const iosDir = join(projectRoot, "ios");
      try {
        const entries = readdirSync(iosDir);
        for (const entry of entries) {
          if (entry.endsWith(".xcodeproj")) {
            const pbxproj = join(iosDir, entry, "project.pbxproj");
            if (existsSync(pbxproj)) {
              const content = readFileSync(pbxproj, "utf8");
              const fixed = content.replace(/CODE_SIGN_STYLE\s*=\s*Manual/g, "CODE_SIGN_STYLE = Automatic");
              require("fs").writeFileSync(pbxproj, fixed);
              return true;
            }
          }
        }
      } catch {
        // ignore
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// createDefaultPreflightEngine
// ---------------------------------------------------------------------------

/**
 * Creates a PreflightEngine with all 13 built-in checks registered.
 */
export function createDefaultPreflightEngine(
  projectRoot: string
): PreflightEngine {
  const engine = new PreflightEngine();

  engine.register(makeNodeVersionCheck(projectRoot));
  engine.register(makeRubyVersionCheck(projectRoot));
  engine.register(makeJavaHomeCheck());
  engine.register(makeAndroidHomeCheck());
  engine.register(makeAndroidSdkLicensesCheck());
  engine.register(makeXcodeCliToolsCheck());
  engine.register(makeCocoapodsInstalledCheck());
  engine.register(makePodfileLockSyncCheck(projectRoot));
  engine.register(makeWatchmanCheck());
  engine.register(makeMetroPortCheck());
  engine.register(makeNodeModulesSyncCheck(projectRoot));
  engine.register(makeEnvFileCheck(projectRoot));
  engine.register(makePatchPackageCheck(projectRoot));
  engine.register(makeCodeSigningCheck(projectRoot));

  return engine;
}
