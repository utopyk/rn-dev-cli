import path from "path";
import React from "react";
import { render } from "ink";

import { detectProjectRoot, getCurrentBranch } from "../core/project.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { MetroManager } from "../core/metro.js";
import { CleanManager } from "../core/clean.js";
import { FileWatcher } from "../core/watcher.js";
import { IpcServer } from "../core/ipc.js";
import { loadTheme } from "../ui/theme-provider.js";
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
  const theme = loadTheme(options.theme ?? "midnight");

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

  // 7. If we have a profile already, start services immediately
  let metro: MetroManager | undefined;
  let watcher: FileWatcher | null = null;
  let ipc: IpcServer | undefined;
  let worktreeKey: string | undefined;

  if (profile && !needsWizard) {
    const result = await startServices(
      profile,
      projectRoot,
      artifactStore
    );
    metro = result.metro;
    watcher = result.watcher;
    ipc = result.ipc;
    worktreeKey = result.worktreeKey;
  }

  // 8. Render single Ink instance — either wizard or TUI
  const inkInstance = render(
    React.createElement(App, {
      theme,
      registry,
      wizardMode: needsWizard,
      projectRoot,
      profile,
      metro,
      watcher,
      worktreeKey,
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
        inkInstance.rerender(
          React.createElement(App, {
            theme,
            registry,
            wizardMode: false,
            profile: fullProfile,
            metro: result.metro,
            watcher: result.watcher,
            worktreeKey: result.worktreeKey,
          })
        );
      },
      onWizardCancel: () => {
        inkInstance.unmount();
        process.exit(0);
      },
    })
  );

  // 9. Handle cleanup on exit
  const cleanup = (): void => {
    metro?.stopAll();
    watcher?.stop();
    ipc?.stop();
    inkInstance.unmount();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Wait for Ink to finish (keeps the process alive)
  await inkInstance.waitUntilExit();
  cleanup();
}

// ---------------------------------------------------------------------------
// Helper: start Metro, watcher, IPC
// ---------------------------------------------------------------------------

async function startServices(
  profile: Profile,
  projectRoot: string,
  artifactStore: ArtifactStore
): Promise<{
  metro: MetroManager;
  watcher: FileWatcher | null;
  ipc: IpcServer;
  worktreeKey: string;
}> {
  // Run preflights if configured
  if (profile.preflight.checks.length > 0) {
    const artifact = artifactStore.load(
      artifactStore.worktreeHash(profile.worktree)
    );
    const needsPreflight =
      profile.preflight.frequency === "always" || !artifact?.preflightPassed;

    if (needsPreflight) {
      const { createDefaultPreflightEngine } = await import(
        "../core/preflight.js"
      );
      const engine = createDefaultPreflightEngine(projectRoot);
      const results = await engine.runAll(profile.platform, profile.preflight);

      let hasErrors = false;
      for (const [id, result] of results) {
        const icon = result.passed ? "pass" : "FAIL";
        console.log(`  [${icon}] ${id}: ${result.message}`);
        if (!result.passed) hasErrors = true;
      }

      if (hasErrors) {
        console.log(
          "\n  Some preflight checks failed. Continuing anyway...\n"
        );
      }

      const worktreeKey = artifactStore.worktreeHash(profile.worktree);
      artifactStore.save(worktreeKey, { preflightPassed: !hasErrors });
    }
  }

  // Run clean if needed
  if (profile.mode !== "dirty") {
    const cleaner = new CleanManager(projectRoot);
    console.log(`  Running ${profile.mode} clean...`);
    await cleaner.execute(profile.mode, profile.platform, (step, status) => {
      console.log(`  [${status}] ${step}`);
    });
  }

  // Start Metro
  const metro = new MetroManager(artifactStore);
  const worktreeKey = artifactStore.worktreeHash(profile.worktree);
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
    watcher = new FileWatcher({
      projectRoot,
      actions: profile.onSave,
    });
    watcher.start();
  }

  // Start IPC server
  const ipc = new IpcServer(path.join(projectRoot, ".rn-dev", "sock"));
  await ipc.start();

  return { metro, watcher, ipc, worktreeKey };
}
