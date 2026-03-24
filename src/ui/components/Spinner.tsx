import React, { useState, useEffect } from "react";
import { useTheme } from "../theme-provider.js";

export interface SpinnerProps {
  message?: string;
  type?: "dots" | "line" | "arc";
}

const FRAMES: Record<string, string[]> = {
  dots: ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"],
  line: ["-", "\\", "|", "/"],
  arc: ["\u25dc", "\u25dd", "\u25de", "\u25df"],
};

const INTERVAL = 80;

/**
 * Returns the current spinner frame as a plain string.
 * Use this when you need the spinner text inline (e.g. inside <span>).
 */
export function useSpinnerFrame(type: "dots" | "line" | "arc" = "dots"): string {
  const [frameIndex, setFrameIndex] = useState(0);
  const frames = FRAMES[type] ?? FRAMES.dots;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [frames.length]);

  return frames[frameIndex] ?? frames[0] ?? "";
}

export function Spinner({
  message,
  type = "dots",
}: SpinnerProps): React.JSX.Element {
  const theme = useTheme();
  const frame = useSpinnerFrame(type);

  if (message) {
    return (
      <text>
        <span color={theme.accent}>{frame}</span>
        <span color={theme.fg}> {message}</span>
      </text>
    );
  }

  return (
    <text color={theme.accent}>{frame}</text>
  );
}
