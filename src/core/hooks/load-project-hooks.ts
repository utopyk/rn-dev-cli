// Phase H1i — Phase 2 of the three-phase boot. Locates the project's
// `rn-dev.config.{mjs,mts,ts,js}`, dynamically imports + validates it
// via `@rn-dev/config`'s `loadConfig` (TOCTOU realpath check), then
// walks `config.hooks` and feeds each entry into the supplied
// HookManager.
//
// Failures are NOT fatal — a missing or invalid config emits a warning
// line via `opts.emit` and the boot continues with zero project
// registrations. Per-entry resolve failures (e.g. script outside the
// project) are also non-fatal: the offending entry is skipped and a
// warning is emitted, so a typo doesn't take down the daemon.

import { existsSync } from "node:fs";
import path from "node:path";
import type {
  HookEntry,
  HookPhase,
  HookRegistrations,
  RnDevConfig,
} from "@rn-dev/config";
import { resolveHookScript } from "./path-resolver.js";
import type { HookManager } from "./manager.js";

const PROJECT_CONFIG_BASENAMES = [
  "rn-dev.config.mjs",
  "rn-dev.config.mts",
  "rn-dev.config.ts",
  "rn-dev.config.js",
] as const;

export interface LoadProjectHooksOptions {
  hookManager: HookManager;
  projectRoot: string;
  emit: (line: string) => void;
  /** Test seam — replaces the dynamic `loadConfig` import. */
  loadConfigFn?: (
    filePath: string,
    options: { projectRoot: string },
  ) => Promise<RnDevConfig>;
}

export interface LoadProjectHooksResult {
  configFile: string | null;
  registered: number;
  skipped: number;
}

export async function loadProjectHooks(
  opts: LoadProjectHooksOptions,
): Promise<LoadProjectHooksResult> {
  const configFile = findProjectConfigFile(opts.projectRoot);
  if (configFile === null) {
    return { configFile: null, registered: 0, skipped: 0 };
  }

  const loadConfig =
    opts.loadConfigFn ??
    ((filePath: string, options: { projectRoot: string }) =>
      import("@rn-dev/config").then((m) => m.loadConfig(filePath, options)));

  let config: RnDevConfig;
  try {
    config = await loadConfig(configFile, { projectRoot: opts.projectRoot });
  } catch (err) {
    opts.emit(
      `\u26a0 Failed to load ${path.basename(configFile)}: ${
        err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
      }`,
    );
    return { configFile, registered: 0, skipped: 0 };
  }

  const hooks: HookRegistrations | undefined = config.hooks;
  if (hooks === undefined) {
    return { configFile, registered: 0, skipped: 0 };
  }

  const configDir = path.dirname(configFile);
  let registered = 0;
  let skipped = 0;
  for (const [target, entry] of Object.entries(hooks)) {
    if (entry === undefined) continue;
    try {
      await registerProjectHook({
        target: target as HookPhase,
        entry,
        configFile,
        configDir,
        hookManager: opts.hookManager,
      });
      registered++;
    } catch (err) {
      skipped++;
      opts.emit(
        `\u26a0 Skipping hook ${target}: ${
          err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
        }`,
      );
    }
  }
  if (registered > 0) {
    opts.emit(
      `\u2139 Registered ${registered} project hook${registered === 1 ? "" : "s"} from ${path.basename(configFile)}`,
    );
  }
  return { configFile, registered, skipped };
}

async function registerProjectHook(input: {
  target: HookPhase;
  entry: HookEntry;
  configFile: string;
  configDir: string;
  hookManager: HookManager;
}): Promise<void> {
  // Normalize the discriminated entry: shorthand string → script entry.
  const entry: HookEntry =
    typeof input.entry === "string" ? { script: input.entry } : input.entry;

  if ("fn" in entry && entry.fn !== undefined) {
    await input.hookManager.addRegistration({
      target: input.target,
      source: { kind: "project", configPath: input.configFile },
      entry,
      resolved: {
        kind: "fn",
        symbol: `project:${input.target}`,
        fn: entry.fn,
      },
    });
    return;
  }
  if ("script" in entry && entry.script !== undefined) {
    const resolved = resolveHookScript(entry.script, input.configDir);
    await input.hookManager.addRegistration({
      target: input.target,
      source: { kind: "project", configPath: input.configFile },
      entry,
      resolved: { kind: "script", script: resolved },
    });
    return;
  }
  throw new Error(
    `project hook ${input.target} declared neither fn nor script`,
  );
}

function findProjectConfigFile(projectRoot: string): string | null {
  for (const basename of PROJECT_CONFIG_BASENAMES) {
    const candidate = path.join(projectRoot, basename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
