import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-provider.js";

export interface StatusBarProps {
  metroStatus: "starting" | "running" | "error" | "stopped";
  metroPort?: number;
  watcherEnabled: boolean;
  activeModule: string;
}

function getMetroDotColor(
  status: StatusBarProps["metroStatus"],
  theme: { success: string; warning: string; error: string; muted: string }
): string {
  switch (status) {
    case "running":
      return theme.success;
    case "starting":
      return theme.warning;
    case "error":
      return theme.error;
    case "stopped":
      return theme.muted;
  }
}

function getMetroLabel(status: StatusBarProps["metroStatus"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "error":
      return "Error";
    case "stopped":
      return "Stopped";
  }
}

export function StatusBar({
  metroStatus,
  metroPort,
  watcherEnabled,
  activeModule,
}: StatusBarProps): React.JSX.Element {
  const theme = useTheme();
  const separator = <Text color={theme.muted}> {"\u2502"} </Text>;

  return (
    <Box>
      <Text color={theme.fg}>Metro: </Text>
      <Text color={getMetroDotColor(metroStatus, theme)}>{"\u25cf"}</Text>
      <Text color={theme.fg}>
        {" "}
        {getMetroLabel(metroStatus)}
        {metroPort != null ? ` :${metroPort}` : ""}
      </Text>
      {separator}
      <Text color={theme.fg}>Watcher: </Text>
      <Text color={watcherEnabled ? theme.success : theme.muted}>
        {watcherEnabled ? "ON" : "OFF"}
      </Text>
      {separator}
      <Text color={theme.fg}>Module: </Text>
      <Text color={theme.accent}>{activeModule}</Text>
    </Box>
  );
}
