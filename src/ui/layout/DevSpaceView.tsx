import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { LogViewer } from "../components/LogViewer.js";
import { useTheme } from "../theme-provider.js";

// Hand-crafted double-line box-drawing logo
const MINI_LOGO = [
  "\u2566\u2550\u2557\u2554\u2557\u2557  \u2566\u2550\u2557\u2554\u2550\u2557\u2566  \u2566",
  "\u2560\u2566\u255d\u2551\u2551\u2551  \u2551 \u2551\u2560\u2550  \u2551\u2551",
  "\u2569\u255a\u2550\u255d\u255a\u255d  \u2569\u2550\u255d\u255a\u2550\u255d \u255a\u255d",
];

type FocusedPanel = "tool" | "metro";

export interface DevSpaceShortcut {
  key: string;
  label: string;
  action: () => void;
}

export interface DevSpaceViewProps {
  metroLines: string[];
  toolOutputLines: string[];
  shortcuts: DevSpaceShortcut[];
  wizardContent?: React.ReactNode;
  buildPhase?: string | null;
}

export function DevSpaceView({
  metroLines,
  toolOutputLines,
  shortcuts,
  wizardContent,
  buildPhase,
}: DevSpaceViewProps): React.JSX.Element {
  const theme = useTheme();
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("tool");

  // Toggle focus between panels with f key (disabled during wizard)
  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (wizardContent) return;
        if (event.name === "f") {
          setFocusedPanel((prev) => (prev === "tool" ? "metro" : "tool"));
        }
      },
      [wizardContent]
    )
  );

  const toolTitle = wizardContent
    ? "Setup Wizard"
    : focusedPanel === "tool"
    ? "Tool Output \u25c0"
    : "Tool Output";

  const metroTitle = focusedPanel === "metro"
    ? "Metro Output \u25c0"
    : "Metro Output";

  return (
    <box flexDirection="row" flexGrow={1} backgroundColor={theme.bg}>
      {/* Left panel: shortcuts list with mini logo */}
      <box
        flexDirection="column"
        width="28%"
        borderStyle="single"
        borderColor={theme.border}
        paddingLeft={1}
        paddingTop={1}
        backgroundColor={theme.bg}
      >
        {/* Gradient logo */}
        <text color={theme.error} bold>{MINI_LOGO[0]}</text>
        <text color={theme.highlight} bold>{MINI_LOGO[1]}</text>
        <text color={theme.accent} bold>{MINI_LOGO[2]}</text>
        <text> </text>

        {/* Shortcuts */}
        {shortcuts.map((s) => (
          <text key={s.key}>
            <span color={theme.accent} bold>[{s.key}]</span>
            <span color={theme.fg}> {s.label}</span>
          </text>
        ))}
        <text> </text>
        <text color={theme.muted}>{"[f] focus [↑↓] scroll"}</text>
        <text color={theme.muted}>[Tab] switch tab [p] profile</text>
      </box>

      {/* Right side: tool output + metro output stacked */}
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg}>
        {/* Tool output or wizard — fixed 50% */}
        <box height="50%" flexDirection="column" overflow="hidden" onMouseDown={() => setFocusedPanel("tool")}>
          {wizardContent ? (
            <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg}>
              <box paddingLeft={1} backgroundColor={theme.bg}>
                <text color={theme.accent} bold>{"\u2500"} {toolTitle} {"\u2500"}</text>
              </box>
              <box
                borderStyle="single"
                borderColor={theme.accent}
                flexGrow={1}
                paddingLeft={1}
                overflow="hidden"
                backgroundColor={theme.bg}
              >
                {wizardContent}
              </box>
            </box>
          ) : (
            <LogViewer
              lines={toolOutputLines}
              follow={true}
              title={toolTitle}
              buildPhase={buildPhase}
              scrollable={focusedPanel === "tool"}
              focused={focusedPanel === "tool"}
            />
          )}
        </box>

        {/* Metro output — fixed 50% */}
        <box height="50%" flexDirection="column" overflow="hidden" onMouseDown={() => setFocusedPanel("metro")}>
          <LogViewer
            lines={metroLines}
            follow={true}
            title={metroTitle}
            scrollable={focusedPanel === "metro"}
            focused={focusedPanel === "metro"}
          />
        </box>
      </box>
    </box>
  );
}
