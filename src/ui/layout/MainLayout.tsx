import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import Gradient from "ink-gradient";
import { useScreenSize } from "fullscreen-ink";
import type { Profile } from "../../core/types.js";
import { ShortcutBar } from "../components/ShortcutBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { useTheme } from "../theme-provider.js";
import { useMouse } from "../hooks/useMouse.js";

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


  // Calculate tab X boundaries for mouse click detection
  // Each tab: border(1) + paddingX(1) + "icon name" + paddingX(1) + border(1) = content + 4
  // Plus gap(1) between tabs, plus paddingX(1) on the container
  const tabBoundaries = useMemo(() => {
    let x = 2; // paddingX(1) on container + first border
    return modules.map((mod) => {
      const labelLen = mod.icon.length + 1 + mod.name.length; // "🚀 Dev Space"
      const tabWidth = labelLen + 4; // borders + padding
      const start = x;
      const end = x + tabWidth;
      x = end + 1; // gap
      return { id: mod.id, start, end };
    });
  }, [modules]);

  // Mouse click on tab bar (Y = 1-2) to select tab
  useMouse(
    useCallback(
      (event) => {
        if (event.type !== "press" || event.button !== "left") return;
        // Tab bar is rows 1-3
        if (event.y <= 3) {
          for (const tab of tabBoundaries) {
            if (event.x >= tab.start && event.x <= tab.end) {
              setActiveModuleId(tab.id);
              break;
            }
          }
        }
      },
      [tabBoundaries]
    )
  );

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
  const hr = "─".repeat(width);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* ── Tab bar ── */}
      <Box paddingX={1} height={3} gap={1} alignItems="center">
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
        <Text color={theme.muted} dimColor>[Tab]↹</Text>
      </Box>

      {/* ── Profile banner ── */}
      {!bannerCollapsed && (
        <Box borderStyle="single" borderColor={theme.border} paddingX={1}>
          <Gradient name="passion">
            {`⚙ ${profile.name}`}
          </Gradient>
          <Text color={theme.muted}> │ </Text>
          <Text color={theme.success} bold>{profile.branch}</Text>
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

      {/* ── Separator ── */}
      <Text color={theme.border}>{hr}</Text>

      {/* ── Active module content ── */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {ActiveComponent != null && <ActiveComponent />}
      </Box>

      {/* ── Separator ── */}
      <Text color={theme.border}>{hr}</Text>

      {/* ── Shortcut bar ── */}
      <Box paddingX={1} height={1}>
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
