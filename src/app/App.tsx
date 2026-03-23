import React, { useState, useEffect } from "react";
import { FullScreenBox } from "fullscreen-ink";
import { ThemeProvider } from "../ui/theme-provider.js";
import { MainLayout } from "../ui/layout/index.js";
import type { Profile, Theme } from "../core/types.js";
import type { MetroManager } from "../core/metro.js";
import type { FileWatcher } from "../core/watcher.js";
import type { ModuleRegistry } from "../modules/index.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AppProps {
  profile: Profile;
  theme: Theme;
  metro: MetroManager;
  watcher: FileWatcher | null;
  registry: ModuleRegistry;
  worktreeKey: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({
  profile,
  theme,
  metro,
  watcher,
  registry,
  worktreeKey,
}: AppProps): React.JSX.Element {
  const [metroStatus, setMetroStatus] = useState<
    "starting" | "running" | "error" | "stopped"
  >("starting");
  const [watcherEnabled, setWatcherEnabled] = useState(!!watcher);

  // Subscribe to metro status changes
  useEffect(() => {
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
    const instance = metro.getInstance(worktreeKey);
    if (instance) {
      setMetroStatus(instance.status);
    }
  }, [metro, worktreeKey]);

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
        <MainLayout
          profile={profile}
          modules={modules}
          shortcuts={shortcuts}
          metroStatus={metroStatus}
          metroPort={profile.metroPort}
          watcherEnabled={watcherEnabled}
        />
      </FullScreenBox>
    </ThemeProvider>
  );
}
