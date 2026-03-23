import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Fuse from "fuse.js";
import { useTheme } from "../theme-provider.js";

export interface SearchableListProps<T> {
  items: T[];
  labelKey: string;
  searchKeys?: string[];
  onSelect: (item: T) => void;
  placeholder?: string;
  maxVisible?: number;
}

export function SearchableList<T extends Record<string, unknown>>({
  items,
  labelKey,
  searchKeys,
  onSelect,
  placeholder = "Search...",
  maxVisible = 10,
}: SearchableListProps<T>): React.JSX.Element {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: searchKeys ?? [labelKey],
        threshold: 0.4,
      }),
    [items, searchKeys, labelKey]
  );

  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return items;
    }
    return fuse.search(query).map((result) => result.item);
  }, [query, items, fuse]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, maxVisible),
    [filteredItems, maxVisible]
  );

  // Reset selection when query changes
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  }, []);

  useInput(
    useCallback(
      (_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
        if (key.upArrow) {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : visibleItems.length - 1
          );
        } else if (key.downArrow) {
          setSelectedIndex((prev) =>
            prev < visibleItems.length - 1 ? prev + 1 : 0
          );
        } else if (key.return) {
          const item = visibleItems[selectedIndex];
          if (item) {
            onSelect(item);
          }
        }
      },
      [visibleItems, selectedIndex, onSelect]
    )
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent}>{"\u276f"} </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          placeholder={placeholder}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleItems.map((item, index) => {
          const label = String(item[labelKey] ?? "");
          const isSelected = index === selectedIndex;

          return (
            <Box key={label + index} paddingX={1}>
              <Text
                color={isSelected ? theme.accent : theme.fg}
                bold={isSelected}
                inverse={isSelected}
              >
                {isSelected ? "\u276f " : "  "}
                {label}
              </Text>
            </Box>
          );
        })}
        {visibleItems.length === 0 && (
          <Box paddingX={1}>
            <Text color={theme.muted}>No results</Text>
          </Box>
        )}
      </Box>
      {filteredItems.length > maxVisible && (
        <Box paddingX={1}>
          <Text color={theme.muted}>
            {filteredItems.length - maxVisible} more items...
          </Text>
        </Box>
      )}
    </Box>
  );
}
