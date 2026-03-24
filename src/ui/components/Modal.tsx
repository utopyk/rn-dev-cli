import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme-provider.js";

export interface ModalAction {
  label: string;
  key: string;         // shortcut key, e.g. "y", "n", "c"
  accent?: boolean;    // highlight this action
  danger?: boolean;    // red color
}

export interface ModalProps {
  title: string;
  message: string;
  actions: ModalAction[];
  onAction: (key: string) => void;
  icon?: string;
  width?: number;
}

/**
 * A centered modal overlay that captures keyboard input.
 * Renders on top of the content area — parent must conditionally
 * render this instead of normal content when modal is active.
 */
export function Modal({
  title,
  message,
  actions,
  onAction,
  icon = "⚠",
  width: explicitWidth,
}: ModalProps): React.JSX.Element {
  const theme = useTheme();
  const { width: screenWidth, height: screenHeight } = useScreenSize();

  const modalWidth = explicitWidth ?? Math.min(60, screenWidth - 10);
  const modalHeight = Math.min(12, screenHeight - 6);

  // Capture action keys
  useInput(
    useCallback(
      (input: string) => {
        const action = actions.find((a) => a.key.toLowerCase() === input.toLowerCase());
        if (action) {
          onAction(action.key);
        }
      },
      [actions, onAction]
    )
  );

  // Wrap message text to fit modal width (simple word wrap)
  const maxLineWidth = modalWidth - 6; // borders + padding
  const wrappedLines: string[] = [];
  for (const paragraph of message.split("\n")) {
    if (paragraph.length <= maxLineWidth) {
      wrappedLines.push(paragraph);
    } else {
      const words = paragraph.split(" ");
      let currentLine = "";
      for (const word of words) {
        if (currentLine.length + word.length + 1 > maxLineWidth) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = currentLine ? `${currentLine} ${word}` : word;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    }
  }

  return (
    <Box
      width={screenWidth}
      height={screenHeight - 8} // content area height approx
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        width={modalWidth}
        borderStyle="bold"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
      >
        {/* Title bar */}
        <Box justifyContent="center" marginBottom={1}>
          <Text color={theme.accent} bold>
            {icon} {title}
          </Text>
        </Box>

        {/* Message */}
        <Box flexDirection="column" marginBottom={1}>
          {wrappedLines.map((line, i) => (
            <Text key={i} color={theme.fg}>
              {line}
            </Text>
          ))}
        </Box>

        {/* Separator */}
        <Text color={theme.border}>{"─".repeat(modalWidth - 6)}</Text>

        {/* Actions */}
        <Box marginTop={1} gap={2} justifyContent="center">
          {actions.map((action) => (
            <Box key={action.key}>
              <Text
                color={action.danger ? theme.error : action.accent ? theme.accent : theme.fg}
                bold={action.accent}
              >
                [{action.key}] {action.label}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
