import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { execSync } from "child_process";
import type { Profile } from "../core/types.js";
import type { MetroManager } from "../core/metro.js";
import type { FileWatcher } from "../core/watcher.js";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface AppContextValue {
  profile: Profile;
  metroLines: string[];
  toolOutputLines: string[];
  shortcuts: Array<{ key: string; label: string; action: () => void }>;
  runShortcut: (key: string) => void;
}

const AppContextInstance = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContextInstance);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AppProviderProps {
  profile: Profile;
  metro?: MetroManager;
  watcher?: FileWatcher | null;
  worktreeKey?: string;
  startupLog?: string[];
  children: React.ReactNode;
}

export function AppProvider({
  profile,
  metro,
  watcher,
  worktreeKey,
  startupLog,
  children,
}: AppProviderProps): React.JSX.Element {
  const [metroLines, setMetroLines] = useState<string[]>([]);
  const [toolOutputLines, setToolOutputLines] = useState<string[]>(
    startupLog ?? []
  );

  // Subscribe to metro output
  useEffect(() => {
    if (!metro || !worktreeKey) return;

    const handler = ({ line }: { worktreeKey: string; line: string; stream: string }) => {
      setMetroLines((prev) => [...prev, line].slice(-500));
    };

    metro.on("log", handler);
    return () => {
      metro.off("log", handler);
    };
  }, [metro, worktreeKey]);

  // Subscribe to watcher pipeline events
  useEffect(() => {
    if (!watcher) return;

    const onActionComplete = ({
      name,
      result,
    }: {
      name: string;
      result: { success: boolean; output: string; durationMs: number };
    }) => {
      const status = result.success ? "✓" : "✗";
      const header = `${status} ${name} (${result.durationMs}ms)`;
      const outputLines = result.output
        .split("\n")
        .filter((l) => l.length > 0);
      setToolOutputLines((prev) =>
        [...prev, header, ...outputLines, ""].slice(-500)
      );
    };

    watcher.on("action-complete", onActionComplete);
    return () => {
      watcher.off("action-complete", onActionComplete);
    };
  }, [watcher]);

  // Shortcut actions
  const appendToolOutput = useCallback((...lines: string[]) => {
    setToolOutputLines((prev) => [...prev, ...lines].slice(-500));
  }, []);

  const runCommand = useCallback(
    (label: string, cmd: string) => {
      appendToolOutput(`▶ ${label}...`);
      try {
        const output = execSync(cmd, {
          cwd: profile.projectRoot,
          encoding: "utf-8",
          timeout: 60000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const lines = output.split("\n").filter((l) => l.length > 0);
        appendToolOutput(...lines, `✓ ${label} complete`, "");
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        const output = (error.stdout ?? error.stderr ?? error.message ?? "Unknown error")
          .split("\n")
          .filter((l: string) => l.length > 0);
        appendToolOutput(...output, `✗ ${label} failed`, "");
      }
    },
    [profile.projectRoot, appendToolOutput]
  );

  const runShortcut = useCallback(
    (key: string) => {
      switch (key) {
        case "r":
          appendToolOutput("▶ Reloading app...");
          if (metro && worktreeKey) {
            metro.reload(worktreeKey);
            appendToolOutput("✓ Reload signal sent", "");
          } else {
            appendToolOutput("✗ Metro not running", "");
          }
          break;
        case "d":
          appendToolOutput("▶ Opening dev menu...");
          if (metro && worktreeKey) {
            metro.devMenu(worktreeKey);
            appendToolOutput("✓ Dev menu signal sent", "");
          } else {
            appendToolOutput("✗ Metro not running", "");
          }
          break;
        case "l":
          runCommand("Lint", "npx eslint . --max-warnings=0 2>&1 || true");
          break;
        case "t":
          runCommand("Type Check", "npx tsc --noEmit 2>&1 || true");
          break;
        case "c":
          appendToolOutput("▶ Clean requires interactive mode. Use 'rn-dev clean' from CLI.", "");
          break;
        case "w":
          if (watcher) {
            const enabled = watcher.toggle();
            appendToolOutput(`✓ Watcher ${enabled ? "enabled" : "disabled"}`, "");
          } else {
            appendToolOutput("✗ No watcher configured", "");
          }
          break;
        case "q": {
          // Force exit immediately — kill Metro via port since process
          // group kill may fail on detached/unref'd children
          try { watcher?.stop(); } catch {}
          try {
            if (metro) {
              // Use lsof to find and kill the actual Metro process
              const port = profile.metroPort;
              try {
                execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
              } catch {}
              metro.stopAll();
            }
          } catch {}
          // Force exit — don't let anything delay it
          process.exit(0);
          break;
        }
        default:
          break;
      }
    },
    [metro, watcher, worktreeKey, runCommand, appendToolOutput]
  );

  const shortcuts = [
    { key: "r", label: "Reload", action: () => runShortcut("r") },
    { key: "d", label: "Dev Menu", action: () => runShortcut("d") },
    { key: "l", label: "Lint", action: () => runShortcut("l") },
    { key: "t", label: "Type Check", action: () => runShortcut("t") },
    { key: "c", label: "Clean", action: () => runShortcut("c") },
    { key: "w", label: "Toggle Watcher", action: () => runShortcut("w") },
    { key: "q", label: "Quit", action: () => runShortcut("q") },
  ];

  const value: AppContextValue = {
    profile,
    metroLines,
    toolOutputLines,
    shortcuts,
    runShortcut,
  };

  return React.createElement(
    AppContextInstance.Provider,
    { value },
    children
  );
}
