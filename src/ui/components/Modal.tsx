import React, { useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
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
  icon = "\u26a0",
  width: explicitWidth,
}: ModalProps): React.JSX.Element {
  const theme = useTheme();
  const [screenWidth, screenHeight] = useTerminalDimensions();

  const modalWidth = explicitWidth ?? Math.min(60, screenWidth - 10);

  // Capture action keys
  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        const action = actions.find((a) => a.key.toLowerCase() === event.name.toLowerCase());
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
    <box
      width={screenWidth}
      height={screenHeight - 8}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={modalWidth}
        borderStyle="single"
        borderColor={theme.accent}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        {/* Title bar */}
        <box justifyContent="center" marginBottom={1}>
          <text color={theme.accent} bold>
            {icon} {title}
          </text>
        </box>

        {/* Message */}
        <box flexDirection="column" marginBottom={1}>
          {wrappedLines.map((line, i) => (
            <text key={i} color={theme.fg}>
              {line}
            </text>
          ))}
        </box>

        {/* Separator */}
        <text color={theme.border}>{"\u2500".repeat(modalWidth - 6)}</text>

        {/* Actions */}
        <box marginTop={1} gap={2} justifyContent="center">
          {actions.map((action) => (
            <box key={action.key}>
              <text
                color={action.danger ? theme.error : action.accent ? theme.accent : theme.fg}
                bold={action.accent}
              >
                [{action.key}] {action.label}
              </text>
            </box>
          ))}
        </box>
      </box>
    </box>
  );
}
