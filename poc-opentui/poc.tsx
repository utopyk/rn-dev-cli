import React, { useState, useCallback } from "react";
import { createCliRenderer, VignetteEffect, applyScanlines } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";

// ─── Theme ───────────────────────────────────────────────
const theme = {
  bg: "#1a1b26",
  fg: "#c0caf5",
  border: "#565f89",
  accent: "#7aa2f7",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  muted: "#565f89",
  highlight: "#bb9af7",
  selection: "#283457",
  panelFocusBg: "#1e2030",
};

// ─── Generate fake logs ──────────────────────────────────
function generateBuildLog(): string[] {
  const lines: string[] = [
    "✔ Watchman watch cleared for project",
    "⏳ Starting Metro on port 8081...",
    "✔ Simulator iPhone 16 Pro already booted",
    "✔ All services started",
    "",
    "⏳ Building for ios...",
    "  npx react-native run-ios --port 8081 --verbose",
    "  info Found Xcode workspace \"MovieNightsClub.xcworkspace\"",
  ];
  for (let i = 1; i <= 60; i++) {
    if (i % 15 === 0) lines.push(`  ⚠ ld: warning: object file libPods-${i}.a built for newer version`);
    else if (i % 20 === 0) lines.push(`  ✖ error: Module 'React_${i}' not found`);
    else lines.push(`  [${i}/111] CompileC Module${i}.swift`);
  }
  lines.push("  ✔ Build Succeeded", "  ✔ Launching app", "✅ Build complete!");
  return lines;
}

function generateMetroLog(): string[] {
  const lines = [
    "Welcome to React Native v0.84",
    "Starting dev server on http://localhost:8081",
    "", "  Welcome to Metro v0.83.5", "  Fast – Scalable – Integrated", "",
    "INFO  Dev server ready. Press Ctrl+C to exit.", "",
  ];
  for (let i = 1; i <= 40; i++) {
    lines.push(i % 10 === 0
      ? `WARN  Require cycle: A.tsx -> B.tsx -> A.tsx`
      : `LOG   Running "MovieNightsClub" with {"rootTag":${i + 10}}`);
  }
  return lines;
}

// ─── Color line based on content ─────────────────────────
function lineColor(line: string): string {
  if (line.startsWith("✔") || line.startsWith("✅") || line.includes("Succeeded")) return theme.success;
  if (line.startsWith("⏳") || line.startsWith("▶")) return theme.warning;
  if (line.startsWith("  ✖") || line.includes("error")) return theme.error;
  if (line.startsWith("  ⚠") || line.startsWith("WARN")) return theme.warning;
  if (line.startsWith("  [")) return theme.muted;
  if (line.startsWith("INFO")) return theme.accent;
  return theme.fg;
}

// ─── Tab Bar ─────────────────────────────────────────────
function TabBar({ tabs, activeIndex, onSelect }: {
  tabs: Array<{ icon: string; label: string }>;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <box flexDirection="row" gap={1} height={3} paddingLeft={1} backgroundColor={theme.bg}>
      {tabs.map((tab, i) => (
        <box
          key={tab.label}
          borderStyle="single"
          borderColor={i === activeIndex ? theme.accent : theme.border}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={i === activeIndex ? theme.selection : theme.bg}
          onMouseDown={() => onSelect(i)}
        >
          <text color={i === activeIndex ? theme.accent : theme.fg} bold={i === activeIndex}>
            {tab.icon} {tab.label}
          </text>
        </box>
      ))}
    </box>
  );
}

// ─── Profile Banner ──────────────────────────────────────
function ProfileBanner({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  if (collapsed) {
    return (
      <box borderStyle="single" borderColor={theme.border} paddingLeft={1} height={3} backgroundColor={theme.bg} onMouseDown={onToggle}>
        <text color={theme.muted}>▶ </text>
        <text color={theme.accent} bold>my-profile</text>
        <text color={theme.muted}> (click or [p] to expand)</text>
      </box>
    );
  }
  return (
    <box flexDirection="row" borderStyle="single" borderColor={theme.border} paddingLeft={1} paddingRight={1} height={3} justifyContent="space-between" backgroundColor={theme.bg} onMouseDown={onToggle}>
      <box flexDirection="row" backgroundColor={theme.bg}>
        <text color={theme.muted}>▼ </text>
        <text color={theme.accent} bold>⚙ my-profile</text>
        <text color={theme.muted}> │ </text>
        <text color={theme.success}>main</text>
        <text color={theme.muted}> │ </text>
        <text color={theme.fg}>ios</text>
        <text color={theme.muted}> │ </text>
        <text color={theme.warning}>dirty</text>
        <text color={theme.muted}> │ </text>
        <text color={theme.fg}>:8081</text>
        <text color={theme.muted}> │ </text>
        <text color={theme.fg}>debug</text>
      </box>
      <text color={theme.muted}>[p] toggle</text>
    </box>
  );
}

// ─── Scrollable Log Panel ────────────────────────────────
function LogPanel({ title, lines, focused, onFocus }: {
  title: string;
  lines: string[];
  focused: boolean;
  onFocus: () => void;
}) {
  const borderColor = focused ? theme.accent : theme.border;
  const bg = focused ? theme.panelFocusBg : theme.bg;

  return (
    <box flexDirection="column" flexGrow={1} onMouseDown={onFocus} backgroundColor={bg}>
      <box paddingLeft={1} backgroundColor={bg}>
        <text color={borderColor} bold={focused}>─ {title} {focused ? "◀" : ""} ─</text>
      </box>
      <scrollbox
        borderStyle="single"
        borderColor={borderColor}
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        scrollY={true}
        focused={focused}
        backgroundColor={bg}
      >
        <box flexDirection="column" paddingLeft={1} backgroundColor={bg}>
          {lines.map((line, i) => (
            <text key={i} color={lineColor(line)}>{line}</text>
          ))}
        </box>
      </scrollbox>
    </box>
  );
}

// ─── Shortcuts Panel ─────────────────────────────────────
function ShortcutsPanel({ feedbackLine }: { feedbackLine: string }) {
  return (
    <box flexDirection="column" width="28%" borderStyle="single" borderColor={theme.border} paddingLeft={1} paddingTop={1} backgroundColor={theme.bg}>
      <text color={theme.error} bold>╦═╗╔╗╗  ╦═╗╔═╗╦  ╦</text>
      <text color={theme.highlight} bold>╠╦╝║║║  ║ ║╠═  ║║</text>
      <text color={theme.accent} bold>╩╚═╝╚╝  ╩═╝╚═╝ ╚╝</text>
      <text> </text>
      <text><span color={theme.accent} bold>[r]</span><span color={theme.fg}> Reload</span></text>
      <text><span color={theme.accent} bold>[d]</span><span color={theme.fg}> Dev Menu</span></text>
      <text><span color={theme.accent} bold>[l]</span><span color={theme.fg}> Lint</span></text>
      <text><span color={theme.accent} bold>[t]</span><span color={theme.fg}> Type Check</span></text>
      <text><span color={theme.accent} bold>[c]</span><span color={theme.fg}> Clean</span></text>
      <text><span color={theme.accent} bold>[w]</span><span color={theme.fg}> Toggle Watcher</span></text>
      <text><span color={theme.accent} bold>[q]</span><span color={theme.fg}> Quit</span></text>
      <text> </text>
      <text color={theme.muted}>[f] focus [↑↓] scroll</text>
      <text color={theme.muted}>[Tab] switch tab [p] profile</text>
      {feedbackLine ? (<><text> </text><text color={theme.success} bold>→ {feedbackLine}</text></>) : null}
    </box>
  );
}

// ─── Tab Views ───────────────────────────────────────────
function LintTestView() {
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg} paddingLeft={2} paddingTop={1}>
      <text color={theme.accent} bold>🧪 Lint & Test</text>
      <text> </text>
      <text color={theme.fg}>Press [l] to run lint, [t] for type check</text>
      <text> </text>
      <text color={theme.muted}>No results yet. Run a command to see output here.</text>
    </box>
  );
}

function MetroLogsView({ lines }: { lines: string[] }) {
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg}>
      <scrollbox borderStyle="single" borderColor={theme.accent} flexGrow={1} stickyScroll={true} stickyStart="bottom" scrollY={true} focused={true} backgroundColor={theme.bg}>
        <box flexDirection="column" paddingLeft={1} backgroundColor={theme.bg}>
          {lines.map((line, i) => (
            <text key={i} color={lineColor(line)}>{line}</text>
          ))}
        </box>
      </scrollbox>
    </box>
  );
}

function SettingsView() {
  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg} paddingLeft={2} paddingTop={1}>
      <text color={theme.accent} bold>⚙ Settings</text>
      <text> </text>
      <text color={theme.fg}>Theme: <span color={theme.accent}>Midnight</span></text>
      <text color={theme.fg}>Metro port range: <span color={theme.accent}>8081-8099</span></text>
      <text color={theme.fg}>Verbose build: <span color={theme.success}>ON</span></text>
      <text color={theme.fg}>Auto-clean watchman: <span color={theme.success}>ON</span></text>
      <text> </text>
      <text color={theme.muted}>Theme selection and settings editing coming soon.</text>
    </box>
  );
}

// ─── Dev Space (main view) ───────────────────────────────
function DevSpaceView({ toolLines, metroLines, focusedPanel, setFocusedPanel, feedbackLine }: {
  toolLines: string[];
  metroLines: string[];
  focusedPanel: "tool" | "metro";
  setFocusedPanel: (p: "tool" | "metro") => void;
  feedbackLine: string;
}) {
  return (
    <box flexDirection="row" flexGrow={1} backgroundColor={theme.bg}>
      <ShortcutsPanel feedbackLine={feedbackLine} />
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg}>
        <LogPanel title="Tool Output" lines={toolLines} focused={focusedPanel === "tool"} onFocus={() => setFocusedPanel("tool")} />
        <LogPanel title="Metro Output" lines={metroLines} focused={focusedPanel === "metro"} onFocus={() => setFocusedPanel("metro")} />
      </box>
    </box>
  );
}

// ─── Status Bar ──────────────────────────────────────────
function StatusBar({ activeTab, watcherOn }: { activeTab: string; watcherOn: boolean }) {
  return (
    <box height={1} paddingLeft={1} backgroundColor={theme.selection}>
      <text color={theme.fg}>Metro: <span color={theme.success} bold>● Running</span> :8081 <span color={theme.muted}>│</span> Watcher: <span color={watcherOn ? theme.success : theme.error} bold>{watcherOn ? "ON" : "OFF"}</span> <span color={theme.muted}>│</span> Module: <span color={theme.accent}>{activeTab}</span></text>
    </box>
  );
}

function ShortcutBar() {
  return (
    <box height={1} paddingLeft={1} flexDirection="row" gap={1} backgroundColor={theme.bg}>
      {[["r","Reload"],["d","DevMenu"],["l","Lint"],["t","TypeChk"],["c","Clean"],["w","Watcher"],["f","Focus"],["q","Quit"]].map(([k, l]) => (
        <text key={k}><span color={theme.accent} bold>[{k}]</span><span color={theme.fg}> {l}</span></text>
      ))}
    </box>
  );
}

// ─── Main App ────────────────────────────────────────────
function App() {
  const tabs = [
    { icon: "🚀", label: "Dev Space" },
    { icon: "🧪", label: "Lint & Test" },
    { icon: "📡", label: "Metro Logs" },
    { icon: "⚙", label: "Settings" },
  ];

  const [activeTab, setActiveTab] = useState(0);
  const [focusedPanel, setFocusedPanel] = useState<"tool" | "metro">("tool");
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [watcherOn, setWatcherOn] = useState(true);
  const [feedbackLine, setFeedbackLine] = useState("");
  const [toolLines, setToolLines] = useState<string[]>(generateBuildLog);
  const [metroLines] = useState<string[]>(generateMetroLog);

  const showFeedback = useCallback((msg: string) => {
    setFeedbackLine(msg);
    setTimeout(() => setFeedbackLine(""), 2000);
  }, []);

  const addToolLine = useCallback((line: string) => {
    setToolLines(prev => [...prev, line]);
  }, []);

  useKeyboard(useCallback((event) => {
    const key = event.name;
    switch (key) {
      case "f": setFocusedPanel(prev => { const n = prev === "tool" ? "metro" : "tool"; showFeedback(`Focused: ${n}`); return n; }); break;
      case "q": process.exit(0); break;
      case "tab": setActiveTab(prev => (prev + 1) % tabs.length); break;
      case "p": setBannerCollapsed(prev => !prev); break;
      case "r": showFeedback("Reloading..."); addToolLine("▶ Reloading..."); setTimeout(() => addToolLine("✔ App reloaded"), 500); break;
      case "d": showFeedback("Dev menu opened"); addToolLine("▶ Opening dev menu..."); break;
      case "l": showFeedback("Running lint..."); addToolLine("▶ ESLint..."); setTimeout(() => { addToolLine("  0 errors, 2 warnings"); addToolLine("✔ Lint complete"); }, 800); break;
      case "t": showFeedback("Type checking..."); addToolLine("▶ tsc --noEmit..."); setTimeout(() => addToolLine("✔ Type check passed"), 600); break;
      case "c": showFeedback("Clean options shown"); addToolLine("▶ Choose: dirty / clean / ultra-clean"); break;
      case "w": setWatcherOn(prev => { const n = !prev; showFeedback(`Watcher ${n ? "ON" : "OFF"}`); addToolLine(`✔ Watcher ${n ? "enabled" : "disabled"}`); return n; }); break;
    }
  }, [tabs.length, showFeedback, addToolLine]));

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bg}>
      <TabBar tabs={tabs} activeIndex={activeTab} onSelect={setActiveTab} />
      <ProfileBanner collapsed={bannerCollapsed} onToggle={() => setBannerCollapsed(p => !p)} />

      {/* Tab content — switches based on active tab */}
      {activeTab === 0 && (
        <DevSpaceView toolLines={toolLines} metroLines={metroLines} focusedPanel={focusedPanel} setFocusedPanel={setFocusedPanel} feedbackLine={feedbackLine} />
      )}
      {activeTab === 1 && <LintTestView />}
      {activeTab === 2 && <MetroLogsView lines={metroLines} />}
      {activeTab === 3 && <SettingsView />}

      <ShortcutBar />
      <StatusBar activeTab={tabs[activeTab]?.label ?? ""} watcherOn={watcherOn} />
    </box>
  );
}

// ─── Bootstrap with effects ──────────────────────────────
const vignetteEffect = new VignetteEffect(0.3);

const renderer = await createCliRenderer({
  backgroundColor: theme.bg,
  useMouse: true,
  exitOnCtrlC: true,
  targetFps: 60,
  postProcessFns: [
    (buffer) => vignetteEffect.apply(buffer),
    (buffer) => applyScanlines(buffer, 0.93, 2),
  ],
});

createRoot(renderer).render(<App />);
