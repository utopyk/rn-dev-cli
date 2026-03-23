import path from "path";
import React from "react";
import { render } from "ink";
import { FullScreenBox } from "fullscreen-ink";

import { detectProjectRoot, getCurrentBranch } from "../core/project.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { MetroManager } from "../core/metro.js";
import { CleanManager } from "../core/clean.js";
import { FileWatcher } from "../core/watcher.js";
import { IpcServer } from "../core/ipc.js";
import { loadTheme, ThemeProvider } from "../ui/theme-provider.js";
import { ModuleRegistry, devSpaceModule, settingsModule, lintTestModule, metroLogsModule } from "../modules/index.js";
import { WizardContainer } from "../ui/wizard/index.js";
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
// Wizard runner — renders WizardContainer via Ink and returns the Profile
// ---------------------------------------------------------------------------

async function runWizard(
  projectRoot: string,
  profileStore: ProfileStore
): Promise<Profile> {
  return new Promise<Profile>((resolve, reject) => {
    const branch = getCurrentBranch(projectRoot) ?? "main";

    const onComplete = (partial: Partial<Profile>): void => {
      const profile: Profile = {
        name: partial.name ?? `profile-${Date.now()}`,
        isDefault: partial.isDefault ?? true,
        worktree: partial.worktree ?? null,
        branch: partial.branch ?? branch,
        platform: partial.platform ?? "both",
        mode: partial.mode ?? "clean",
        metroPort: partial.metroPort ?? 8081,
        devices: partial.devices ?? {},
        buildVariant: partial.buildVariant ?? "debug",
        preflight: partial.preflight ?? { checks: [], frequency: "once" },
        onSave: partial.onSave ?? [],
        env: partial.env ?? {},
        projectRoot,
      };

      profileStore.save(profile);
      inkInstance.unmount();
      resolve(profile);
    };

    const onCancel = (): void => {
      inkInstance.unmount();
      reject(new Error("Wizard cancelled"));
    };

    const wizardElement = React.createElement(WizardContainer, {
      projectRoot,
      onComplete,
      onCancel,
    });
    const inkInstance = render(
      React.createElement(
        ThemeProvider,
        { theme: loadTheme("midnight"), children: wizardElement }
      )
    );
  });
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

  // 4. Resolve profile
  let profile: Profile;
  if (options.interactive) {
    profile = await runWizard(projectRoot, profileStore);
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
      // No profile found — fall into interactive wizard
      profile = await runWizard(projectRoot, profileStore);
    }
  }

  // Apply CLI overrides
  if (options.platform) profile.platform = options.platform as Platform;
  if (options.mode) profile.mode = options.mode as RunMode;
  if (options.port) profile.metroPort = options.port;

  // 5. Load theme
  const theme = loadTheme(options.theme ?? "midnight");

  // 6. Run preflights if configured
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
        console.log("\n  Some preflight checks failed. Continuing anyway...\n");
      }

      // Persist that we ran preflights
      const worktreeKey = artifactStore.worktreeHash(profile.worktree);
      artifactStore.save(worktreeKey, { preflightPassed: !hasErrors });
    }
  }

  // 7. Run clean if needed
  if (profile.mode !== "dirty") {
    const cleaner = new CleanManager(projectRoot);
    console.log(`  Running ${profile.mode} clean...`);
    await cleaner.execute(profile.mode, profile.platform, (step, status) => {
      console.log(`  [${status}] ${step}`);
    });
  }

  // 8. Start Metro
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

  // 9. Start file watcher if on-save actions configured
  let watcher: FileWatcher | null = null;
  if (profile.onSave.length > 0) {
    watcher = new FileWatcher({
      projectRoot,
      actions: profile.onSave,
    });
    watcher.start();
  }

  // 10. Start IPC server
  const ipc = new IpcServer(path.join(projectRoot, ".rn-dev", "sock"));
  await ipc.start();

  // 11. Register modules
  const registry = new ModuleRegistry();
  registry.register(devSpaceModule);
  registry.register(lintTestModule);
  registry.register(metroLogsModule);
  registry.register(settingsModule);

  // 12. Render TUI
  const inkInstance = render(
    React.createElement(App, {
      profile,
      theme,
      metro,
      watcher,
      registry,
      worktreeKey,
    })
  );

  // 13. Handle cleanup on exit
  const cleanup = (): void => {
    metro.stopAll();
    watcher?.stop();
    ipc.stop();
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
