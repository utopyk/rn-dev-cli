import React, { useState, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { ThemeProvider } from "../ui/theme-provider.js";
import { MainLayout } from "../ui/layout/index.js";
import { WizardContainer } from "../ui/wizard/index.js";
import { AppProvider, useAppContext } from "./AppContext.js";
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
  wizardMode?: boolean;
  projectRoot?: string;
  onWizardComplete?: (profile: Profile) => void;
  onWizardCancel?: () => void;
  profile?: Profile;
  metro?: MetroManager;
  watcher?: FileWatcher | null;
  worktreeKey?: string;
  startupLog?: string[];
  builder?: import("../core/builder.js").Builder;
}

// ---------------------------------------------------------------------------
// KeyboardHandler — captures shortcut keys and dispatches to AppContext
// ---------------------------------------------------------------------------

function KeyboardHandler(): null {
  const { runShortcut } = useAppContext();

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        // Don't intercept tab (used for module switching)
        if (event.name === "tab") return;
        // Single char shortcuts
        if (event.name.length === 1) {
          runShortcut(event.name);
        }
      },
      [runShortcut]
    )
  );

  return null;
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
  startupLog,
  builder,
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

  // Build a placeholder profile for wizard mode (shows "Setting up..." in banner)
  const displayProfile: Profile = activeProfile ?? {
    name: "Setting up...",
    isDefault: true,
    worktree: null,
    branch: "\u2014",
    platform: "ios",
    mode: "dirty",
    metroPort: 8081,
    devices: {},
    buildVariant: "debug",
    preflight: { checks: [], frequency: "once" },
    onSave: [],
    env: {},
    projectRoot: projectRoot ?? "",
  };

  const wizardNode =
    showWizard && projectRoot ? (
      <WizardContainer
        projectRoot={projectRoot}
        onComplete={handleWizardComplete}
        onCancel={handleWizardCancel}
      />
    ) : undefined;

  return (
    <ThemeProvider theme={theme}>
      <box flexGrow={1} backgroundColor={theme.colors.bg}>
        <AppProvider
          profile={displayProfile}
          metro={metro}
          watcher={watcher}
          worktreeKey={worktreeKey}
          startupLog={startupLog}
          builder={builder}
          wizardContent={wizardNode}
        >
          {!showWizard && <KeyboardHandler />}
          <MainLayout
            profile={displayProfile}
            modules={modules}
            shortcuts={shortcuts}
            metroStatus={metroStatus}
            metroPort={displayProfile.metroPort}
            watcherEnabled={watcherEnabled}
          />
        </AppProvider>
      </box>
    </ThemeProvider>
  );
}
