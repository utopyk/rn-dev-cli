import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-provider.js";

export interface LogViewerProps {
  lines: string[];
  maxLines?: number;
  follow?: boolean;
  height?: number | string;
  title?: string;
}

function getLineColor(line: string, theme: { fg: string; error: string; warning: string }): string {
  const lower = line.toLowerCase();
  if (lower.includes("error")) {
    return theme.error;
  }
  if (lower.includes("warn")) {
    return theme.warning;
  }
  return theme.fg;
}

export function LogViewer({
  lines,
  maxLines = 500,
  follow = true,
  height,
  title,
}: LogViewerProps): React.JSX.Element {
  const theme = useTheme();

  const visibleLines = useMemo(() => {
    if (lines.length <= maxLines) {
      return lines;
    }
    return lines.slice(lines.length - maxLines);
  }, [lines, maxLines]);

  // When follow is true, we show the last lines that fit in the viewport.
  // Ink doesn't have native scrolling, so we slice from the end.
  const displayLines = useMemo(() => {
    if (!follow || typeof height !== "number") {
      return visibleLines;
    }
    // Reserve 2 lines for border + title
    const availableHeight = Math.max(1, height - (title ? 3 : 2));
    if (visibleLines.length <= availableHeight) {
      return visibleLines;
    }
    return visibleLines.slice(visibleLines.length - availableHeight);
  }, [visibleLines, follow, height, title]);

  const content = (
    <Box flexDirection="column" height={height as number | undefined}>
      {displayLines.map((line, index) => (
        <Text key={index} color={getLineColor(line, theme)} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );

  if (title) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.border}
        height={height as number | undefined}
      >
        <Box marginTop={-1} marginLeft={1}>
          <Text color={theme.accent} bold>
            {"\u2500"} {title} {"\u2500"}
          </Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {displayLines.map((line, index) => (
            <Text key={index} color={getLineColor(line, theme)} wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  return content;
}
