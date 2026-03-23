import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-provider.js";

export interface ShortcutBarProps {
  shortcuts: Array<{ key: string; label: string }>;
}

export function ShortcutBar({ shortcuts }: ShortcutBarProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box gap={1} flexWrap="wrap">
      {shortcuts.map((shortcut) => (
        <Box key={shortcut.key}>
          <Text color={theme.accent} bold>{`[${shortcut.key}]`}</Text>
          <Text color={theme.fg}>{` ${shortcut.label}`}</Text>
        </Box>
      ))}
    </Box>
  );
}
