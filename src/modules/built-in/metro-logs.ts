import React from "react";
import { Text, Box } from "ink";
import type { RnDevModule } from "../../core/types.js";

// ---------------------------------------------------------------------------
// MetroLogsView — placeholder component
// ---------------------------------------------------------------------------

function MetroLogsView(): React.JSX.Element {
  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(
      Text,
      { bold: true },
      "Metro Logs"
    ),
    React.createElement(
      Text,
      { dimColor: true },
      "Press f to filter logs, C to clear logs"
    )
  );
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

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
