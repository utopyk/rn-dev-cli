import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import gradientString from "gradient-string";
import { Panel } from "../components/Panel.js";
import { LogViewer } from "../components/LogViewer.js";
import { useTheme } from "../theme-provider.js";

// Hand-crafted double-line box-drawing logo
const MINI_LOGO = [
  "╦═╗╔╗╗  ╦═╗╔═╗╦  ╦",
  "╠╦╝║║║  ║ ║╠═  ║║",
  "╩╚═╝╚╝  ╩═╝╚═╝ ╚╝",
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
  const { height: screenHeight } = useScreenSize();
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("tool");

  // Toggle focus between panels with F key
  useInput(
    useCallback(
      (input: string) => {
        if (input === "F" || input === "f" && false) {
          // Only uppercase F toggles focus (lowercase f is Filter Logs shortcut)
          setFocusedPanel((prev) => (prev === "tool" ? "metro" : "tool"));
        }
      },
      []
    )
  );

  // Calculate available height for the content area
  // MainLayout uses: tab bar (3) + profile banner (3) + separator (1) + shortcut bar (1) + status bar (1) = ~9
  const contentHeight = Math.max(10, screenHeight - 9);
  const topHalfHeight = Math.floor(contentHeight * 0.5);
  const bottomHalfHeight = contentHeight - topHalfHeight;

  // Inside panels: border top (1) + title (0, overlayed) + border bottom (1) + padding = ~2
  const panelContentHeight = Math.max(3, topHalfHeight - 2);
  const metroPanelContentHeight = Math.max(3, bottomHalfHeight - 2);

  const toolTitle = wizardContent
    ? "Setup Wizard"
    : focusedPanel === "tool"
    ? "Tool Output ◀"
    : "Tool Output";

  const metroTitle = focusedPanel === "metro"
    ? "Metro Output ◀"
    : "Metro Output";

  return (
    <Box flexDirection="column" height={contentHeight}>
      {/* Top half: shortcuts + tool output side by side */}
      <Box flexDirection="row" height={topHalfHeight}>
        {/* Left panel: shortcuts list with mini logo */}
        <Box width="35%">
          <Panel title="Shortcuts" width="100%" height={topHalfHeight}>
            <Box flexDirection="column">
              {/* Gradient logo */}
              <Box flexDirection="column" marginBottom={1}>
                <Text>{gradientString("cyan", "magenta", "yellow").multiline(MINI_LOGO.join("\n"))}</Text>
              </Box>
              {/* Shortcuts */}
              {shortcuts.map((s) => (
                <Box key={s.key}>
                  <Text color={theme.accent} bold>{`[${s.key}]`}</Text>
                  <Text color={theme.fg}> {s.label}</Text>
                </Box>
              ))}
              <Box marginTop={1}>
                <Text color={theme.muted} dimColor>[F] switch scroll focus</Text>
              </Box>
            </Box>
          </Panel>
        </Box>

        {/* Right panel: tool output or wizard */}
        <Box flexGrow={1}>
          <Panel
            title={toolTitle}
            width="100%"
            height={topHalfHeight}
            borderColor={focusedPanel === "tool" ? theme.accent : theme.border}
          >
            {wizardContent ? (
              <Box flexDirection="column" paddingX={1}>
                {wizardContent}
              </Box>
            ) : (
              <LogViewer
                lines={toolOutputLines}
                follow={true}
                maxVisibleLines={panelContentHeight}
                buildPhase={buildPhase}
                scrollable={focusedPanel === "tool"}
              />
            )}
          </Panel>
        </Box>
      </Box>

      {/* Bottom half: Metro output */}
      <Box height={bottomHalfHeight}>
        <Panel
          title={metroTitle}
          width="100%"
          height={bottomHalfHeight}
          borderColor={focusedPanel === "metro" ? theme.accent : theme.border}
        >
          <LogViewer
            lines={metroLines}
            follow={true}
            maxVisibleLines={metroPanelContentHeight}
            scrollable={focusedPanel === "metro"}
          />
        </Panel>
      </Box>
    </Box>
  );
}
