import React from "react";
import { Text, Box } from "ink";
import type { RnDevModule } from "../../core/types.js";

// ---------------------------------------------------------------------------
// LintTestView — placeholder component
// ---------------------------------------------------------------------------

function LintTestView(): React.JSX.Element {
  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(
      Text,
      { bold: true },
      "Lint & Test"
    ),
    React.createElement(
      Text,
      { dimColor: true },
      "Press l to run lint, t to run tests, T to run type check"
    )
  );
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

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
