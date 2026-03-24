import React, { useMemo } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useTheme } from "../theme-provider.js";

export interface LogViewerProps {
  lines: string[];
  maxLines?: number;
  follow?: boolean;
  height?: number | string;
  title?: string;
  buildPhase?: string | null;
}

function getLineColor(line: string, theme: { fg: string; error: string; warning: string; success: string; accent: string }): string {
  const lower = line.toLowerCase();
  if (lower.startsWith("error ") || lower.startsWith("❌") || /^\s*✖/.test(line)) {
    return theme.error;
  }
  if (lower.startsWith("warn ") || lower.startsWith("⚠")) {
    return theme.warning;
  }
  if (lower.startsWith("✔") || lower.startsWith("✅") || lower.startsWith("success ")) {
    return theme.success;
  }
  if (lower.startsWith("⏳") || lower.startsWith("▶")) {
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
}: LogViewerProps): React.JSX.Element {
  const theme = useTheme();

  const visibleLines = useMemo(() => {
    if (lines.length <= maxLines) {
      return lines;
    }
    return lines.slice(lines.length - maxLines);
  }, [lines, maxLines]);

  const displayLines = useMemo(() => {
    if (!follow || typeof height !== "number") {
      return visibleLines;
    }
    const availableHeight = Math.max(1, height - (title ? 3 : 2));
    if (visibleLines.length <= availableHeight) {
      return visibleLines;
    }
    return visibleLines.slice(visibleLines.length - availableHeight);
  }, [visibleLines, follow, height, title]);

  const renderLines = (linesToRender: string[]) => (
    <>
      {linesToRender.map((line, index) => {
        // If this is the last line and we're building, show spinner
        const isLastLine = index === linesToRender.length - 1;
        const showSpinner = isLastLine && buildPhase;

        if (showSpinner) {
          return (
            <Box key={index}>
              <Text color={theme.warning}>
                <Spinner type="dots" />
              </Text>
              <Text color={getLineColor(line, theme)} wrap="truncate">
                {" "}{line}
              </Text>
            </Box>
          );
        }

        return (
          <Text key={index} color={getLineColor(line, theme)} wrap="truncate">
            {line}
          </Text>
        );
      })}
    </>
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
          {renderLines(displayLines)}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height as number | undefined}>
      {renderLines(displayLines)}
    </Box>
  );
}
