import React, { useState, useEffect, useCallback } from "react";
import { FullScreenBox } from "fullscreen-ink";
import { ThemeProvider } from "../ui/theme-provider.js";
import { MainLayout } from "../ui/layout/index.js";
import { WizardContainer } from "../ui/wizard/index.js";
import type { Profile, Theme } from "../core/types.js";
import type { MetroManager } from "../core/metro.js";
import type { FileWatcher } from "../core/watcher.js";
import type { ModuleRegistry } from "../modules/index.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AppProps {
  theme: Theme;
  registry: ModuleRegistry;
  // When in wizard mode, these are provided:
  wizardMode?: boolean;
  projectRoot?: string;
  onWizardComplete?: (profile: Profile) => void;
  onWizardCancel?: () => void;
  // When in TUI mode, these are provided:
  profile?: Profile;
  metro?: MetroManager;
  watcher?: FileWatcher | null;
  worktreeKey?: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({
  theme,
  registry,
  wizardMode = false,
  projectRoot,
  onWizardComplete,
  onWizardCancel,
  profile,
  metro,
  watcher,
  worktreeKey,
}: AppProps): React.JSX.Element {
  const [showWizard, setShowWizard] = useState(wizardMode);
  const [activeProfile, setActiveProfile] = useState<Profile | undefined>(
    profile
  );
  const [metroStatus, setMetroStatus] = useState<
    "starting" | "running" | "error" | "stopped"
  >("starting");
  const [watcherEnabled, setWatcherEnabled] = useState(!!watcher);

  // Subscribe to metro status changes
  useEffect(() => {
    if (!metro) return;
    const handler = ({
      status,
    }: {
      worktreeKey: string;
      status: "starting" | "running" | "error" | "stopped";
    }): void => {
      setMetroStatus(status);
    };
    metro.on("status", handler);
    return () => {
      metro.off("status", handler);
    };
  }, [metro]);

  // Derive the current metro status from the instance
  useEffect(() => {
    if (!metro || !worktreeKey) return;
    const instance = metro.getInstance(worktreeKey);
    if (instance) {
      setMetroStatus(instance.status);
    }
  }, [metro, worktreeKey]);

  const handleWizardComplete = useCallback(
    (partial: Partial<Profile>) => {
      setShowWizard(false);
      if (onWizardComplete) {
        // The start-flow will handle saving and transitioning
        onWizardComplete(partial as Profile);
      }
    },
    [onWizardComplete]
  );

  const handleWizardCancel = useCallback(() => {
    setShowWizard(false);
    if (onWizardCancel) {
      onWizardCancel();
    }
  }, [onWizardCancel]);

  // Build module descriptors for the layout
  const modules = registry.getAll().map((m) => ({
    id: m.id,
    icon: m.icon,
    name: m.name,
    component: m.component,
  }));

  const shortcuts = registry.getShortcuts().map((s) => ({
    key: s.key,
    label: s.label,
  }));

  return (
    <ThemeProvider theme={theme}>
      <FullScreenBox>
        {showWizard && projectRoot ? (
          <WizardContainer
            projectRoot={projectRoot}
            onComplete={handleWizardComplete}
            onCancel={handleWizardCancel}
          />
        ) : activeProfile ? (
          <MainLayout
            profile={activeProfile}
            modules={modules}
            shortcuts={shortcuts}
            metroStatus={metroStatus}
            metroPort={activeProfile.metroPort}
            watcherEnabled={watcherEnabled}
          />
        ) : null}
      </FullScreenBox>
    </ThemeProvider>
  );
}
