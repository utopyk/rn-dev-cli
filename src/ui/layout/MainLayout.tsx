import React, { useState, useCallback, useEffect } from "react";
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

/**
 * Convert hex color (#RRGGBB) to ANSI 24-bit escape sequence for background.
 */
function hexToBgAnsi(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
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

  // Set terminal background color on mount, reset on unmount
  useEffect(() => {
    process.stdout.write(hexToBgAnsi(theme.bg));
    return () => {
      process.stdout.write("\x1b[0m"); // reset all attributes
    };
  }, [theme.bg]);

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
      {/* ── Tab bar (no outer border, individual tab boxes) ── */}
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

      {/* ── Separator ── */}
      <Text color={theme.border}>{hr}</Text>

      {/* ── Active module content ── */}
      <Box flexGrow={1} flexDirection="column">
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
