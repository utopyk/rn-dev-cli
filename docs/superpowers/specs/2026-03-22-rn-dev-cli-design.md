# rn-dev-cli — React Native Developer CLI

**Sub-project 1:** TUI Shell + Profile System + Metro Manager

## Overview

A TypeScript CLI tool (built with Ink) that provides a beautiful terminal UI for React Native development. It manages Metro instances across git worktrees, runs preflight environment checks, supports configurable on-save automation, and exposes all functionality via both CLI flags and an MCP server for AI tool integration.

Installed globally (`npm i -g rn-dev-cli`) as primary distribution. Also supports `npx rn-dev-cli` for teams that prefer local-only tooling — in that case, clean operations that delete `node_modules` use a detached child process strategy (copy CLI to temp dir, re-exec from there, clean, reinstall, restart).

## TUI Layout

### Default View: Sidebar + Stacked Panels

```
┌───┬──────────────────────────────────────────────────────┐
│   │ ▼ Profile: dev-auth                                  │
│   │ ┌──────────────────────────────────────────────────┐ │
│   │ │ Worktree: feature/auth   Branch: feat/auth-flow  │ │
│ ◉ │ │ Mode: dirty              Platform: ios            │ │
│   │ │ Metro: :8081             Device: iPhone 15 Pro    │ │
│ D │ │ On-save: lint, type-check                        │ │
│ e │ └──────────────────────────────────────────────────┘ │
│ v ├────────────────────────┬─────────────────────────────┤
│   │ Shortcuts              │ Interactive / Preflights    │
│ S │ r  Reload App          │ ✓ Node 18.x                │
│ p │ d  Dev Menu            │ ✓ Xcode 15.2               │
│ a │ l  Run Linter          │ ⚠ JAVA_HOME not set        │
│ c │ c  Clean Build         │   → Fix? [Y/n]             │
│ e ├────────────────────────┴─────────────────────────────┤
│   │ Tool Output (lint, type-check, tests)                │
│   │ src/App.tsx:12  warning  no-unused-vars              │
│   │ src/Auth.tsx:45 error    missing-return-type          │
│   ├──────────────────────────────────────────────────────┤
│   │ Metro :8081  (feature/auth)                          │
│   │ LOG  Bundle built in 2.3s                            │
│   │ WARN Deprecated API in AuthScreen.tsx:23             │
├───┴──────────────────────────────────────────────────────┤
│ ✓ Preflight 3/4 │ Metro :8081 │ iPhone 15 │ ios │ dirty │
└──────────────────────────────────────────────────────────┘
```

### Panel Breakdown

1. **Profile Banner** (top, collapsible) — shows active profile config: worktree, branch, mode, platform, metro port, device, on-save actions. Collapsed to a single summary line, expanded by default on start.

2. **Shortcuts Panel** (top-left) — keyboard-driven action list. Each action has a single-key binding. Scrollable if the list grows via plugins.

3. **Interactive Panel** (top-right) — multipurpose area for preflight check results, build progress bars, and wizard questions during interactive mode.

4. **Tool Output Panel** (middle) — scrollable output from lint, type-check, tests, and other tools. Cleared on each new run or scrollable through history.

5. **Metro Log Panel** (bottom) — live metro stdout/stderr stream with ANSI color support. Scrollable with search.

6. **Status Bar** (bottom edge) — compact summary: preflight status, metro port, active device, platform, run mode.

### Sidebar

Left sidebar navigates between modules. Each module gets the full main area when selected. Press Esc or click Dev Space to return.

Built-in modules:
- **Dev Space** (default) — the 4-panel stacked view described above
- **Lint/Test** — full-screen tool output with scrollback and search
- **Metro Logs** — full-screen metro output
- **Settings** — profile manager, theme picker, on-save configuration
- **+ Add Module** — plugin modules appear here

### Keyboard Navigation

- Tab/Shift+Tab cycles focus between panels
- Single-key shortcuts (r, d, l, c, p, w, etc.) work globally when no input is focused
- P opens profile switcher overlay
- Esc returns to Dev Space from any module

## Project Structure

```
rn-dev-cli/
├── src/
│   ├── index.tsx              # Entry point, CLI arg parsing
│   ├── app.tsx                # Root Ink <App> component, router
│   ├── core/
│   │   ├── profile.ts         # Profile load/save/merge logic
│   │   ├── artifact.ts        # Per-worktree artifact tracking (checksums, ports)
│   │   ├── metro.ts           # Metro process manager (spawn, kill, port allocation)
│   │   ├── device.ts          # Device discovery (adb devices, xcrun simctl)
│   │   ├── preflight.ts       # Environment checks + auto-fix
│   │   └── watcher.ts         # File watcher + on-save pipeline runner
│   ├── ui/
│   │   ├── layout/
│   │   │   ├── shell.tsx       # Sidebar + main area frame
│   │   │   ├── dev-space.tsx   # Default 4-panel stacked view
│   │   │   └── panel.tsx       # Reusable scrollable panel wrapper
│   │   ├── panels/
│   │   │   ├── profile-banner.tsx   # Collapsible profile display
│   │   │   ├── shortcuts.tsx        # Keyboard shortcut list
│   │   │   ├── interactive.tsx      # Preflights, build progress, wizard
│   │   │   ├── tool-output.tsx      # Lint/test results viewer
│   │   │   └── metro-log.tsx        # Metro log stream
│   │   ├── wizard/
│   │   │   ├── wizard.tsx           # Step-by-step session setup
│   │   │   ├── worktree-step.tsx
│   │   │   ├── branch-step.tsx
│   │   │   ├── platform-step.tsx
│   │   │   ├── mode-step.tsx
│   │   │   └── device-step.tsx
│   │   └── components/
│   │       ├── search-input.tsx     # Custom fuzzy search/autocomplete
│   │       ├── selectable-list.tsx  # Wrapper around ink-select-input
│   │       └── log-viewer.tsx       # Scrollable ANSI log renderer
│   ├── modules/               # Sidebar module system
│   │   ├── registry.ts        # Module registration + ordering
│   │   ├── base-module.ts     # Module interface/base class
│   │   └── built-in/
│   │       ├── dev-space.ts
│   │       ├── lint-test.ts
│   │       ├── metro-full.ts
│   │       └── settings.ts
│   ├── themes/
│   │   ├── theme-provider.tsx  # React context for theming
│   │   ├── midnight.json       # Tokyo Night inspired
│   │   ├── ember.json          # Gruvbox inspired
│   │   ├── arctic.json         # Nord inspired
│   │   └── neon-drive.json     # Synthwave/Outrun
│   ├── mcp/
│   │   ├── server.ts          # MCP server (stdio transport)
│   │   └── tools.ts           # Tool definitions
│   └── cli/
│       └── commands.ts        # CLI subcommands
├── profiles/                  # User profile storage (gitignored)
├── .artifacts/                # Per-worktree state (checksums, ports)
├── package.json
└── tsconfig.json
```

### Architectural Principles

- **`core/`** is pure logic with no UI — testable independently, shared by TUI, CLI, and MCP
- **`ui/`** is Ink components only — consumes core via hooks/context
- **`modules/`** defines the sidebar extension system — each module registers a name, icon, and React component
- **`mcp/`** and **`cli/`** are thin wrappers that call into `core/`

## Profile System

### Profile Schema

```typescript
interface Profile {
  name: string;
  worktree: string | null;       // null = default/root repo
  branch: string;
  platform: "ios" | "android" | "both";
  mode: "dirty" | "clean" | "ultra-clean";
  metroPort: number;             // assigned or user-chosen
  device: string | null;         // device ID, null = auto-detect
  buildVariant: "debug" | "release";
  onSave: OnSaveAction[];        // ordered pipeline
  env: Record<string, string>;   // extra env vars passed to metro/builds
}

interface OnSaveAction {
  name: string;                  // "lint", "type-check", "custom:my-script"
  enabled: boolean;
  command?: string;              // for custom scripts
  glob?: string;                 // file pattern to trigger on
  showOutput: "tool-panel" | "notification" | "silent";
}
```

### Storage

- Global profiles: `~/.rn-dev/profiles/`
- Project-local profiles: `<project>/.rn-dev/profiles/`
- Resolution order: CLI flags → project-local profile → global profile → interactive wizard

### Profile Behaviors

**Multiple profiles per worktree+branch.** One is marked as `[default]`. `rn-dev start` loads the default.

**Start flow:**

```
rn-dev start
  ├─ profile exists for current worktree+branch?
  │   ├─ yes → load default profile, run preflights, start metro
  │   └─ no  → run wizard → save as new profile → start

rn-dev start --interactive / rn-dev start -i
  ├─ run wizard
  ├─ user picked same worktree+branch as existing profile?
  │   ├─ yes → "Profile 'X' exists. Overwrite? / Save as new?"
  │   └─ no  → save as new profile
  └─ start

rn-dev start --profile <name>
  └─ load named profile directly
```

**Wizard step order:** Worktree → Branch → Platform → Mode → Device

**Copying:** When switching to a new worktree, offer to clone an existing profile and adjust worktree/branch/port.

**Port allocation:** Auto-assign from pool 8081–8099, tracked in `.rn-dev/artifacts/` to avoid collisions.

**Profile management CLI:**

```bash
rn-dev profiles                       # list all profiles
rn-dev profiles default <name>        # set default for current worktree+branch
rn-dev start --profile <name>         # load specific profile
```

**TUI profile switching:** Press `P` to open overlay list of profiles for current worktree+branch. Selecting hot-swaps config (may require metro restart if port changes).

### First-Run Setup

- Detect `.gitignore`, offer to add `.rn-dev/`, `profiles/`, `.artifacts/`
- Detect missing `.nvmrc`/`.node-version` — offer to create from current Node version
- Detect missing `.env` — offer to copy from `.env.example` if it exists

## Preflight Engine

Preflight checks run automatically before starting a session. Results display in the Interactive panel. Each check has a severity and optional auto-fix.

### Check Matrix

| Check | Severity | Platform | Auto-fix |
|---|---|---|---|
| Node version vs `.nvmrc`/`.node-version`/`engines` | Error | All | Offer `nvm use`, create config if missing |
| Ruby version vs `Gemfile` | Error | iOS | Offer `rbenv install` / `rvm use` |
| `JAVA_HOME` set + correct version | Error | Android | Set from `/usr/libexec/java_home` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` set | Error | Android | Set from common paths |
| Android SDK licenses accepted | Error | Android | Run `sdkmanager --licenses` |
| Xcode CLI tools installed | Error | iOS | Run `xcode-select --install` |
| Xcode version compatible with RN version | Warning | iOS | Inform only |
| CocoaPods installed + version compatible | Error | iOS | `gem install cocoapods` |
| `Podfile.lock` matches installed pods | Warning | iOS | Offer `pod install` |
| Watchman installed and responsive | Warning | All | `brew install watchman` |
| Metro port available (no ghost process) | Error | All | Kill stale process |
| `node_modules` exists + matches lockfile checksum | Warning | All | Offer install |
| Pods directory matches `Podfile.lock` checksum | Warning | iOS | Offer `pod install` |
| Device/simulator available and booted | Warning | All | Offer to boot |
| ADB device authorized | Warning | Android | Inform user to approve on device |
| `.env` file exists (if project uses `react-native-config`) | Warning | All | Copy `.env.example` |
| Patch-package patches applied | Warning | All | Run `npx patch-package` |
| Hermes/JSC engine matches branch config | Warning | All | Suggest clean build |
| Bundle ID / Application ID consistent | Warning | All | Inform of mismatch |
| Flipper compatibility with Xcode version | Warning | iOS | Inform only |
| Gradle daemon healthy | Warning | Android | Offer `./gradlew --stop` |

### Dependency Change Detection

Uses diff-based detection: compare `package.json`/`yarn.lock`/`Podfile.lock` checksums between current state and stored artifact per worktree. If checksums differ after a branch/worktree switch, flag reinstall needed. Only triggers reinstall prompts for the relevant platform (e.g., pod changes only flagged if user chose iOS).

## Metro Manager

### Metro Instance Schema

```typescript
interface MetroInstance {
  worktree: string;          // worktree path or "default" for root
  port: number;              // from pool 8081-8099
  pid: number;
  status: "starting" | "running" | "error" | "stopped";
  startedAt: Date;
  projectRoot: string;       // absolute path to RN project
}
```

### Port Allocation

- Pool: 8081–8099 (configurable)
- Each worktree gets a port persisted in `.rn-dev/artifacts/<worktree-hash>.json`
- On start: check if persisted port is free. If occupied by stale process → kill. If occupied by another worktree's active Metro → assign new port.
- Port persistence matters: devices built against a port expect that port. Changing ports forces a rebuild even in dirty mode.

### Dirty Mode + Port Artifact Logic

If the artifact shows a different port was used for the last build, dirty mode warns: "Last build used port 8082, Metro is now on 8083 — rebuild required" and auto-escalates to a rebuild step.

### Process Lifecycle

- Metro spawned as detached child with `--port`, `--reset-cache` (if clean/ultra-clean), `--verbose`
- stdout/stderr piped to TUI metro log panel AND written to `.rn-dev/logs/metro-<worktree>.log`
- Crash detection: panel shows error + one-key restart
- On CLI exit: offer to keep Metro running in background or kill it

### Multi-Worktree Isolation

- Each Metro instance gets its own `projectRoot` pointing to its worktree directory
- `REACT_NATIVE_PACKAGER_HOSTNAME` set per-instance
- Device picker filters out devices already in use by other worktree instances
- Switching worktrees doesn't kill previous Metro — both coexist

## Run Modes

### Dirty Mode

Start Metro directly. Skip dependency installation. If port artifact mismatch detected, warn and offer rebuild.

### Clean Mode

1. Reinstall `node_modules` (detect package manager: npm/yarn/pnpm)
2. (iOS) Run `pod install`
3. Start Metro with `--reset-cache`

### Ultra-Clean Mode

1. Kill Metro + Watchman (`watchman watch-del-all`)
2. Remove `node_modules/`
3. Remove `$TMPDIR/metro-*`, `$TMPDIR/haste-map-*`
4. (iOS) `pod deintegrate` + remove `Pods/` + remove DerivedData (project + `~/Library/Developer/Xcode/DerivedData`)
5. (Android) `./gradlew --stop` + clean gradle caches (`~/.gradle/caches/`)
6. (Android) Uninstall app via `adb uninstall <bundleId>`
7. (iOS) Uninstall app via `xcrun simctl uninstall <deviceId> <bundleId>`
8. Reinstall `node_modules`
9. (iOS) `pod install`
10. Start Metro with `--reset-cache`

**Self-preservation:** If running via `npx` (inside `node_modules`), ultra-clean copies the CLI to a temp dir and re-execs from there before deleting `node_modules`. Global installs are unaffected.

## Module / Plugin System

### Module Interface

```typescript
interface RnDevModule {
  id: string;                    // unique identifier
  name: string;                  // sidebar display name
  icon: string;                  // emoji or single char
  order: number;                 // sidebar position (lower = higher)
  component: React.FC;           // Ink component for full-screen view
  shortcuts?: Shortcut[];        // keyboard shortcuts this module registers
  onSave?: OnSaveHandler;        // optional file-watcher hook
  tools?: McpTool[];             // optional MCP tools
  commands?: CliCommand[];       // optional CLI subcommands
}

interface Shortcut {
  key: string;
  label: string;
  action: () => Promise<void>;
  showInPanel: boolean;
}
```

### Registration & Discovery

Built-in modules use order 0–99. Plugins default to 100+. Third-party plugins are npm packages discovered via `package.json`:

```json
{
  "rn-dev": {
    "plugins": [
      "rn-dev-plugin-storybook",
      "rn-dev-plugin-fastlane",
      "./custom-modules/my-module"
    ]
  }
}
```

### Plugin Context

Plugins receive a `context` object with: current profile, metro instance, device list, project paths, artifact state, `runCommand()` helper, MCP tool registry, and CLI command registry.

## MCP Server & CLI Interface

Every action available in the TUI is available via both MCP tools and CLI flags. Both call the same `core/` functions — no behavior divergence.

### MCP Tools

```
// Session management
rn-dev/start-session        rn-dev/stop-session         rn-dev/list-sessions

// Metro control
rn-dev/reload               rn-dev/dev-menu             rn-dev/metro-status
rn-dev/metro-logs

// Build & Clean
rn-dev/clean                rn-dev/build                rn-dev/install-deps

// Device management
rn-dev/list-devices         rn-dev/select-device        rn-dev/boot-device

// Environment
rn-dev/preflight            rn-dev/fix-preflight

// Worktree
rn-dev/list-worktrees       rn-dev/create-worktree      rn-dev/switch-worktree

// Profile
rn-dev/list-profiles        rn-dev/get-profile          rn-dev/save-profile

// Tools
rn-dev/run-lint             rn-dev/run-typecheck
```

### CLI Commands

```bash
rn-dev start                          # load default profile (or wizard if none)
rn-dev start -i / --interactive       # force wizard
rn-dev start --profile <name>         # load named profile

rn-dev reload                         # reload app
rn-dev dev-menu                       # open dev menu
rn-dev clean --mode ultra-clean       # run clean operation

rn-dev devices                        # list devices
rn-dev worktrees                      # list worktrees
rn-dev profiles                       # list profiles
rn-dev profiles default <name>        # set default profile

rn-dev lint                           # run linter
rn-dev typecheck                      # run type-check
rn-dev preflight                      # run checks
rn-dev preflight --fix                # auto-fix all fixable

rn-dev config theme <name>            # switch theme
rn-dev mcp                            # start MCP server (stdio)
```

### Communication

- MCP server uses stdio transport
- `rn-dev mcp` can run standalone (headless) or alongside the TUI
- When TUI is running, CLI commands connect to the running instance via a Unix socket at `.rn-dev/sock` rather than spawning a new process

## Theming

### Built-in Themes (4)

1. **Midnight** — Tokyo Night inspired: deep blue-black, soft blues and purples
2. **Ember** — Gruvbox inspired: warm ambers, greens, muted pinks
3. **Arctic** — Nord inspired: cool blue-grays, frosty teals, soft pastels
4. **Neon Drive** — Synthwave/Outrun: hot pink, electric cyan, neon yellow on deep purple

### Theme Schema

```json
{
  "name": "My Theme",
  "colors": {
    "bg":        "#1a1b26",
    "fg":        "#c0caf5",
    "border":    "#565f89",
    "accent":    "#7aa2f7",
    "success":   "#9ece6a",
    "warning":   "#e0af68",
    "error":     "#f7768e",
    "muted":     "#565f89",
    "highlight": "#bb9af7",
    "selection": "#283457"
  }
}
```

Custom themes are JSON files placed in `~/.rn-dev/themes/`. Switch via `rn-dev config theme <name>` or from the TUI Settings module.

## File Watcher & On-Save Pipeline

### Configuration

```typescript
interface WatcherConfig {
  actions: OnSaveAction[];       // ordered pipeline from profile
  debounceMs: number;            // default 300ms, configurable
  ignorePatterns: string[];      // default: node_modules, .git, build outputs
}
```

### Behavior

- File changes are debounced (300ms default) and batched
- Pipeline runs actions sequentially in defined order
- If lint fails, option to halt pipeline or continue to next action
- `{file}` placeholder in custom commands is replaced with the changed file path
- Output routes to tool output panel by default (configurable per action)
- Pipeline is non-blocking — coding continues while actions run
- New save during pipeline run cancels current run and restarts
- Watcher toggleable on/off with keyboard shortcut (`w`) without changing profile
- `rn-dev start` with on-save profile starts watcher automatically

### Built-in Actions

- `lint` — project's ESLint config
- `type-check` — `tsc --noEmit`
- `test-related` — `jest --findRelatedTests`
- `custom:<name>` — any arbitrary command

## Tech Stack

- **Runtime:** Node.js (TypeScript)
- **TUI Framework:** Ink (React for CLIs)
- **Layout:** Ink's built-in Flexbox (Yoga engine)
- **Key packages:** ink-select-input, ink-multi-select, ink-text-input, @inkjs/ui (Spinner, ProgressBar), ink-scroll-view, fullscreen-ink
- **Custom components:** fuzzy search/autocomplete (ink-text-input + fuse.js), scrollable ANSI log viewer
- **CLI parsing:** to be determined (yargs, commander, or oclif)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **File watching:** chokidar

## Out of Scope (Future Sub-projects)

- **Sub-project 2:** Preflight auto-fix implementation details, build orchestration for `react-native run-ios/android`
- **Sub-project 3:** Plugin marketplace/registry, community theme distribution
