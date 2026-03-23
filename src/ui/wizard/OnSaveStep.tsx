import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "../theme-provider.js";
import { detectTooling, toolToOnSaveAction } from "../../core/tooling-detector.js";
import type { OnSaveAction } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnSaveStepProps {
  projectRoot: string;
  initialOnSave?: OnSaveAction[];
  onNext: (onSave: OnSaveAction[]) => void;
  onBack: () => void;
}

type OnSavePhase = "tools" | "custom";

// ---------------------------------------------------------------------------
// OnSaveStep
// ---------------------------------------------------------------------------

export function OnSaveStep({
  projectRoot,
  initialOnSave,
  onNext,
  onBack,
}: OnSaveStepProps): React.JSX.Element {
  const theme = useTheme();

  const detectedTools = useMemo(
    () => detectTooling(projectRoot),
    [projectRoot]
  );

  // Build initial enabled set from existing onSave config or enable all by default
  const [enabledNames, setEnabledNames] = useState<Set<string>>(() => {
    if (initialOnSave && initialOnSave.length > 0) {
      return new Set(
        initialOnSave.filter((a) => a.enabled).map((a) => a.name)
      );
    }
    return new Set(detectedTools.map((t) => t.name));
  });

  const [phase, setPhase] = useState<OnSavePhase>("tools");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [customCommand, setCustomCommand] = useState("");

  // Custom commands added during this session
  const [customActions, setCustomActions] = useState<OnSaveAction[]>(() => {
    if (!initialOnSave) return [];
    return initialOnSave.filter(
      (a) => !detectedTools.some((t) => t.name === a.name)
    );
  });

  const totalToolRows = detectedTools.length + 1; // +1 for "Add custom command"

  function toggleTool(name: string): void {
    setEnabledNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function buildOnSaveActions(): OnSaveAction[] {
    const toolActions = detectedTools.map((t) =>
      toolToOnSaveAction(t, enabledNames.has(t.name))
    );
    return [...toolActions, ...customActions];
  }

  function handleSubmit(): void {
    onNext(buildOnSaveActions());
  }

  useInput((_input, key) => {
    if (phase === "tools") {
      if (key.escape) {
        onBack();
        return;
      }

      if (_input === "s") {
        // Skip
        onNext([]);
        return;
      }

      if (key.upArrow) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : totalToolRows - 1
        );
      } else if (key.downArrow) {
        setHighlightedIndex((prev) =>
          prev < totalToolRows - 1 ? prev + 1 : 0
        );
      } else if (key.return || _input === " ") {
        if (highlightedIndex < detectedTools.length) {
          const tool = detectedTools[highlightedIndex];
          if (tool) {
            toggleTool(tool.name);
          }
        } else {
          // "Add custom command" row
          setPhase("custom");
        }
      } else if (_input === "c") {
        // Confirm
        handleSubmit();
      }
    } else if (phase === "custom") {
      if (key.escape) {
        setPhase("tools");
      }
    }
  });

  // -------------------------------------------------------------------------
  // Phase: custom command entry
  // -------------------------------------------------------------------------

  if (phase === "custom") {
    function handleCustomSubmit(value: string): void {
      if (value.trim()) {
        const action: OnSaveAction = {
          name: `custom-${customActions.length + 1}`,
          enabled: true,
          haltOnFailure: false,
          command: value.trim(),
          glob: "src/**/*.{ts,tsx,js,jsx}",
          showOutput: "tool-panel",
        };
        setCustomActions((prev) => [...prev, action]);
      }
      setCustomCommand("");
      setPhase("tools");
    }

    return (
      <Box flexDirection="column">
        <Text color={theme.fg} bold>
          Enter custom on-save command:
        </Text>
        <Box marginTop={1}>
          <Text color={theme.accent}>{"\u276f"} </Text>
          <TextInput
            value={customCommand}
            onChange={setCustomCommand}
            onSubmit={handleCustomSubmit}
            placeholder="e.g. npx prettier --write {files}"
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Press Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: tool selection
  // -------------------------------------------------------------------------

  return (
    <Box flexDirection="column">
      <Text color={theme.fg} bold>
        Configure on-save actions:
      </Text>

      {detectedTools.length === 0 ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>
            No tools detected in this project.
          </Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {detectedTools.map((tool, index) => {
            const isHighlighted = index === highlightedIndex;
            const isEnabled = enabledNames.has(tool.name);

            return (
              <Box key={tool.name} paddingX={1}>
                <Text
                  color={isHighlighted ? theme.accent : theme.fg}
                  bold={isHighlighted}
                  inverse={isHighlighted}
                >
                  {isEnabled ? "☑ " : "☐ "}
                  {tool.label}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Custom actions already added */}
      {customActions.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>Custom commands:</Text>
          {customActions.map((action) => (
            <Box key={action.name} paddingX={1}>
              <Text color={theme.success}>+ {action.command}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* "Add custom" row */}
      <Box marginTop={1} paddingX={1}>
        <Text
          color={
            highlightedIndex === detectedTools.length
              ? theme.accent
              : theme.muted
          }
          bold={highlightedIndex === detectedTools.length}
          inverse={highlightedIndex === detectedTools.length}
        >
          + Add custom command
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>
          ↑↓ navigate · Space/Enter toggle · [c] confirm · [s] skip · Esc go back
        </Text>
      </Box>
    </Box>
  );
}
