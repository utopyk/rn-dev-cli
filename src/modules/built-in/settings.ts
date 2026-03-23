import React from "react";
import { Box, Text } from "ink";
import type { RnDevModule } from "../../core/types.js";
import { useAppContext } from "../../app/AppContext.js";
import { useTheme } from "../../ui/theme-provider.js";

function SettingsView(): React.JSX.Element {
  const { profile } = useAppContext();
  const theme = useTheme();

  const row = (label: string, value: string) =>
    React.createElement(
      Box,
      { key: label },
      React.createElement(Text, { color: theme.muted }, `  ${label}: `),
      React.createElement(Text, { color: theme.fg }, value)
    );

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(Text, { color: theme.accent, bold: true }, "⚙ Current Profile"),
    React.createElement(Box, { height: 1 }),
    row("Name", profile.name),
    row("Branch", profile.branch),
    row("Platform", profile.platform),
    row("Mode", profile.mode),
    row("Metro Port", String(profile.metroPort)),
    row("Build Variant", profile.buildVariant),
    row("Worktree", profile.worktree ?? "(default)"),
    row("Preflight", `${profile.preflight.checks.length} checks, ${profile.preflight.frequency}`),
    row("On-Save", profile.onSave.length > 0
      ? profile.onSave.filter(a => a.enabled).map(a => a.name).join(", ")
      : "none"
    ),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.accent, bold: true }, "🎨 Available Themes"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.muted }, "  midnight │ ember │ arctic │ neon-drive"),
    React.createElement(Text, { color: theme.muted }, "  Set via: rn-dev start --theme <name>"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.accent, bold: true }, "📦 Modules"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.muted }, "  🚀 Dev Space │ 🧪 Lint & Test │ 📡 Metro Logs │ ⚙ Settings"),
    React.createElement(Text, { color: theme.muted }, "  Add plugins via package.json \"rn-dev.plugins\" field"),
  );
}

export const settingsModule: RnDevModule = {
  id: "settings",
  name: "Settings",
  icon: "⚙",
  order: 90,
  component: SettingsView,
  shortcuts: [],
};
