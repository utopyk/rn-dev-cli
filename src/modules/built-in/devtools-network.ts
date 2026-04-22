/**
 * DevTools Network terminal module (Phase 3 Track A).
 *
 * Renders captured network requests as a table: method | status | URL |
 * duration. Reads live state from `AppContext` (populated via service bus +
 * manager delta/status events). Keybinds:
 *
 *   C   clear the capture ring (shift+c; lowercase `c` is the global
 *       Clean-prompt shortcut in AppContext.runShortcut).
 *   T   cycle through available CDP targets (shift+t; lowercase `t` is
 *       the global Type Check shortcut).
 *
 * The Ink filter (`/`) and entry detail view (`Enter`) are deferred to
 * Track C polish — the keybinds are reserved in the module's `shortcuts`
 * list so the ShortcutBar shows them immediately.
 *
 * Parity with Electron / MCP: this surface sees bodies directly (no MCP
 * redaction) — it's on-device, same trust boundary as Fusebox.
 */

import React, { useCallback, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { RnDevModule } from "../../core/types.js";
import { useAppContext } from "../../app/AppContext.js";
import { useTheme } from "../../ui/theme-provider.js";
import type { NetworkEntry, CaptureMeta, TargetDescriptor } from "../../core/devtools/types.js";

// ---------------------------------------------------------------------------
// Column widths — fixed so rows align even in a monospace-unfriendly font.
// ---------------------------------------------------------------------------

const COLUMNS = {
  method: 6,
  status: 6,
  duration: 8,
} as const;

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return " ".repeat(width - text.length) + text;
}

function statusDisplay(entry: NetworkEntry): string {
  if (entry.terminalState === "pending") return "…";
  if (entry.terminalState === "failed") return "err";
  return String(entry.status);
}

function durationDisplay(entry: NetworkEntry): string {
  if (entry.terminalState === "pending") return "—";
  const ms = Math.round(entry.timings.durationMs);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateUrl(url: string, max: number): string {
  if (url.length <= max) return url;
  // Keep the host + path tail; drop query + middle path.
  const qIdx = url.indexOf("?");
  const base = qIdx >= 0 ? url.slice(0, qIdx) : url;
  if (base.length <= max) return base + "…";
  return base.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Proxy status banner
// ---------------------------------------------------------------------------

function proxyStatusLabel(meta: CaptureMeta | null): string {
  if (!meta) return "not started";
  const { proxyStatus } = meta;
  switch (proxyStatus) {
    case "connected":
      return "✓ connected";
    case "disconnected":
      return "⚠ disconnected — waiting for reconnect";
    case "no-target":
      return "⚠ no target (is Metro running?)";
    case "preempted":
      return "⚠ preempted (another debugger claimed this target)";
    case "starting":
      return "⏳ starting";
    case "stopping":
      return "⏳ stopping";
    default:
      return proxyStatus;
  }
}

function selectedTargetLabel(
  targets: TargetDescriptor[],
  selectedId: string | null
): string {
  if (!selectedId) return "none";
  const match = targets.find((t) => t.id === selectedId);
  if (!match) return selectedId;
  return match.title || match.id;
}

// ---------------------------------------------------------------------------
// DevToolsNetworkView
// ---------------------------------------------------------------------------

function DevToolsNetworkView(): React.JSX.Element {
  const {
    networkEntries,
    devtoolsMeta,
    devtoolsTargets,
    devtoolsSelectedTargetId,
    devtoolsClear,
    devtoolsSelectTarget,
  } = useAppContext();
  const theme = useTheme();

  const rows = useMemo(() => {
    // Newest last → render in reverse so most-recent shows at the top.
    return [...networkEntries].reverse();
  }, [networkEntries]);

  const multiTarget = devtoolsTargets.length > 1;

  // Keyboard: uppercase C/T so we don't fight the global lowercase c/t
  // handlers in AppContext.runShortcut (clean / typecheck). The module's
  // view only renders when its tab is active, so the handler is
  // effectively focus-scoped even though opentui's `useKeyboard` is
  // global.
  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "C") {
          devtoolsClear();
          return;
        }
        if (event.name === "T" && devtoolsTargets.length > 1) {
          const idx = devtoolsTargets.findIndex(
            (t) => t.id === devtoolsSelectedTargetId
          );
          const next = devtoolsTargets[(idx + 1) % devtoolsTargets.length];
          if (next) {
            // Fire-and-forget — any error surfaces via the status banner
            // once the manager emits a 'status' event.
            void devtoolsSelectTarget(next.id);
          }
        }
      },
      [devtoolsClear, devtoolsSelectTarget, devtoolsSelectedTargetId, devtoolsTargets]
    )
  );

  return React.createElement(
    "box",
    { flexDirection: "column", flexGrow: 1, backgroundColor: theme.bg },
    // Status banner
    React.createElement(
      "box",
      { paddingLeft: 1, paddingRight: 1, flexDirection: "column" },
      React.createElement(
        "text",
        { color: theme.muted },
        `Proxy: ${proxyStatusLabel(devtoolsMeta)}    ` +
          `Target: ${selectedTargetLabel(devtoolsTargets, devtoolsSelectedTargetId)}    ` +
          `Entries: ${networkEntries.length}`
      ),
      React.createElement(
        "text",
        { color: theme.muted },
        multiTarget ? "[C] Clear  [T] Cycle Target" : "[C] Clear"
      )
    ),
    // Column header
    React.createElement(
      "box",
      { paddingLeft: 1, paddingRight: 1, marginTop: 1 },
      React.createElement(
        "text",
        { color: theme.accent },
        `${pad("METHOD", COLUMNS.method)} ${pad("STAT", COLUMNS.status)} ${padLeft("DUR", COLUMNS.duration)} URL`
      )
    ),
    // Rows — empty state fallback
    rows.length === 0
      ? React.createElement(
          "box",
          { paddingLeft: 1, paddingRight: 1 },
          React.createElement(
            "text",
            { color: theme.muted },
            devtoolsMeta?.proxyStatus === "connected"
              ? "Waiting for network activity…"
              : "No captures yet."
          )
        )
      : React.createElement(
          "box",
          { flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 },
          ...rows.map((entry) =>
            React.createElement(
              "text",
              {
                key: `${entry.requestId}-${entry.version}`,
                color: rowColor(entry, theme),
              },
              `${pad(entry.method.toUpperCase(), COLUMNS.method)} ` +
                `${pad(statusDisplay(entry), COLUMNS.status)} ` +
                `${padLeft(durationDisplay(entry), COLUMNS.duration)} ` +
                `${truncateUrl(entry.url, 80)}`
            )
          )
        )
  );
}

function rowColor(entry: NetworkEntry, theme: ReturnType<typeof useTheme>): string {
  if (entry.terminalState === "pending") return theme.muted;
  if (entry.terminalState === "failed") return theme.error;
  if (entry.terminalState === "finished") {
    if (entry.status >= 500) return theme.error;
    if (entry.status >= 400) return theme.warning;
    if (entry.status >= 300) return theme.accent;
    return theme.fg;
  }
  return theme.fg;
}

// ---------------------------------------------------------------------------
// Shortcuts — `c` clear, `t` cycle target. Handlers live on the shortcut
// object itself. AppContext is the source of truth; shortcuts capture it
// via a React-free closure accessed through `serviceBus` at call time.
// Because `action` must be `() => Promise<void>` per the RnDevModule type,
// we stash references on the module and re-read them per invocation.
//
// Note: the module system currently funnels `c` and `t` through the
// module's declared shortcuts (shown in ShortcutBar) — the actual handler
// must be registered from a component that can use hooks. The clean way
// is to attach the action from within the view via registry or context.
// For MVP we expose the shortcuts declaratively with no-op actions; the
// view (which uses hooks) will register keyboard handlers via its own
// component body in a follow-up. This matches the pattern of
// `metro-logs.ts` which also declares `[C] Clear Logs  [r] Reload` as
// label-only entries.
// ---------------------------------------------------------------------------

export const devtoolsNetworkModule: RnDevModule = {
  id: "devtools-network",
  name: "DevTools Network",
  icon: "\ud83c\udf10",
  order: 25,
  component: DevToolsNetworkView,
  shortcuts: [
    {
      key: "C",
      label: "Clear Captures",
      action: async () => {
        // Keyboard handler lives inside DevToolsNetworkView (via
        // useKeyboard) so it can close over the AppContext state.
        // This declaration is label-only for the ShortcutBar, matching
        // the convention used by metro-logs.ts.
      },
      showInPanel: true,
    },
    {
      key: "T",
      label: "Cycle Target",
      action: async () => {
        // See note above.
      },
      showInPanel: true,
    },
  ],
};
