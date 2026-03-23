import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import type { Profile } from "../../core/types.js";
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
      (input: string, key: { tab?: boolean }) => {
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

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* ── Tab bar ── */}
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} height={3} gap={1}>
        {modules.map((mod) => {
          const isActive = mod.id === activeModuleId;
          return (
            <Box
              key={mod.id}
              borderStyle={isActive ? "bold" : "single"}
              borderColor={isActive ? theme.accent : theme.border}
              paddingX={1}
            >
              <Text
                color={isActive ? theme.accent : theme.fg}
                bold={isActive}
              >
                {mod.icon} {mod.name}
              </Text>
            </Box>
          );
        })}
        <Box flexGrow={1} />
        <Box alignSelf="center">
          <Text color={theme.muted} dimColor>[Tab] switch</Text>
        </Box>
      </Box>

      {/* ── Profile banner ── */}
      {!bannerCollapsed && (
        <Box borderStyle="single" borderColor={theme.border} paddingX={1} height={3}>
          <Text color={theme.accent} bold>⚙ {profile.name}</Text>
          <Text color={theme.muted}> │ </Text>
          <Text color={theme.success}>{profile.branch}</Text>
          <Text color={theme.muted}> │ </Text>
          <Text color={theme.fg}>{profile.platform}</Text>
          <Text color={theme.muted}> │ </Text>
          <Text color={profile.mode === "ultra-clean" ? theme.warning : theme.fg}>
            {profile.mode}
          </Text>
          <Text color={theme.muted}> │ </Text>
          <Text color={theme.fg}>:{profile.metroPort}</Text>
          <Text color={theme.muted}> │ </Text>
          <Text color={theme.fg}>{profile.buildVariant}</Text>
          <Box flexGrow={1} />
          <Text color={theme.muted} dimColor>[p] hide</Text>
        </Box>
      )}

      {/* ── Active module content ── */}
      <Box flexGrow={1} flexDirection="column">
        {ActiveComponent != null && <ActiveComponent />}
      </Box>

      {/* ── Shortcut bar ── */}
      <Box borderStyle="single" borderColor={theme.border} borderBottom={false} paddingX={1} height={3}>
        <ShortcutBar shortcuts={shortcuts} />
      </Box>

      {/* ── Status bar ── */}
      <Box paddingX={1} height={1}>
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
