import React from "react";
import { useTheme } from "../theme-provider.js";
import { useSpinnerFrame } from "./Spinner.js";

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
  const spinnerFrame = useSpinnerFrame("dots");

  const metroDot = metroStatus === "starting"
    ? spinnerFrame
    : "\u25cf";
  const metroDotColor = getMetroDotColor(metroStatus, theme);
  const portStr = metroPort != null ? ` :${metroPort}` : "";

  return (
    <box height={1} paddingLeft={1} backgroundColor={theme.selection} flexDirection="row">
      <text color={theme.fg}>{"Metro: "}</text>
      <text color={metroDotColor} bold>{metroDot}</text>
      <text color={theme.fg}>{` ${getMetroLabel(metroStatus)}${portStr}`}</text>
      <text color={theme.muted}>{" \u2502 "}</text>
      <text color={theme.fg}>{"Watcher: "}</text>
      <text color={watcherEnabled ? theme.success : theme.muted} bold>{watcherEnabled ? "ON" : "OFF"}</text>
      <text color={theme.muted}>{" \u2502 "}</text>
      <text color={theme.fg}>{"Module: "}</text>
      <text color={theme.accent}>{activeModule}</text>
    </box>
  );
}
