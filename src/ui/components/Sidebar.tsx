import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme-provider.js";

export interface SidebarItem {
  id: string;
  icon: string;
  label: string;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
  width?: number;
}

export function Sidebar({
  items,
  activeId,
  onSelect,
  width = 12,
}: SidebarProps): React.JSX.Element {
  const theme = useTheme();
  const [focusIndex, setFocusIndex] = useState(() => {
    const idx = items.findIndex((item) => item.id === activeId);
    return idx >= 0 ? idx : 0;
  });

  useInput(
    useCallback(
      (_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
        if (key.upArrow) {
          setFocusIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        } else if (key.downArrow) {
          setFocusIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        } else if (key.return) {
          const item = items[focusIndex];
          if (item) {
            onSelect(item.id);
          }
        }
      },
      [items, focusIndex, onSelect]
    )
  );

  // Truncate label to fit width (icon + space + label)
  const maxLabelLen = width - 4;

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={theme.border} borderRight={true} borderLeft={false} borderTop={false} borderBottom={false}>
      {items.map((item, index) => {
        const isActive = item.id === activeId;
        const isFocused = index === focusIndex;
        const label = item.label.length > maxLabelLen
          ? item.label.slice(0, maxLabelLen)
          : item.label;

        return (
          <Box key={item.id} paddingLeft={1}>
            <Text
              color={isActive ? theme.accent : isFocused ? theme.highlight : theme.fg}
              bold={isActive}
              backgroundColor={isActive ? theme.selection : undefined}
              inverse={isFocused && !isActive}
            >
              {item.icon} {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
