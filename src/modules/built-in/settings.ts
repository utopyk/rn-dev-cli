import React from "react";
import { Text } from "ink";
import type { RnDevModule } from "../../core/types.js";

// Placeholder component — will be fleshed out later
function SettingsView(): React.JSX.Element {
  return React.createElement(
    Text,
    null,
    "Settings - Theme, Profile Manager, Plugin Manager"
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
