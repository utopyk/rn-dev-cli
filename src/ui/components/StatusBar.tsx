import React from "react";
import { useTheme } from "../theme-provider.js";
import { Spinner } from "./Spinner.js";

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

  return (
    <box height={1} paddingLeft={1} backgroundColor={theme.selection}>
      <text color={theme.fg}>
        Metro:{" "}
        {metroStatus === "starting" ? (
          <span color={theme.warning}><Spinner type="dots" /></span>
        ) : (
          <span color={getMetroDotColor(metroStatus, theme)} bold>{"\u25cf"}</span>
        )}
        {" "}{getMetroLabel(metroStatus)}
        {metroPort != null ? ` :${metroPort}` : ""}
        <span color={theme.muted}> {"\u2502"} </span>
        Watcher: <span color={watcherEnabled ? theme.success : theme.muted} bold>{watcherEnabled ? "ON" : "OFF"}</span>
        <span color={theme.muted}> {"\u2502"} </span>
        Module: <span color={theme.accent}>{activeModule}</span>
      </text>
    </box>
  );
}
