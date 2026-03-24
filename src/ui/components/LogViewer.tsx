import React, { useMemo } from "react";
import { useTheme } from "../theme-provider.js";
import { Spinner } from "./Spinner.js";

export interface LogViewerProps {
  lines: string[];
  maxLines?: number;
  follow?: boolean;
  height?: number | string;
  title?: string;
  buildPhase?: string | null;
  scrollable?: boolean;
  focused?: boolean;
  panelWidth?: number;
}

function getLineColor(line: string, theme: { fg: string; error: string; warning: string; success: string; accent: string }): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("error ") || trimmed.startsWith("\u274c") || trimmed.startsWith("\u2716") || trimmed.startsWith("\u2717")) {
    return theme.error;
  }
  if (trimmed.startsWith("warn ") || trimmed.startsWith("\u26a0")) {
    return theme.warning;
  }
  if (trimmed.startsWith("\u2714") || trimmed.startsWith("\u2705") || trimmed.startsWith("success ")) {
    return theme.success;
  }
  if (trimmed.startsWith("\u23f3") || trimmed.startsWith("\u25b6") || trimmed.startsWith("Building")) {
    return theme.accent;
  }
  return theme.fg;
}

export function LogViewer({
  lines,
  maxLines = 500,
  follow = true,
  height,
  title,
  buildPhase,
  scrollable = true,
  focused = false,
  panelWidth,
}: LogViewerProps): React.JSX.Element {
  const theme = useTheme();

  // Trim to buffer limit
  const bufferedLines = useMemo(() => {
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  }, [lines, maxLines]);

  const focusBg = focused ? theme.selection : undefined;
  const borderColor = focused ? theme.accent : theme.border;

  const renderLines = (linesToRender: string[]) => (
    <box flexDirection="column" paddingLeft={1} backgroundColor={focusBg}>
      {linesToRender.map((line, index) => {
        const isLastLine = index === linesToRender.length - 1;
        const showSpinner = isLastLine && buildPhase;

        if (showSpinner) {
          return (
            <box key={index} flexDirection="row">
              <Spinner />
              <text color={getLineColor(line, theme)}>
                {" "}{line}
              </text>
            </box>
          );
        }

        return (
          <text key={index} color={getLineColor(line, theme)}>
            {line}
          </text>
        );
      })}
    </box>
  );

  if (title) {
    return (
      <box flexDirection="column" flexGrow={1} backgroundColor={focusBg}>
        <box paddingLeft={1} backgroundColor={focusBg}>
          <text color={borderColor} bold={focused}>
            {"\u2500"} {title} {focused ? "\u25c0" : ""} {"\u2500"}
          </text>
        </box>
        <scrollbox
          borderStyle="single"
          borderColor={borderColor}
          flexGrow={1}
          stickyScroll={true}
          stickyStart="bottom"
          scrollY={true}
          focused={focused}
          backgroundColor={focusBg}
        >
          {renderLines(bufferedLines)}
        </scrollbox>
      </box>
    );
  }

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={follow}
      stickyStart="bottom"
      scrollY={true}
      focused={focused}
      backgroundColor={focusBg}
    >
      {renderLines(bufferedLines)}
    </scrollbox>
  );
}
