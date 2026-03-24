import { useEffect, useCallback, useRef } from "react";

export interface MouseEvent {
  x: number;
  y: number;
  button: "left" | "right" | "middle" | "scrollUp" | "scrollDown";
  type: "press" | "release";
}

// Global reference count — only enable/disable mouse reporting once
let mouseRefCount = 0;

/**
 * Enable terminal mouse reporting and parse click events.
 * Uses SGR extended mode for reliable coordinates.
 * Multiple hooks can be active — mouse reporting is reference-counted.
 */
export function useMouse(onMouseEvent: (event: MouseEvent) => void): void {
  const callbackRef = useRef(onMouseEvent);
  callbackRef.current = onMouseEvent;

  useEffect(() => {
    const stdin = process.stdin;

    // Enable mouse tracking on first subscriber
    if (mouseRefCount === 0) {
      process.stdout.write("\x1b[?1000h");
      process.stdout.write("\x1b[?1006h");
    }
    mouseRefCount++;

    const onData = (data: Buffer) => {
      const str = data.toString();
      // SGR mouse format: \x1b[<button;x;y;M (press) or \x1b[<button;x;y;m (release)
      const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let match;
      while ((match = sgrRegex.exec(str)) !== null) {
        const buttonCode = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const isPress = match[4] === "M";

        let button: MouseEvent["button"];
        const baseButton = buttonCode & 3;
        if (buttonCode & 64) {
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
      mouseRefCount--;
      // Disable mouse tracking when last subscriber unsubscribes
      if (mouseRefCount === 0) {
        process.stdout.write("\x1b[?1006l");
        process.stdout.write("\x1b[?1000l");
      }
    };
  }, []);
}
