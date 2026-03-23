import React, { useState, useCallback } from "react";
import { Box, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import type { Profile } from "../../core/types.js";
import { ProfileBanner } from "../components/ProfileBanner.js";
import { Sidebar } from "../components/Sidebar.js";
import { ShortcutBar } from "../components/ShortcutBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { useTheme } from "../theme-provider.js";

export interface MainLayoutModule {
  id: string;
  icon: string;
  name: string;
  component: React.FC;
}

export interface MainLayoutProps {
  profile: Profile;
  modules: MainLayoutModule[];
  shortcuts: Array<{ key: string; label: string }>;
  metroStatus: "starting" | "running" | "error" | "stopped";
  metroPort?: number;
  watcherEnabled: boolean;
}

export function MainLayout({
  profile,
  modules,
  shortcuts,
  metroStatus,
  metroPort,
  watcherEnabled,
}: MainLayoutProps): React.JSX.Element {
  const theme = useTheme();
  const { height, width } = useScreenSize();

  const [activeModuleId, setActiveModuleId] = useState<string>(
    modules[0]?.id ?? ""
  );
  const [bannerCollapsed, setBannerCollapsed] = useState(false);

  const cycleModule = useCallback(() => {
    const currentIndex = modules.findIndex((m) => m.id === activeModuleId);
    const nextIndex = (currentIndex + 1) % modules.length;
    const next = modules[nextIndex];
    if (next) {
      setActiveModuleId(next.id);
    }
  }, [modules, activeModuleId]);

  useInput(
    useCallback(
      (input: string, key: { tab?: boolean; escape?: boolean }) => {
        if (key.tab) {
          cycleModule();
        } else if (input === "p" || input === "P") {
          setBannerCollapsed((prev) => !prev);
        }
      },
      [cycleModule]
    )
  );

  const activeModule = modules.find((m) => m.id === activeModuleId);
  const ActiveComponent = activeModule?.component ?? null;

  const sidebarItems = modules.map((m) => ({
    id: m.id,
    icon: m.icon,
    label: m.name,
  }));

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={theme.border}
    >
      {/* Profile banner row */}
      <Box paddingX={1}>
        <ProfileBanner
          profile={profile}
          collapsible={true}
          collapsed={bannerCollapsed}
          onToggle={() => setBannerCollapsed((prev) => !prev)}
        />
      </Box>

      {/* Main content: sidebar + active module */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Sidebar */}
        <Sidebar
          items={sidebarItems}
          activeId={activeModuleId}
          onSelect={setActiveModuleId}
          width={14}
        />

        {/* Active module view */}
        <Box flexGrow={1} flexDirection="column">
          {ActiveComponent != null && <ActiveComponent />}
        </Box>
      </Box>

      {/* Shortcut bar */}
      <Box paddingX={1} borderStyle="single" borderColor={theme.border}>
        <ShortcutBar shortcuts={shortcuts} />
      </Box>

      {/* Status bar */}
      <Box paddingX={1}>
        <StatusBar
          metroStatus={metroStatus}
          metroPort={metroPort}
          watcherEnabled={watcherEnabled}
          activeModule={activeModule?.name ?? ""}
        />
      </Box>
    </Box>
  );
}
