import { useEffect, useCallback, useRef, useState } from "react";

export interface MouseEvent {
  x: number;
  y: number;
  button: "left" | "right" | "middle" | "scrollUp" | "scrollDown";
  type: "press" | "release";
}

// Global state for mouse reporting
let mouseRefCount = 0;
let mouseEnabled = true;

function enableMouseReporting(): void {
  process.stdout.write("\x1b[?1000h");
  process.stdout.write("\x1b[?1006h");
}

function disableMouseReporting(): void {
  process.stdout.write("\x1b[?1006l");
  process.stdout.write("\x1b[?1000l");
}

/**
 * Enable terminal mouse reporting and parse click events.
 * Uses SGR extended mode for reliable coordinates.
 *
 * Text selection: Hold Shift while clicking/dragging to use
 * native terminal selection (works in iTerm2, Terminal.app, etc.)
 *
 * Press 'm' to toggle mouse capture on/off for text selection.
 */
export function useMouse(onMouseEvent: (event: MouseEvent) => void): { mouseActive: boolean; toggleMouse: () => void } {
  const callbackRef = useRef(onMouseEvent);
  callbackRef.current = onMouseEvent;
  const [mouseActive, setMouseActive] = useState(mouseEnabled);

  const toggleMouse = useCallback(() => {
    mouseEnabled = !mouseEnabled;
    if (mouseEnabled) {
      enableMouseReporting();
    } else {
      disableMouseReporting();
    }
    setMouseActive(mouseEnabled);
  }, []);

  useEffect(() => {
    const stdin = process.stdin;

    // Enable mouse tracking on first subscriber
    if (mouseRefCount === 0 && mouseEnabled) {
      enableMouseReporting();
    }
    mouseRefCount++;

    const onData = (data: Buffer) => {
      if (!mouseEnabled) return;

      const str = data.toString();
      // SGR mouse format: \x1b[<button;x;yM (press) or \x1b[<button;x;ym (release)
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
        disableMouseReporting();
      }
    };
  }, []);

  return { mouseActive, toggleMouse };
}
