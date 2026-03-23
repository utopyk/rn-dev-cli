import React from "react";
import { Box, Text } from "ink";
import type { RnDevModule } from "../../core/types.js";
import { useAppContext } from "../../app/AppContext.js";
import { LogViewer } from "../../ui/components/LogViewer.js";
import { Panel } from "../../ui/components/Panel.js";
import { useTheme } from "../../ui/theme-provider.js";

function LintTestView(): React.JSX.Element {
  const { toolOutputLines } = useAppContext();
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
        "[l] Lint  [t] Type Check  [T] Tests"
      )
    ),
    // Output panel
    React.createElement(
      Box,
      { flexGrow: 1 },
      React.createElement(
        Panel,
        { title: "Output", width: "100%", children: React.createElement(LogViewer, { lines: toolOutputLines, follow: true }) }
      )
    )
  );
}

export const lintTestModule: RnDevModule = {
  id: "lint-test",
  name: "Lint & Test",
  icon: "🧪",
  order: 10,
  component: LintTestView,
  shortcuts: [
    { key: "l", label: "Run Lint", action: async () => {}, showInPanel: true },
    { key: "t", label: "Run Tests", action: async () => {}, showInPanel: true },
    { key: "T", label: "Run Type Check", action: async () => {}, showInPanel: true },
  ],
};
