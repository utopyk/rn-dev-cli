import React from "react";
import { useTheme } from "../theme-provider.js";

export interface ShortcutBarProps {
  shortcuts: Array<{ key: string; label: string }>;
}

export function ShortcutBar({ shortcuts }: ShortcutBarProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <box flexDirection="row" gap={1} height={1} paddingLeft={1} backgroundColor={theme.bg}>
      {shortcuts.map((shortcut) => (
        <text key={shortcut.key}>
          <span color={theme.accent} bold>{`[${shortcut.key}]`}</span>
          <span color={theme.fg}>{` ${shortcut.label}`}</span>
        </text>
      ))}
    </box>
  );
}
