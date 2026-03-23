import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "../theme-provider.js";
import { createDefaultPreflightEngine } from "../../core/preflight.js";
import type { Platform, PreflightConfig } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightStepProps {
  projectRoot: string;
  platform: Platform;
  initialPreflight?: PreflightConfig;
  onNext: (preflight: PreflightConfig) => void;
  onBack: () => void;
}

type PreflightPhase = "checks" | "frequency";

// ---------------------------------------------------------------------------
// PreflightStep
// ---------------------------------------------------------------------------

export function PreflightStep({
  projectRoot,
  platform,
  initialPreflight,
  onNext,
  onBack,
}: PreflightStepProps): React.JSX.Element {
  const theme = useTheme();

  const engine = useMemo(
    () => createDefaultPreflightEngine(projectRoot),
    [projectRoot]
  );

  const availableChecks = useMemo(
    () => engine.getChecksForPlatform(platform),
    [engine, platform]
  );

  const [phase, setPhase] = useState<PreflightPhase>("checks");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialPreflight?.checks ?? availableChecks.map((c) => c.id))
  );
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const checksList = availableChecks;
  const totalItems = checksList.length + 2; // +2 for "select all" and "deselect all"

  function toggleCheck(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll(): void {
    setSelectedIds(new Set(checksList.map((c) => c.id)));
  }

  function deselectAll(): void {
    setSelectedIds(new Set());
  }

  const FREQUENCY_ITEMS = [
    { label: "Only on first start (recommended)", value: "once" as const },
    { label: "Every time this profile is loaded", value: "always" as const },
  ];

  function handleFrequencySelect(item: {
    label: string;
    value: "once" | "always";
  }): void {
    onNext({
      checks: Array.from(selectedIds),
      frequency: item.value,
    });
  }

  useInput((_input, key) => {
    if (key.escape) {
      if (phase === "frequency") {
        setPhase("checks");
      } else {
        onBack();
      }
      return;
    }

    if (phase === "checks") {
      if (key.upArrow) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : totalItems - 1
        );
      } else if (key.downArrow) {
        setHighlightedIndex((prev) =>
          prev < totalItems - 1 ? prev + 1 : 0
        );
      } else if (key.return || _input === " ") {
        // Select/deselect item or action
        if (highlightedIndex < checksList.length) {
          const check = checksList[highlightedIndex];
          if (check) {
            toggleCheck(check.id);
          }
        } else if (highlightedIndex === checksList.length) {
          // "Select all" row
          selectAll();
        } else {
          // "Deselect all" row
          deselectAll();
        }
      } else if (_input === "a") {
        selectAll();
      } else if (_input === "n") {
        deselectAll();
      } else if (_input === "c" || (key.return && highlightedIndex >= checksList.length - 1)) {
        // Advance to frequency phase
        if (selectedIds.size > 0) {
          setPhase("frequency");
        } else {
          // Skip frequency step if no checks selected
          onNext({ checks: [], frequency: "once" });
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Phase: checks
  // -------------------------------------------------------------------------

  if (phase === "checks") {
    return (
      <Box flexDirection="column">
        <Text color={theme.fg} bold>
          Which preflight checks do you want to run?
        </Text>
        <Box marginTop={1} flexDirection="column">
          {checksList.map((check, index) => {
            const isHighlighted = index === highlightedIndex;
            const isSelected = selectedIds.has(check.id);

            return (
              <Box key={check.id} paddingX={1}>
                <Text
                  color={isHighlighted ? theme.accent : theme.fg}
                  bold={isHighlighted}
                  inverse={isHighlighted}
                >
                  {isSelected ? "☑ " : "☐ "}
                  {check.name}
                  <Text color={theme.muted}>
                    {" "}
                    ({check.platform === "all" ? "all platforms" : check.platform})
                  </Text>
                </Text>
              </Box>
            );
          })}

          {/* Action rows */}
          <Box marginTop={1} paddingX={1}>
            <Text
              color={highlightedIndex === checksList.length ? theme.accent : theme.muted}
              bold={highlightedIndex === checksList.length}
              inverse={highlightedIndex === checksList.length}
            >
              Select all [a]
            </Text>
            <Text color={theme.muted}> / </Text>
            <Text
              color={highlightedIndex === checksList.length + 1 ? theme.accent : theme.muted}
              bold={highlightedIndex === checksList.length + 1}
              inverse={highlightedIndex === checksList.length + 1}
            >
              Deselect all [n]
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text color={theme.muted}>
            ↑↓ navigate · Space/Enter toggle · [c] continue · Esc go back
          </Text>
        </Box>
        <Box>
          <Text color={theme.muted}>
            {selectedIds.size}/{checksList.length} checks selected
          </Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: frequency
  // -------------------------------------------------------------------------

  return (
    <Box flexDirection="column">
      <Text color={theme.fg} bold>
        When should preflights run?
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={FREQUENCY_ITEMS}
          initialIndex={
            initialPreflight?.frequency === "always" ? 1 : 0
          }
          onSelect={handleFrequencySelect}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Press Esc to go back to check selection</Text>
      </Box>
    </Box>
  );
}
