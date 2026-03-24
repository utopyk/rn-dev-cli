// poc.tsx
import { useState, useCallback } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { jsx, jsxs } from "@opentui/react/jsx-runtime";
function generateLines(prefix, count) {
  const lines = [];
  for (let i = 1; i <= count; i++) {
    lines.push(`[${prefix}] Line ${i}: ${prefix === "metro" ? "LOG  Running application..." : `\u2714 Check ${i} passed \u2014 ${Date.now()}`}`);
  }
  return lines;
}
function TabBar({ tabs, activeIndex, onSelect }) {
  return /* @__PURE__ */ jsx("box", { flexDirection: "row", gap: 1, height: 3, paddingLeft: 1, children: tabs.map((tab, i) => /* @__PURE__ */ jsx(
    "box",
    {
      borderStyle: "single",
      borderColor: i === activeIndex ? "#7aa2f7" : "#565f89",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: i === activeIndex ? "#283457" : void 0,
      children: /* @__PURE__ */ jsx("text", { color: i === activeIndex ? "#7aa2f7" : "#c0caf5", bold: i === activeIndex, children: tab })
    },
    tab
  )) });
}
function ProfileBanner() {
  return /* @__PURE__ */ jsxs("box", { borderStyle: "single", borderColor: "#565f89", paddingLeft: 1, paddingRight: 1, height: 3, children: [
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", bold: true, children: "\u2699 my-profile" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#9ece6a", children: "main" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "ios" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "dirty" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: ":8081" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "debug" })
  ] });
}
function LogPanel({ title, lines, focused }) {
  return /* @__PURE__ */ jsxs("box", { flexDirection: "column", flexGrow: 1, children: [
    /* @__PURE__ */ jsx("box", { paddingLeft: 1, children: /* @__PURE__ */ jsxs("text", { color: focused ? "#7aa2f7" : "#565f89", bold: focused, children: [
      "\u2500 ",
      title,
      " ",
      focused ? "\u25C0" : "",
      " \u2500"
    ] }) }),
    /* @__PURE__ */ jsx(
      "scrollbox",
      {
        borderStyle: "single",
        borderColor: focused ? "#7aa2f7" : "#565f89",
        flexGrow: 1,
        stickyScroll: true,
        stickyStart: "bottom",
        scrollY: true,
        focused,
        children: /* @__PURE__ */ jsx("box", { flexDirection: "column", paddingLeft: 1, children: lines.map((line, i) => /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: line }, i)) })
      }
    )
  ] });
}
function ShortcutsPanel() {
  return /* @__PURE__ */ jsxs("box", { flexDirection: "column", width: "30%", borderStyle: "single", borderColor: "#565f89", paddingLeft: 1, children: [
    /* @__PURE__ */ jsx("text", { color: "#565f89", bold: true, children: "\u2500 Shortcuts \u2500" }),
    /* @__PURE__ */ jsx("text", {}),
    /* @__PURE__ */ jsx("text", { color: "#f7768e", bold: true, children: "\u2566\u2550\u2557\u2554\u2557\u2557  \u2566\u2550\u2557\u2554\u2550\u2557\u2566  \u2566" }),
    /* @__PURE__ */ jsx("text", { color: "#bb9af7", bold: true, children: "\u2560\u2566\u255D\u2551\u2551\u2551  \u2551 \u2551\u2560\u2550  \u2551\u2551" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", bold: true, children: "\u2569\u255A\u2550\u255D\u255A\u255D  \u2569\u2550\u255D\u255A\u2550\u255D \u255A\u255D" }),
    /* @__PURE__ */ jsx("text", {}),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[r]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Reload" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[d]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Dev Menu" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[l]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Lint" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[t]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Type Check" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[c]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Clean" }),
    /* @__PURE__ */ jsx("text", { color: "#7aa2f7", children: "[q]" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " Quit" }),
    /* @__PURE__ */ jsx("text", {}),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: "[f] focus  [\u2191\u2193] scroll" })
  ] });
}
function StatusBar() {
  return /* @__PURE__ */ jsxs("box", { height: 1, paddingLeft: 1, children: [
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "Metro: " }),
    /* @__PURE__ */ jsx("text", { color: "#9ece6a", children: "\u25CF Running" }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: " :8081" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "Watcher: " }),
    /* @__PURE__ */ jsx("text", { color: "#9ece6a", children: "ON" }),
    /* @__PURE__ */ jsx("text", { color: "#565f89", children: " \u2502 " }),
    /* @__PURE__ */ jsx("text", { color: "#c0caf5", children: "Module: Dev Space" })
  ] });
}
function App() {
  const tabs = ["\u{1F680} Dev Space", "\u{1F9EA} Lint & Test", "\u{1F4E1} Metro Logs", "\u2699 Settings"];
  const [activeTab, setActiveTab] = useState(0);
  const [focusedPanel, setFocusedPanel] = useState("tool");
  const [toolLines] = useState(() => [
    "\u2714 Watchman watch cleared for project",
    "\u23F3 Starting Metro on port 8081...",
    "\u23F3 Starting file watcher...",
    "\u2714 Simulator iPhone 16 Pro already booted",
    "\u2714 All services started",
    "\u23F3 Building for ios...",
    "  npx react-native run-ios --port 8081",
    "info Found Xcode workspace",
    ...generateLines("build", 50),
    "\u2705 Build complete!"
  ]);
  const [metroLines] = useState(() => [
    "Welcome to React Native v0.84",
    "Starting dev server on http://localhost:8081",
    "",
    "Welcome to Metro v0.83.5",
    "Fast \u2013 Scalable \u2013 Integrated",
    "INFO  Dev server ready. Press Ctrl+C to exit.",
    ...generateLines("metro", 50)
  ]);
  useKeyboard(useCallback((event) => {
    if (event.key === "f") {
      setFocusedPanel((prev) => prev === "tool" ? "metro" : "tool");
    } else if (event.key === "q") {
      process.exit(0);
    } else if (event.key === "Tab") {
      setActiveTab((prev) => (prev + 1) % tabs.length);
    }
  }, [tabs.length]));
  return /* @__PURE__ */ jsxs("box", { flexDirection: "column", flexGrow: 1, backgroundColor: "#1a1b26", children: [
    /* @__PURE__ */ jsx(TabBar, { tabs, activeIndex: activeTab, onSelect: setActiveTab }),
    /* @__PURE__ */ jsx(ProfileBanner, {}),
    /* @__PURE__ */ jsxs("box", { flexDirection: "row", flexGrow: 1, children: [
      /* @__PURE__ */ jsx(ShortcutsPanel, {}),
      /* @__PURE__ */ jsxs("box", { flexDirection: "column", flexGrow: 1, children: [
        /* @__PURE__ */ jsx(
          LogPanel,
          {
            title: "Tool Output",
            lines: toolLines,
            focused: focusedPanel === "tool"
          }
        ),
        /* @__PURE__ */ jsx(
          LogPanel,
          {
            title: "Metro Output",
            lines: metroLines,
            focused: focusedPanel === "metro"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsx(StatusBar, {})
  ] });
}
async function main() {
  const renderer = await createCliRenderer({
    backgroundColor: "#1a1b26",
    useMouse: true,
    exitOnCtrlC: true
  });
  createRoot(renderer).render(/* @__PURE__ */ jsx(App, {}));
}
main().catch(console.error);
