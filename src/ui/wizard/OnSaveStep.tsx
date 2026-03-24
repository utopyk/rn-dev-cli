import React, { useState, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
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

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (phase === "tools") {
          if (event.name === "escape") {
            onBack();
            return;
          }

          if (event.name === "s") {
            // Skip
            onNext([]);
            return;
          }

          if (event.name === "up") {
            setHighlightedIndex((prev) =>
              prev > 0 ? prev - 1 : totalToolRows - 1
            );
          } else if (event.name === "down") {
            setHighlightedIndex((prev) =>
              prev < totalToolRows - 1 ? prev + 1 : 0
            );
          } else if (event.name === "return" || event.name === " ") {
            if (highlightedIndex < detectedTools.length) {
              const tool = detectedTools[highlightedIndex];
              if (tool) {
                toggleTool(tool.name);
              }
            } else {
              // "Add custom command" row
              setPhase("custom");
            }
          } else if (event.name === "c") {
            // Confirm
            handleSubmit();
          }
        } else if (phase === "custom") {
          if (event.name === "escape") {
            setPhase("tools");
          }
        }
      },
      [phase, highlightedIndex, totalToolRows, detectedTools, onBack, onNext]
    )
  );

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
      <box flexDirection="column">
        <text color={theme.fg} bold>
          Enter custom on-save command:
        </text>
        <box marginTop={1}>
          <text color={theme.accent}>{"\u276f"} </text>
          <input
            focused={true}
            onInput={(val: string) => setCustomCommand(val)}
            onSubmit={handleCustomSubmit}
            placeholder="e.g. npx prettier --write {files}"
          />
        </box>
        <box marginTop={1}>
          <text color={theme.muted}>Press Esc to cancel</text>
        </box>
      </box>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: tool selection
  // -------------------------------------------------------------------------

  return (
    <box flexDirection="column">
      <text color={theme.fg} bold>
        Configure on-save actions:
      </text>

      {detectedTools.length === 0 ? (
        <box marginTop={1}>
          <text color={theme.muted}>
            No tools detected in this project.
          </text>
        </box>
      ) : (
        <box marginTop={1} flexDirection="column">
          {detectedTools.map((tool, index) => {
            const isHighlighted = index === highlightedIndex;
            const isEnabled = enabledNames.has(tool.name);

            return (
              <box key={tool.name} paddingLeft={1} paddingRight={1}>
                <text
                  color={isHighlighted ? theme.accent : theme.fg}
                  bold={isHighlighted}
                  inverse={isHighlighted}
                >
                  {isEnabled ? "\u2611 " : "\u2610 "}
                  {tool.label}
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* Custom actions already added */}
      {customActions.length > 0 && (
        <box marginTop={1} flexDirection="column">
          <text color={theme.muted}>Custom commands:</text>
          {customActions.map((action) => (
            <box key={action.name} paddingLeft={1} paddingRight={1}>
              <text color={theme.success}>+ {action.command}</text>
            </box>
          ))}
        </box>
      )}

      {/* "Add custom" row */}
      <box marginTop={1} paddingLeft={1} paddingRight={1}>
        <text
          color={
            highlightedIndex === detectedTools.length
              ? theme.accent
              : theme.muted
          }
          bold={highlightedIndex === detectedTools.length}
          inverse={highlightedIndex === detectedTools.length}
        >
          + Add custom command
        </text>
      </box>

      <box marginTop={1}>
        <text color={theme.muted}>
          {"\u2191\u2193"} navigate {"\u00b7"} Space/Enter toggle {"\u00b7"} [c] confirm {"\u00b7"} [s] skip {"\u00b7"} Esc go back
        </text>
      </box>
    </box>
  );
}
