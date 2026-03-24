import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { execSync, spawn } from "child_process";
import type { Profile } from "../core/types.js";
import type { MetroManager } from "../core/metro.js";
import type { FileWatcher } from "../core/watcher.js";
import type { Builder } from "../core/builder.js";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface ModalConfig {
  title: string;
  message: string;
  icon?: string;
  actions: Array<{ label: string; key: string; accent?: boolean; danger?: boolean }>;
  onAction: (key: string) => void;
}

export interface AppContextValue {
  profile: Profile;
  metroLines: string[];
  toolOutputLines: string[];
  shortcuts: Array<{ key: string; label: string; action: () => void }>;
  runShortcut: (key: string) => void;
  wizardContent?: React.ReactNode;
  buildPhase: string | null;
  modal: ModalConfig | null;
  showModal: (config: ModalConfig) => void;
  dismissModal: () => void;
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
  builder?: Builder;
  wizardContent?: React.ReactNode;
  children: React.ReactNode;
}

export function AppProvider({
  profile,
  metro,
  watcher,
  worktreeKey,
  startupLog,
  builder,
  wizardContent,
  children,
}: AppProviderProps): React.JSX.Element {
  const [metroLines, setMetroLines] = useState<string[]>([]);
  const [toolOutputLines, setToolOutputLines] = useState<string[]>(
    startupLog ?? []
  );
  const [buildPhase, setBuildPhase] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const showModal = useCallback((config: ModalConfig) => {
    setModal(config);
  }, []);

  const dismissModal = useCallback(() => {
    setModal(null);
  }, []);

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
      const status = result.success ? "\u2713" : "\u2717";
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

  // Subscribe to builder events for live build output
  useEffect(() => {
    if (!builder) return;

    const onLine = ({ text, replace }: { text: string; replace?: boolean }) => {
      if (replace) {
        // Replace the last line (progress update)
        setToolOutputLines((prev) => {
          const copy = prev.slice(0, -1);
          copy.push(text);
          return copy.slice(-500);
        });
      } else {
        setToolOutputLines((prev) => [...prev, text].slice(-500));
      }
    };
    const onProgress = ({ phase }: { phase: string }) => {
      setBuildPhase(phase);
      setToolOutputLines((prev) => {
        const copy = prev.slice(0, -1);
        copy.push(`  \u23f3 ${phase}...`);
        return copy.slice(-500);
      });
    };
    const onDone = ({ success, errors }: { success: boolean; errors: Array<{ summary: string; reason?: string; suggestion?: string }> }) => {
      setBuildPhase(null);
      if (success) {
        setToolOutputLines((prev) => [...prev, "\u2705 Build complete!", ""].slice(-500));
      } else {
        const lines = ["\u274c Build failed:"];
        for (const err of errors) {
          lines.push(`  ${err.summary}`);
          if (err.reason) lines.push(`    Reason: ${err.reason}`);
          if (err.suggestion) lines.push(`    Fix: ${err.suggestion}`);
        }
        lines.push("");
        setToolOutputLines((prev) => [...prev, ...lines].slice(-500));
      }
    };

    builder.on("line", onLine);
    builder.on("progress", onProgress);
    builder.on("done", onDone);
    return () => {
      builder.off("line", onLine);
      builder.off("progress", onProgress);
      builder.off("done", onDone);
    };
  }, [builder]);

  // Shortcut actions
  const appendToolOutput = useCallback((...lines: string[]) => {
    setToolOutputLines((prev) => [...prev, ...lines].slice(-500));
  }, []);

  const runCommand = useCallback(
    (label: string, cmd: string) => {
      appendToolOutput(`\u25b6 ${label}...`);
      try {
        const output = execSync(cmd, {
          cwd: profile.projectRoot,
          encoding: "utf-8",
          timeout: 60000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const lines = output.split("\n").filter((l: string) => l.length > 0);
        appendToolOutput(...lines, `\u2713 ${label} complete`, "");
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        const output = (error.stdout ?? error.stderr ?? error.message ?? "Unknown error")
          .split("\n")
          .filter((l: string) => l.length > 0);
        appendToolOutput(...output, `\u2717 ${label} failed`, "");
      }
    },
    [profile.projectRoot, appendToolOutput]
  );

  const runShortcut = useCallback(
    (key: string) => {
      switch (key) {
        case "r":
          appendToolOutput("\u25b6 Reloading app...");
          if (metro && worktreeKey) {
            metro.reload(worktreeKey);
            appendToolOutput("\u2713 Reload signal sent", "");
          } else {
            appendToolOutput("\u2717 Metro not running", "");
          }
          break;
        case "d":
          appendToolOutput("\u25b6 Opening dev menu...");
          if (metro && worktreeKey) {
            metro.devMenu(worktreeKey);
            appendToolOutput("\u2713 Dev menu signal sent", "");
          } else {
            appendToolOutput("\u2717 Metro not running", "");
          }
          break;
        case "l":
          runCommand("Lint", "npx eslint . --max-warnings=0 2>&1 || true");
          break;
        case "t":
          runCommand("Type Check", "npx tsc --noEmit 2>&1 || true");
          break;
        case "c":
          appendToolOutput("\u25b6 Clean requires interactive mode. Use 'rn-dev clean' from CLI.", "");
          break;
        case "w":
          if (watcher) {
            const enabled = watcher.toggle();
            appendToolOutput(`\u2713 Watcher ${enabled ? "enabled" : "disabled"}`, "");
          } else {
            appendToolOutput("\u2717 No watcher configured", "");
          }
          break;
        case "q":
          // Kill Metro, disable mouse, restore terminal, exit
          if (metro) metro.stopAll();
          if (watcher) watcher.stop();
          // Disable mouse reporting and restore terminal
          process.stdout.write("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l");
          process.stdout.write("\x1b[?25h");   // show cursor
          process.stdout.write("\x1b[?1049l"); // exit alternate screen
          process.stdout.write("\x1b[0m");     // reset colors
          process.exit(0);
          break;
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
    wizardContent,
    buildPhase,
    modal,
    showModal,
    dismissModal,
  };

  return React.createElement(
    AppContextInstance.Provider,
    { value },
    children
  );
}
