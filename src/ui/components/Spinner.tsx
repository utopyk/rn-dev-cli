import React, { useState, useEffect } from "react";
import { Text } from "ink";
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

export function Spinner({
  message,
  type = "dots",
}: SpinnerProps): React.JSX.Element {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);
  const frames = FRAMES[type] ?? FRAMES.dots;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [frames.length]);

  return (
    <Text>
      <Text color={theme.accent}>{frames[frameIndex]}</Text>
      {message && <Text color={theme.fg}> {message}</Text>}
    </Text>
  );
}
