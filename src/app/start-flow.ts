import path from "path";
import { execSync } from "child_process";
import React from "react";
import { createCliRenderer, VignetteEffect, applyScanlines } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { detectProjectRoot, getCurrentBranch } from "../core/project.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { MetroManager } from "../core/metro.js";
import { CleanManager } from "../core/clean.js";
import { FileWatcher } from "../core/watcher.js";
import { IpcServer } from "../core/ipc.js";
import { loadTheme, getThemeEffects } from "../ui/theme-provider.js";
import {
  ModuleRegistry,
  devSpaceModule,
  settingsModule,
  lintTestModule,
  metroLogsModule,
} from "../modules/index.js";
import { firstRunSetup } from "./first-run.js";
import { App } from "./App.js";
import type { Profile, Platform, RunMode } from "../core/types.js";

// ---------------------------------------------------------------------------
// StartOptions
// ---------------------------------------------------------------------------

export interface StartOptions {
  interactive?: boolean;
  profile?: string;
  worktree?: string;
  platform?: string;
  mode?: string;
  port?: number;
  theme?: string;
}

// ---------------------------------------------------------------------------
// startFlow — the main orchestrator for `rn-dev start`
// ---------------------------------------------------------------------------

export async function startFlow(options: StartOptions): Promise<void> {
  // 1. Detect project root
  const projectRoot = detectProjectRoot(process.cwd());
  if (!projectRoot) {
    console.error("Not inside a React Native project");
    process.exit(1);
  }

  // 2. First-run check
  await firstRunSetup(projectRoot);

  // 3. Initialize stores
  const profileStore = new ProfileStore(
    path.join(projectRoot, ".rn-dev", "profiles")
  );
  const artifactStore = new ArtifactStore(
    path.join(projectRoot, ".rn-dev", "artifacts")
  );

  // 4. Load theme
  const themeName = options.theme ?? "midnight";
  const theme = loadTheme(themeName);
  const effects = getThemeEffects(themeName);

  // 5. Register modules
  const registry = new ModuleRegistry();
  registry.register(devSpaceModule);
  registry.register(lintTestModule);
  registry.register(metroLogsModule);
  registry.register(settingsModule);

  // 6. Determine if we need the wizard
  let profile: Profile | undefined;
  let needsWizard = false;

  if (options.interactive) {
    needsWizard = true;
  } else if (options.profile) {
    const loaded = profileStore.load(options.profile);
    if (!loaded) {
      console.error(`Profile "${options.profile}" not found`);
      process.exit(1);
    }
    profile = loaded;
  } else {
    // Try to find default profile for current worktree+branch
    const branch = getCurrentBranch(projectRoot) ?? "main";
    const worktree: string | null = null;
    const defaultProfile = profileStore.findDefault(worktree, branch);
    if (defaultProfile) {
      profile = defaultProfile;
    } else {
      // No profile found — need wizard
      needsWizard = true;
    }
  }

  // Apply CLI overrides if we already have a profile
  if (profile) {
    if (options.platform) profile.platform = options.platform as Platform;
    if (options.mode) profile.mode = options.mode as RunMode;
    if (options.port) profile.metroPort = options.port;
  }

  // 7. Declare service references (populated after initial render)
  let metro: MetroManager | undefined;
  let watcher: FileWatcher | null = null;
  let ipc: IpcServer | undefined;
  let worktreeKey: string | undefined;
  let startupLog: string[] = [];
  let builder: import("../core/builder.js").Builder | undefined;

  // 8. Create OpenTUI renderer FIRST so TUI appears immediately
  const vignetteEffect = new VignetteEffect(effects.vignetteStrength);

  const renderer = await createCliRenderer({
    backgroundColor: theme.colors.bg,
    useMouse: true,
    exitOnCtrlC: true,
    targetFps: 60,
    postProcessFns: [
      (buffer: any) => vignetteEffect.apply(buffer),
      (buffer: any) => applyScanlines(buffer, effects.scanlineOpacity, effects.scanlineSpacing),
    ],
  });

  const root = createRoot(renderer);

  // Helper to render the app with given props
  function renderApp(appProps: Record<string, unknown>): void {
    root.render(React.createElement(App, appProps));
  }

  // 9. Render single OpenTUI instance — either wizard or TUI
  renderApp({
    theme,
    registry,
    wizardMode: needsWizard,
    projectRoot,
    profile,
    metro,
    watcher,
    worktreeKey,
    startupLog,
    builder,
    onWizardComplete: async (wizardProfile: Profile) => {
      // Save the profile
      const fullProfile: Profile = {
        name: wizardProfile.name ?? `profile-${Date.now()}`,
        isDefault: wizardProfile.isDefault ?? true,
        worktree: wizardProfile.worktree ?? null,
        branch:
          wizardProfile.branch ??
          (getCurrentBranch(projectRoot) ?? "main"),
        platform: wizardProfile.platform ?? "both",
        mode: wizardProfile.mode ?? "clean",
        metroPort: wizardProfile.metroPort ?? 8081,
        devices: wizardProfile.devices ?? {},
        buildVariant: wizardProfile.buildVariant ?? "debug",
        preflight: wizardProfile.preflight ?? {
          checks: [],
          frequency: "once",
        },
        onSave: wizardProfile.onSave ?? [],
        env: wizardProfile.env ?? {},
        projectRoot,
      };

      // Apply CLI overrides
      if (options.platform)
        fullProfile.platform = options.platform as Platform;
      if (options.mode) fullProfile.mode = options.mode as RunMode;
      if (options.port) fullProfile.metroPort = options.port;

      profileStore.save(fullProfile);

      // Start services with the new profile
      const result = await startServices(
        fullProfile,
        projectRoot,
        artifactStore
      );

      // Re-render with profile and services
      renderApp({
        theme,
        registry,
        wizardMode: false,
        profile: fullProfile,
        metro: result.metro,
        watcher: result.watcher,
        worktreeKey: result.worktreeKey,
        startupLog: result.startupLog,
        builder: result.builder,
      });

      // Trigger build after re-render
      const platformsToBuild: Array<"ios" | "android"> =
        fullProfile.platform === "both" ? ["ios", "android"] : [fullProfile.platform];

      for (const plat of platformsToBuild) {
        const devId = plat === "ios" ? fullProfile.devices?.ios : fullProfile.devices?.android;
        result.builder.build({
          projectRoot: fullProfile.worktree ?? projectRoot,
          platform: plat,
          deviceId: devId ?? undefined,
          port: fullProfile.metroPort,
          variant: fullProfile.buildVariant,
          env: fullProfile.env,
        });
      }
    },
    onWizardCancel: () => {
      process.exit(0);
    },
  });

  // 10. Start services AFTER initial render (so TUI appears immediately)
  if (profile && !needsWizard) {
    // Use setTimeout to let the first frame render before blocking on services
    setTimeout(async () => {
      const result = await startServices(profile, projectRoot, artifactStore);
      metro = result.metro;
      watcher = result.watcher;
      ipc = result.ipc;
      worktreeKey = result.worktreeKey;
      startupLog = result.startupLog;
      builder = result.builder;

      // Re-render with services attached
      renderApp({
        theme,
        registry,
        wizardMode: false,
        profile,
        metro: result.metro,
        watcher: result.watcher,
        worktreeKey: result.worktreeKey,
        startupLog: result.startupLog,
        builder: result.builder,
      });

      // Trigger build
      const platformsToBuild: Array<"ios" | "android"> =
        profile.platform === "both" ? ["ios", "android"] : [profile.platform];
      for (const platform of platformsToBuild) {
        const deviceId = platform === "ios" ? profile.devices?.ios : profile.devices?.android;
        result.builder.build({
          projectRoot: profile.worktree ?? projectRoot,
          platform,
          deviceId: deviceId ?? undefined,
          port: profile.metroPort,
          variant: profile.buildVariant,
          env: profile.env,
        });
      }
    }, 50);
  }

  // (builder and services are started asynchronously in step 10 above)

  // 11. Handle cleanup on exit — must destroy renderer to restore terminal
  const cleanup = (): void => {
    metro?.stopAll();
    watcher?.stop();
    ipc?.stop();
    try {
      root.unmount();
      renderer.destroy();
    } catch {
      // renderer may already be destroyed
    }
    // Explicitly disable mouse reporting and restore terminal
    process.stdout.write("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l");
    process.stdout.write("\x1b[?25h");  // show cursor
    process.stdout.write("\x1b[?1049l"); // exit alternate screen
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Also handle the 'q' key quit from AppContext
  process.on("exit", () => {
    cleanup();
  });
}

// ---------------------------------------------------------------------------
// Helper: start Metro, watcher, IPC
// ---------------------------------------------------------------------------

async function startServices(
  profile: Profile,
  projectRoot: string,
  artifactStore: ArtifactStore,
  log?: (line: string) => void
): Promise<{
  metro: MetroManager;
  watcher: FileWatcher | null;
  ipc: IpcServer;
  worktreeKey: string;
  startupLog: string[];
  builder: import("../core/builder.js").Builder;
}> {
  const logSymbols = await import("log-symbols");
  const sym = logSymbols.default;

  const startupLog: string[] = [];
  const emit = (line: string) => {
    startupLog.push(line);
    if (log) log(line);
  };

  // Run preflights if configured
  if (profile.preflight.checks.length > 0) {
    const artifact = artifactStore.load(
      artifactStore.worktreeHash(profile.worktree)
    );
    const needsPreflight =
      profile.preflight.frequency === "always" || !artifact?.preflightPassed;

    if (needsPreflight) {
      emit("\u23f3 Running preflight checks...");
      const { createDefaultPreflightEngine } = await import(
        "../core/preflight.js"
      );
      const engine = createDefaultPreflightEngine(projectRoot);
      const results = await engine.runAll(profile.platform, profile.preflight);

      let hasErrors = false;
      for (const [id, result] of results) {
        const icon = result.passed ? sym.success : sym.error;
        emit(`  ${icon} ${id}: ${result.message}`);
        if (!result.passed) hasErrors = true;
      }

      if (hasErrors) {
        emit(`  ${sym.warning} Some preflight checks failed. Continuing anyway...`);
      } else {
        emit(`  ${sym.success} All preflight checks passed`);
      }
      emit("");

      const worktreeKey = artifactStore.worktreeHash(profile.worktree);
      artifactStore.save(worktreeKey, { preflightPassed: !hasErrors });
    }
  }

  // Run clean if needed
  if (profile.mode !== "dirty") {
    const cleaner = new CleanManager(projectRoot);
    emit(`\u23f3 Running ${profile.mode} clean...`);
    await cleaner.execute(profile.mode, profile.platform, (step, status) => {
      const icon = status === "done" ? sym.success : status === "skip" ? sym.info : sym.warning;
      emit(`  ${icon} ${step}`);
    });
    emit("");
  }

  // Start Metro — kill stale process first if port is occupied
  const metro = new MetroManager(artifactStore);
  const worktreeKey = artifactStore.worktreeHash(profile.worktree);
  const port = profile.metroPort;

  const portFree = await metro.isPortFree(port);
  if (!portFree) {
    emit(`${sym.warning} Port ${port} is in use. Killing stale process...`);
    const killed = await metro.killProcessOnPort(port);
    if (killed) {
      emit(`  ${sym.success} Killed process on port ${port}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      emit(`  ${sym.error} Could not kill process on port ${port}. Trying anyway...`);
    }
  }
  // Always reset watchman for this project to prevent recrawl warnings
  try {
    const effectiveRoot = profile.worktree ?? projectRoot;
    execSync(`watchman watch-del '${effectiveRoot}'`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    emit(`${sym.success} Watchman watch cleared for project`);
  } catch {
    // Watchman may not be installed or no watch exists — that's fine
  }

  emit(`\u23f3 Starting Metro on port ${port}...`);
  metro.start({
    worktreeKey,
    projectRoot: profile.worktree ?? projectRoot,
    port: profile.metroPort,
    resetCache: profile.mode !== "dirty",
    verbose: true,
    env: profile.env,
  });

  // Start file watcher if on-save actions configured
  let watcher: FileWatcher | null = null;
  if (profile.onSave.length > 0) {
    emit("\u23f3 Starting file watcher...");
    watcher = new FileWatcher({
      projectRoot,
      actions: profile.onSave,
    });
    watcher.start();
  }

  // Start IPC server
  const ipc = new IpcServer(path.join(projectRoot, ".rn-dev", "sock"));
  await ipc.start();

  // Boot device if needed (iOS simulator)
  if (profile.platform === "ios" || profile.platform === "both") {
    const deviceId = profile.devices?.ios;
    if (deviceId) {
      const { listDevices: listDev, bootDevice } = await import("../core/device.js");
      const devices = listDev("ios");
      const device = devices.find((d) => d.id === deviceId);
      if (device && device.status === "shutdown") {
        emit(`\u23f3 Booting simulator ${device.name}...`);
        const booted = bootDevice(device);
        if (booted) {
          emit(`  ${sym.success} Simulator booted`);
        } else {
          emit(`  ${sym.warning} Could not boot simulator \u2014 may already be booting`);
        }
      } else if (device && device.status === "booted") {
        emit(`  ${sym.success} Simulator ${device.name} already booted`);
      }
    }
  }

  emit(`${sym.success} All services started`);
  emit("");

  // Create builder — caller triggers build after TUI renders so output streams live
  const { Builder } = await import("../core/builder.js");
  const builder = new Builder();

  return { metro, watcher, ipc, worktreeKey, startupLog, builder };
}
