import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
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
  { label: "🍎 iOS", value: "ios" },
  { label: "🤖 Android", value: "android" },
  { label: "📱 Both", value: "both" },
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

  function handleSelect(item: { label: string; value: Platform }): void {
    onNext(item.value);
  }

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.fg} bold>
        Select target platform:
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={PLATFORM_ITEMS}
          initialIndex={initialIndex >= 0 ? initialIndex : 0}
          onSelect={handleSelect}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Press Esc to go back</Text>
      </Box>
    </Box>
  );
}
