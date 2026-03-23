import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "../theme-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunMode = "dirty" | "clean" | "ultra-clean";

export interface ModeStepProps {
  initialValue?: RunMode;
  onNext: (mode: RunMode) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// ModeStep
// ---------------------------------------------------------------------------

const MODE_ITEMS: Array<{ label: string; value: RunMode }> = [
  {
    label: "🟢 Dirty — Start Metro immediately (fastest)",
    value: "dirty",
  },
  {
    label: "🟡 Clean — Reinstall modules + pods, then start",
    value: "clean",
  },
  {
    label: "🔴 Ultra Clean — Full nuclear clean + reinstall",
    value: "ultra-clean",
  },
];

export function ModeStep({
  initialValue = "dirty",
  onNext,
  onBack,
}: ModeStepProps): React.JSX.Element {
  const theme = useTheme();

  const initialIndex = MODE_ITEMS.findIndex(
    (item) => item.value === initialValue
  );

  function handleSelect(item: { label: string; value: RunMode }): void {
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
        Select run mode:
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={MODE_ITEMS}
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
