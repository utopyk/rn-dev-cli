import React, { useState, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
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

  const FREQUENCY_ITEMS = [
    { label: "Only on first start (recommended)", value: "once" as const },
    { label: "Every time this profile is loaded", value: "always" as const },
  ];

  const [freqIndex, setFreqIndex] = useState(
    initialPreflight?.frequency === "always" ? 1 : 0
  );

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

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "escape") {
          if (phase === "frequency") {
            setPhase("checks");
          } else {
            onBack();
          }
          return;
        }

        if (phase === "checks") {
          if (event.name === "up") {
            setHighlightedIndex((prev) =>
              prev > 0 ? prev - 1 : totalItems - 1
            );
          } else if (event.name === "down") {
            setHighlightedIndex((prev) =>
              prev < totalItems - 1 ? prev + 1 : 0
            );
          } else if (event.name === "return" || event.name === " ") {
            if (highlightedIndex < checksList.length) {
              const check = checksList[highlightedIndex];
              if (check) {
                toggleCheck(check.id);
              }
            } else if (highlightedIndex === checksList.length) {
              selectAll();
            } else {
              deselectAll();
            }
          } else if (event.name === "a") {
            selectAll();
          } else if (event.name === "n") {
            deselectAll();
          } else if (event.name === "c") {
            if (selectedIds.size > 0) {
              setPhase("frequency");
            } else {
              onNext({ checks: [], frequency: "once" });
            }
          }
        } else if (phase === "frequency") {
          if (event.name === "up") {
            setFreqIndex((prev) =>
              prev > 0 ? prev - 1 : FREQUENCY_ITEMS.length - 1
            );
          } else if (event.name === "down") {
            setFreqIndex((prev) =>
              prev < FREQUENCY_ITEMS.length - 1 ? prev + 1 : 0
            );
          } else if (event.name === "return") {
            const item = FREQUENCY_ITEMS[freqIndex];
            if (item) {
              onNext({
                checks: Array.from(selectedIds),
                frequency: item.value,
              });
            }
          }
        }
      },
      [phase, highlightedIndex, totalItems, checksList, selectedIds, onBack, onNext, freqIndex]
    )
  );

  // -------------------------------------------------------------------------
  // Phase: checks
  // -------------------------------------------------------------------------

  if (phase === "checks") {
    return (
      <box flexDirection="column">
        <text color={theme.fg} bold>
          Which preflight checks do you want to run?
        </text>
        <box marginTop={1} flexDirection="column">
          {checksList.map((check, index) => {
            const isHighlighted = index === highlightedIndex;
            const isSelected = selectedIds.has(check.id);

            return (
              <box key={check.id} paddingLeft={1} paddingRight={1}>
                <text
                  color={isHighlighted ? theme.accent : theme.fg}
                  bold={isHighlighted}
                  inverse={isHighlighted}
                >
                  {isSelected ? "\u2611 " : "\u2610 "}
                  {check.name}
                  <span color={theme.muted}>
                    {" "}
                    ({check.platform === "all" ? "all platforms" : check.platform})
                  </span>
                </text>
              </box>
            );
          })}

          {/* Action rows */}
          <box marginTop={1} paddingLeft={1} paddingRight={1}>
            <text
              color={highlightedIndex === checksList.length ? theme.accent : theme.muted}
              bold={highlightedIndex === checksList.length}
              inverse={highlightedIndex === checksList.length}
            >
              Select all [a]
            </text>
            <text color={theme.muted}> / </text>
            <text
              color={highlightedIndex === checksList.length + 1 ? theme.accent : theme.muted}
              bold={highlightedIndex === checksList.length + 1}
              inverse={highlightedIndex === checksList.length + 1}
            >
              Deselect all [n]
            </text>
          </box>
        </box>

        <box marginTop={1}>
          <text color={theme.muted}>
            {"\u2191\u2193"} navigate {"\u00b7"} Space/Enter toggle {"\u00b7"} [c] continue {"\u00b7"} Esc go back
          </text>
        </box>
        <box>
          <text color={theme.muted}>
            {selectedIds.size}/{checksList.length} checks selected
          </text>
        </box>
      </box>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: frequency
  // -------------------------------------------------------------------------

  return (
    <box flexDirection="column">
      <text color={theme.fg} bold>
        When should preflights run?
      </text>
      <box marginTop={1} flexDirection="column">
        {FREQUENCY_ITEMS.map((item, index) => {
          const isSelected = index === freqIndex;
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
        <text color={theme.muted}>Press Esc to go back to check selection</text>
      </box>
    </box>
  );
}
