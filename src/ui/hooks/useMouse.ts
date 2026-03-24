import { useEffect, useCallback, useRef } from "react";

export interface MouseEvent {
  x: number;
  y: number;
  button: "left" | "right" | "middle" | "scrollUp" | "scrollDown";
  type: "press" | "release";
}

/**
 * Enable terminal mouse reporting and parse click events.
 * Uses SGR extended mode (\x1b[?1006h) for reliable coordinates.
 *
 * IMPORTANT: This is experimental — some terminals don't support it.
 * Falls back gracefully (no events emitted if unsupported).
 */
export function useMouse(onMouseEvent: (event: MouseEvent) => void): void {
  const callbackRef = useRef(onMouseEvent);
  callbackRef.current = onMouseEvent;

  useEffect(() => {
    const stdin = process.stdin;

    // Enable mouse tracking (SGR extended mode for coordinates > 223)
    process.stdout.write("\x1b[?1000h"); // Enable normal tracking
    process.stdout.write("\x1b[?1006h"); // Enable SGR extended mode

    // SGR mouse format: \x1b[<button;x;y;M (press) or \x1b[<button;x;y;m (release)
    const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

    const onData = (data: Buffer) => {
      const str = data.toString();
      let match;
      while ((match = sgrRegex.exec(str)) !== null) {
        const buttonCode = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const isPress = match[4] === "M";

        let button: MouseEvent["button"];
        const baseButton = buttonCode & 3;
        if (buttonCode & 64) {
          // Scroll events
          button = baseButton === 0 ? "scrollUp" : "scrollDown";
        } else if (baseButton === 0) {
          button = "left";
        } else if (baseButton === 1) {
          button = "middle";
        } else {
          button = "right";
        }

        callbackRef.current({
          x,
          y,
          button,
          type: isPress ? "press" : "release",
        });
      }
    };

    stdin.on("data", onData);

    return () => {
      stdin.off("data", onData);
      // Disable mouse tracking
      process.stdout.write("\x1b[?1006l");
      process.stdout.write("\x1b[?1000l");
    };
  }, []);
}
