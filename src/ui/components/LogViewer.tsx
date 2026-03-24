import React, { useMemo } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useTheme } from "../theme-provider.js";

export interface LogViewerProps {
  lines: string[];
  maxLines?: number;
  maxVisibleLines?: number;
  follow?: boolean;
  height?: number | string;
  title?: string;
  buildPhase?: string | null;
}

function getLineColor(line: string, theme: { fg: string; error: string; warning: string; success: string; accent: string }): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("error ") || trimmed.startsWith("❌") || trimmed.startsWith("✖") || trimmed.startsWith("✗")) {
    return theme.error;
  }
  if (trimmed.startsWith("warn ") || trimmed.startsWith("⚠")) {
    return theme.warning;
  }
  if (trimmed.startsWith("✔") || trimmed.startsWith("✅") || trimmed.startsWith("success ")) {
    return theme.success;
  }
  if (trimmed.startsWith("⏳") || trimmed.startsWith("▶") || trimmed.startsWith("Building")) {
    return theme.accent;
  }
  return theme.fg;
}

export function LogViewer({
  lines,
  maxLines = 500,
  maxVisibleLines,
  follow = true,
  height,
  title,
  buildPhase,
}: LogViewerProps): React.JSX.Element {
  const theme = useTheme();

  // Trim to buffer limit
  const bufferedLines = useMemo(() => {
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  }, [lines, maxLines]);

  // Auto-scroll: show only the last N lines that fit in the viewport
  const displayLines = useMemo(() => {
    if (!follow) return bufferedLines;

    const limit = maxVisibleLines ?? (typeof height === "number" ? Math.max(1, height - 2) : undefined);
    if (!limit) return bufferedLines;

    if (bufferedLines.length <= limit) return bufferedLines;
    return bufferedLines.slice(bufferedLines.length - limit);
  }, [bufferedLines, follow, maxVisibleLines, height]);

  const renderLines = (linesToRender: string[]) => (
    <>
      {linesToRender.map((line, index) => {
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
