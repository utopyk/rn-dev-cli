import React, { useMemo, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
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
  scrollable?: boolean;
  focused?: boolean;
  panelWidth?: number;
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
  scrollable = true,
  focused = false,
  panelWidth,
}: LogViewerProps): React.JSX.Element {
  const theme = useTheme();
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isManualScroll, setIsManualScroll] = useState(false);

  const limit = maxVisibleLines ?? (typeof height === "number" ? Math.max(1, height - 2) : undefined);

  // Trim to buffer limit
  const bufferedLines = useMemo(() => {
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  }, [lines, maxLines]);

  // When new lines come in and we're in follow mode, reset manual scroll
  React.useEffect(() => {
    if (follow && !isManualScroll) {
      setScrollOffset(0);
    }
  }, [bufferedLines.length, follow, isManualScroll]);

  // Handle scroll input
  useInput(
    useCallback(
      (_input: string, key: { upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean }) => {
        if (!scrollable || !limit) return;

        const maxOffset = Math.max(0, bufferedLines.length - limit);

        if (key.upArrow) {
          setIsManualScroll(true);
          setScrollOffset((prev) => Math.min(prev + 1, maxOffset));
        } else if (key.downArrow) {
          setScrollOffset((prev) => {
            const next = Math.max(prev - 1, 0);
            if (next === 0) setIsManualScroll(false);
            return next;
          });
        } else if (key.pageUp) {
          setIsManualScroll(true);
          setScrollOffset((prev) => Math.min(prev + (limit - 1), maxOffset));
        } else if (key.pageDown) {
          setScrollOffset((prev) => {
            const next = Math.max(prev - (limit - 1), 0);
            if (next === 0) setIsManualScroll(false);
            return next;
          });
        }
      },
      [scrollable, limit, bufferedLines.length]
    )
  );

  // Calculate visible window
  const displayLines = useMemo(() => {
    if (!limit) return bufferedLines;

    if (isManualScroll && scrollOffset > 0) {
      // Manual scroll: show lines from offset position
      const endIdx = bufferedLines.length - scrollOffset;
      const startIdx = Math.max(0, endIdx - limit);
      return bufferedLines.slice(startIdx, endIdx);
    }

    // Auto-scroll: show last N lines
    if (bufferedLines.length <= limit) return bufferedLines;
    return bufferedLines.slice(bufferedLines.length - limit);
  }, [bufferedLines, limit, scrollOffset, isManualScroll]);

  // Use ANSI escape codes for full-width background tint.
  // \x1b[K (Erase in Line) fills from cursor to end of line with the
  // current background color — this is how tmux does solid backgrounds.
  const focusBg = focused ? theme.selection : undefined;

  function hexToAnsiBg(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `\x1b[48;2;${r};${g};${b}m`;
  }

  // Wrap text with ANSI bg + erase-to-end-of-line for full-width background
  const bgWrap = (text: string): string => {
    if (!focused || !focusBg) return text;
    return `${hexToAnsiBg(focusBg)}${text}\x1b[K\x1b[0m`;
  };

  const renderLines = (linesToRender: string[]) => (
    <>
      {linesToRender.map((line, index) => {
        const isLastLine = index === linesToRender.length - 1;
        const showSpinner = isLastLine && buildPhase && !isManualScroll;

        if (showSpinner) {
          return (
            <Box key={index}>
              <Text color={theme.warning}>
                <Spinner type="dots" />
              </Text>
              <Text color={getLineColor(line, theme)} wrap="truncate">
                {bgWrap(" " + line)}
              </Text>
            </Box>
          );
        }

        return (
          <Text key={index} color={getLineColor(line, theme)} wrap="truncate">
            {bgWrap(line)}
          </Text>
        );
      })}
      {/* Fill remaining empty lines with background */}
      {focused && focusBg && limit && linesToRender.length < limit &&
        Array.from({ length: limit - linesToRender.length }, (_, i) => (
          <Text key={`empty-${i}`}>
            {bgWrap("")}
          </Text>
        ))
      }
      {isManualScroll && scrollOffset > 0 && (
        <Text color={theme.muted} dimColor>
          {bgWrap(`↑↓ scroll │ ${scrollOffset} lines below ▼`)}
        </Text>
      )}
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
