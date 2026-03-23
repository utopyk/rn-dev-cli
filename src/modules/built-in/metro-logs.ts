import React from "react";
import { Box, Text } from "ink";
import type { RnDevModule } from "../../core/types.js";
import { useAppContext } from "../../app/AppContext.js";
import { LogViewer } from "../../ui/components/LogViewer.js";
import { Panel } from "../../ui/components/Panel.js";
import { useTheme } from "../../ui/theme-provider.js";

function MetroLogsView(): React.JSX.Element {
  const { metroLines } = useAppContext();
  const theme = useTheme();

  return React.createElement(
    Box,
    { flexDirection: "column", flexGrow: 1 },
    // Instructions
    React.createElement(
      Box,
      { paddingX: 1, paddingY: 0 },
      React.createElement(
        Text,
        { color: theme.muted },
        "[C] Clear Logs  [r] Reload  [d] Dev Menu"
      )
    ),
    // Full-screen metro log viewer
    React.createElement(
      Box,
      { flexGrow: 1 },
      React.createElement(
        Panel,
        { title: "Metro Logs", width: "100%", children: React.createElement(LogViewer, { lines: metroLines, follow: true }) }
      )
    )
  );
}

export const metroLogsModule: RnDevModule = {
  id: "metro-logs",
  name: "Metro Logs",
  icon: "📡",
  order: 20,
  component: MetroLogsView,
  shortcuts: [
    { key: "f", label: "Filter Logs", action: async () => {}, showInPanel: true },
    { key: "C", label: "Clear Logs", action: async () => {}, showInPanel: true },
  ],
};
