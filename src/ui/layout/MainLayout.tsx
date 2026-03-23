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

const SIDEBAR_WIDTH = 18;

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

  // Content area height: total - profile(3) - shortcut(1) - status(1)
  const contentHeight = Math.max(5, height - 5);

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* ── Profile banner ── */}
      <Box paddingX={1} height={1}>
        {bannerCollapsed ? (
          <>
            <Text color={theme.muted}>▶ </Text>
            <Text color={theme.accent} bold>{profile.name}</Text>
            <Text color={theme.muted}> [p]</Text>
          </>
        ) : (
          <>
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
            <Text color={theme.muted}> [p]</Text>
          </>
        )}
      </Box>

      {/* ── Separator ── */}
      <Text color={theme.border}>{"─".repeat(width)}</Text>

      {/* ── Main area: sidebar + content ── */}
      <Box flexDirection="row" height={contentHeight}>
        {/* Sidebar — manually draw right border as │ per line */}
        <Box flexDirection="column" width={SIDEBAR_WIDTH}>
          {modules.map((mod) => {
            const isActive = mod.id === activeModuleId;
            const maxLabel = SIDEBAR_WIDTH - 6; // icon(2) + indicator(2) + border(1) + pad
            const label = mod.name.length > maxLabel
              ? mod.name.slice(0, maxLabel)
              : mod.name.padEnd(maxLabel);

            return (
              <Box key={mod.id} height={1}>
                <Text
                  color={isActive ? theme.accent : theme.fg}
                  bold={isActive}
                  backgroundColor={isActive ? theme.selection : undefined}
                >
                  {isActive ? " ▸ " : "   "}
                  {mod.icon} {label}
                </Text>
                <Text color={theme.border}>│</Text>
              </Box>
            );
          })}
          {/* Fill remaining sidebar height with empty + border */}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexGrow={1} />
            <Box height={1}>
              <Text color={theme.muted}>{"".padEnd(SIDEBAR_WIDTH - 1)}</Text>
              <Text color={theme.border}>│</Text>
            </Box>
          </Box>
        </Box>

        {/* Active module content */}
        <Box flexGrow={1} flexDirection="column">
          {ActiveComponent != null && <ActiveComponent />}
        </Box>
      </Box>

      {/* ── Separator ── */}
      <Text color={theme.border}>{"─".repeat(width)}</Text>

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
