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

const SIDEBAR_WIDTH = 16;

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

  // Build horizontal rule
  const hrChar = "─";
  const hr = hrChar.repeat(Math.max(0, width - 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* ── Profile banner ── */}
      <Box borderStyle="round" borderColor={theme.border} paddingX={1}>
        {bannerCollapsed ? (
          <Box>
            <Text color={theme.muted}>▶ </Text>
            <Text color={theme.accent} bold>{profile.name}</Text>
            <Text color={theme.muted}> [p] expand</Text>
          </Box>
        ) : (
          <Box justifyContent="space-between" width="100%">
            <Box>
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
              {profile.worktree && (
                <>
                  <Text color={theme.muted}> │ </Text>
                  <Text color={theme.highlight}>wt:{profile.worktree}</Text>
                </>
              )}
            </Box>
            <Text color={theme.muted}>[p]</Text>
          </Box>
        )}
      </Box>

      {/* ── Main area: sidebar + content ── */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Sidebar */}
        <Box
          flexDirection="column"
          width={SIDEBAR_WIDTH}
          borderStyle="single"
          borderColor={theme.border}
          borderRight={true}
          borderLeft={false}
          borderTop={false}
          borderBottom={false}
        >
          {modules.map((mod, index) => {
            const isActive = mod.id === activeModuleId;
            return (
              <React.Fragment key={mod.id}>
                <Box paddingX={1} height={1}>
                  <Text
                    color={isActive ? theme.accent : theme.fg}
                    bold={isActive}
                    backgroundColor={isActive ? theme.selection : undefined}
                    wrap="truncate"
                  >
                    {isActive ? "▸ " : "  "}
                    {mod.icon} {mod.name}
                  </Text>
                </Box>
                {index < modules.length - 1 && (
                  <Box paddingX={0} height={1}>
                    <Text color={theme.border} dimColor>
                      {hrChar.repeat(SIDEBAR_WIDTH - 1)}
                    </Text>
                  </Box>
                )}
              </React.Fragment>
            );
          })}
          <Box flexGrow={1} />
          <Box paddingX={1} height={1}>
            <Text color={theme.muted} dimColor>[Tab] switch</Text>
          </Box>
        </Box>

        {/* Active module content */}
        <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
          {ActiveComponent != null && <ActiveComponent />}
        </Box>
      </Box>

      {/* ── Separator ── */}
      <Text color={theme.border}>{hr}</Text>

      {/* ── Shortcut bar ── */}
      <Box paddingX={1}>
        <ShortcutBar shortcuts={shortcuts} />
      </Box>

      {/* ── Status bar ── */}
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
