import React, { useState, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
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

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "up") {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : visibleItems.length - 1
          );
        } else if (event.name === "down") {
          setSelectedIndex((prev) =>
            prev < visibleItems.length - 1 ? prev + 1 : 0
          );
        } else if (event.name === "return") {
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
    <box flexDirection="column">
      <box flexDirection="row">
        <text color={theme.accent}>{"\u276f"} </text>
        <input
          focused={true}
          onInput={handleQueryChange}
          placeholder={placeholder}
        />
      </box>
      <box flexDirection="column" marginTop={1}>
        {visibleItems.map((item, index) => {
          const label = String(item[labelKey] ?? "");
          const isSelected = index === selectedIndex;

          return (
            <box key={label + index} paddingLeft={1} paddingRight={1}>
              <text
                color={isSelected ? theme.accent : theme.fg}
                bold={isSelected}
                inverse={isSelected}
              >
                {isSelected ? "\u276f " : "  "}
                {label}
              </text>
            </box>
          );
        })}
        {visibleItems.length === 0 && (
          <box paddingLeft={1} paddingRight={1}>
            <text color={theme.muted}>No results</text>
          </box>
        )}
      </box>
      {filteredItems.length > maxVisible && (
        <box paddingLeft={1} paddingRight={1}>
          <text color={theme.muted}>
            {filteredItems.length - maxVisible} more items...
          </text>
        </box>
      )}
    </box>
  );
}
