import React, { useState } from "react";
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
  focused?: boolean;
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
  focused = false,
}: PanelProps): React.JSX.Element {
  const theme = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  const resolvedBorderColor = focused
    ? theme.accent
    : borderColor ?? theme.border;

  const indicator = collapsible ? (isCollapsed ? "\u25b6 " : "\u25bc ") : "";

  const titleDisplay = title
    ? `\u2500 ${indicator}${title} \u2500`
    : undefined;

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={resolvedBorderColor}
      width={width as number | undefined}
      height={isCollapsed ? undefined : (height as number | undefined)}
      backgroundColor={focused ? theme.selection : undefined}
    >
      {titleDisplay && (
        <box marginTop={-1} marginLeft={1}>
          <text
            color={focused ? theme.accent : theme.fg}
            bold={focused}
            backgroundColor={focused ? theme.selection : undefined}
          >
            {titleDisplay}
          </text>
        </box>
      )}
      {!isCollapsed && (
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          {children}
        </box>
      )}
    </box>
  );
}
