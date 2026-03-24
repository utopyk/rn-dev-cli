import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../theme-provider.js";
import type { Platform } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformStepProps {
  initialValue?: Platform;
  onNext: (platform: Platform) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// PlatformStep
// ---------------------------------------------------------------------------

const PLATFORM_ITEMS: Array<{ label: string; value: Platform }> = [
  { label: "\ud83c\udf4e iOS", value: "ios" },
  { label: "\ud83e\udd16 Android", value: "android" },
  { label: "\ud83d\udcf1 Both", value: "both" },
];

export function PlatformStep({
  initialValue = "ios",
  onNext,
  onBack,
}: PlatformStepProps): React.JSX.Element {
  const theme = useTheme();

  const initialIndex = PLATFORM_ITEMS.findIndex(
    (item) => item.value === initialValue
  );

  const [selectedIndex, setSelectedIndex] = useState(
    initialIndex >= 0 ? initialIndex : 0
  );

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "escape") {
          onBack();
        } else if (event.name === "up") {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : PLATFORM_ITEMS.length - 1
          );
        } else if (event.name === "down") {
          setSelectedIndex((prev) =>
            prev < PLATFORM_ITEMS.length - 1 ? prev + 1 : 0
          );
        } else if (event.name === "return") {
          const item = PLATFORM_ITEMS[selectedIndex];
          if (item) {
            onNext(item.value);
          }
        }
      },
      [onBack, onNext, selectedIndex]
    )
  );

  return (
    <box flexDirection="column">
      <text color={theme.fg} bold>
        Select target platform:
      </text>
      <box marginTop={1} flexDirection="column">
        {PLATFORM_ITEMS.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box key={item.value} paddingLeft={1} paddingRight={1}>
              <text
                color={isSelected ? theme.accent : theme.fg}
                bold={isSelected}
                inverse={isSelected}
              >
                {isSelected ? "\u276f " : "  "}{item.label}
              </text>
            </box>
          );
        })}
      </box>
      <box marginTop={1}>
        <text color={theme.muted}>Press Esc to go back</text>
      </box>
    </box>
  );
}
