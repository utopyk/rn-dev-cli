import React, { useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-provider.js";

export interface PanelProps {
  title?: string;
  width?: number | string;
  height?: number | string;
  borderColor?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Panel({
  title,
  width,
  height,
  borderColor,
  children,
  collapsible = false,
  collapsed: controlledCollapsed,
  onToggle,
}: PanelProps): React.JSX.Element {
  const theme = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  const resolvedBorderColor = borderColor ?? theme.border;
  const indicator = collapsible ? (isCollapsed ? "\u25b6 " : "\u25bc ") : "";

  const titleDisplay = title
    ? `\u2500 ${indicator}${title} \u2500`
    : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={resolvedBorderColor}
      width={width as number | undefined}
      height={isCollapsed ? undefined : (height as number | undefined)}
    >
      {titleDisplay && (
        <Box marginTop={-1} marginLeft={1}>
          <Text
            color={theme.accent}
            bold
          >
            {titleDisplay}
          </Text>
        </Box>
      )}
      {!isCollapsed && (
        <Box flexDirection="column" paddingX={1}>
          {children}
        </Box>
      )}
    </Box>
  );
}
