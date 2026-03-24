import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import gradientString from "gradient-string";
import { Panel } from "../components/Panel.js";
import { LogViewer } from "../components/LogViewer.js";
import { useTheme } from "../theme-provider.js";
import { useMouse } from "../hooks/useMouse.js";

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
  const { height: screenHeight, width: screenWidth } = useScreenSize();
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("tool");

  // Calculate available height for the content area
  // MainLayout uses: tab bar (3) + profile banner (3) + separator (1) + shortcut bar (1) + status bar (1) = ~9
  const contentHeight = Math.max(10, screenHeight - 9);
  const topHalfHeight = Math.floor(contentHeight * 0.5);
  const bottomHalfHeight = contentHeight - topHalfHeight;

  // Toggle focus between panels with f key
  useInput(
    useCallback(
      (input: string) => {
        if (input === "f") {
          setFocusedPanel((prev) => (prev === "tool" ? "metro" : "tool"));
        }
      },
      []
    )
  );

  // Mouse click to focus panels — click on top half = tool, bottom half = metro
  // MainLayout overhead: tab bar (3) + profile (3) + separator (1) = 7 lines before content
  const contentStartY = 7;
  useMouse(
    useCallback(
      (event) => {
        if (event.type !== "press" || event.button !== "left") return;
        const relativeY = event.y - contentStartY;
        if (relativeY < 0) return;
        if (relativeY < topHalfHeight) {
          setFocusedPanel("tool");
        } else {
          setFocusedPanel("metro");
        }
      },
      [topHalfHeight]
    )
  );

  // Inside panels: border top (1) + title (0, overlayed) + border bottom (1) + padding = ~2
  const panelContentHeight = Math.max(3, topHalfHeight - 2);
  const metroPanelContentHeight = Math.max(3, bottomHalfHeight - 2);

  // Panel widths for background padding
  const shortcutPanelWidth = Math.floor(screenWidth * 0.35);
  const toolPanelWidth = screenWidth - shortcutPanelWidth;
  const metroPanelWidth = screenWidth;

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
                <Text color={theme.muted} dimColor>[f]/click focus [↑↓] scroll [m] mouse off (Shift+click=select)</Text>
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
            focused={focusedPanel === "tool"}
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
                focused={focusedPanel === "tool"}
                panelWidth={toolPanelWidth}
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
          focused={focusedPanel === "metro"}
        >
          <LogViewer
            lines={metroLines}
            follow={true}
            maxVisibleLines={metroPanelContentHeight}
            scrollable={focusedPanel === "metro"}
            focused={focusedPanel === "metro"}
            panelWidth={metroPanelWidth}
          />
        </Panel>
      </Box>
    </Box>
  );
}
