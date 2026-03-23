import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RnDevModule } from "../../core/types.js";
import { useAppContext } from "../../app/AppContext.js";
import { useTheme } from "../../ui/theme-provider.js";
import { listThemes } from "../../ui/theme-provider.js";

function SettingsView(): React.JSX.Element {
  const { profile } = useAppContext();
  const theme = useTheme();
  const themes = listThemes();
  const [selectedTheme, setSelectedTheme] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedTheme((prev) => (prev > 0 ? prev - 1 : themes.length - 1));
    } else if (key.downArrow) {
      setSelectedTheme((prev) => (prev < themes.length - 1 ? prev + 1 : 0));
    }
  });

  const row = (label: string, value: string, valueColor?: string) =>
    React.createElement(
      Box,
      { key: label },
      React.createElement(Text, { color: theme.muted }, `  ${label}: `),
      React.createElement(Text, { color: valueColor ?? theme.fg, bold: !!valueColor }, value)
    );

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },

    // Current Profile section
    React.createElement(Text, { color: theme.accent, bold: true }, "⚙ Current Profile"),
    React.createElement(Box, { height: 1 }),
    row("Name", profile.name, theme.accent),
    row("Branch", profile.branch, theme.success),
    row("Platform", profile.platform),
    row("Mode", profile.mode, profile.mode === "ultra-clean" ? theme.warning : undefined),
    row("Metro Port", String(profile.metroPort)),
    row("Build Variant", profile.buildVariant),
    row("Worktree", profile.worktree ?? "(default)"),
    row("Preflight", `${profile.preflight.checks.length} checks, ${profile.preflight.frequency}`),
    row("On-Save", profile.onSave.length > 0
      ? profile.onSave.filter((a: { enabled: boolean }) => a.enabled).map((a: { name: string }) => a.name).join(", ")
      : "none"
    ),

    React.createElement(Box, { height: 1 }),

    // Themes section
    React.createElement(Text, { color: theme.accent, bold: true }, "🎨 Themes"),
    React.createElement(Text, { color: theme.muted }, "  Use ↑↓ to browse, set via: rn-dev start --theme <name>"),
    React.createElement(Box, { height: 1 }),
    ...themes.map((name: string, index: number) =>
      React.createElement(
        Box,
        { key: name, paddingLeft: 2 },
        React.createElement(
          Text,
          {
            color: index === selectedTheme ? theme.accent : theme.fg,
            bold: index === selectedTheme,
            backgroundColor: index === selectedTheme ? theme.selection : undefined,
          },
          `${index === selectedTheme ? "▸ " : "  "}${name}`
        )
      )
    ),

    React.createElement(Box, { height: 1 }),

    // Modules section
    React.createElement(Text, { color: theme.accent, bold: true }, "📦 Loaded Modules"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.fg }, "  🚀 Dev Space"),
    React.createElement(Text, { color: theme.fg }, "  🧪 Lint & Test"),
    React.createElement(Text, { color: theme.fg }, "  📡 Metro Logs"),
    React.createElement(Text, { color: theme.fg }, "  ⚙ Settings"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.muted, dimColor: true }, '  Add plugins via package.json "rn-dev.plugins" field'),

    React.createElement(Box, { height: 1 }),

    // Keyboard reference
    React.createElement(Text, { color: theme.accent, bold: true }, "⌨ Keyboard"),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: theme.fg }, "  [Tab] Switch module  [p] Toggle profile  [q] Quit"),
    React.createElement(Text, { color: theme.fg }, "  [r] Reload  [d] Dev Menu  [l] Lint  [t] Type Check"),
    React.createElement(Text, { color: theme.fg }, "  [c] Clean  [w] Toggle Watcher  [C] Clear Logs"),
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
