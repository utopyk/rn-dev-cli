# rn-dev-cli — React Native Developer CLI

**Sub-project 1:** TUI Shell + Profile System + Metro Manager

## Overview

A TypeScript CLI tool (built with Ink) that provides a beautiful terminal UI for React Native development. It manages Metro instances across git worktrees, runs preflight environment checks, supports configurable on-save automation, and exposes all functionality via both CLI flags and an MCP server for AI tool integration.

Installed globally (`npm i -g rn-dev-cli`) as primary distribution. Also supports `npx rn-dev-cli` for teams that prefer local-only tooling — in that case, clean operations that delete `node_modules` use a detached child process strategy (see Self-Preservation below).

The CLI is compiled to a single file via esbuild for distribution. This simplifies global install, enables trivial self-preservation (copy one file to temp), and avoids dependency conflicts with user projects.

### Project Root Detection

The CLI walks up from `cwd` looking for `package.json` containing `react-native` in `dependencies` or `devDependencies`. Supports `--root <path>` override for monorepo cases where the RN app is in a subdirectory. The detected root is stored in the profile.

### Non-Git Repos

If the project is not a git repository, worktree/branch steps are skipped in the wizard. Profiles are keyed by directory name instead. Worktree-related features are disabled with an informational message.

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

Built-in modules (hardcoded in Sub-project 1, no third-party plugin loading):
- **Dev Space** (default, order=0) — the 4-panel stacked view described above
- **Lint/Test** (order=10) — full-screen tool output with scrollback and search
- **Metro Logs** (order=20) — full-screen metro output
- **Settings** (order=90) — profile manager, theme picker, on-save configuration

The `RnDevModule` interface is defined as a forward-looking API, but third-party plugin discovery and loading is deferred to a future sub-project.

### Keyboard Navigation

- Tab/Shift+Tab cycles focus between panels
- Single-key shortcuts (r, d, l, c, w, etc.) work globally when no input is focused
- Shift+P opens profile switcher overlay (Shift+ prefix avoids conflict with lowercase shortcuts)
- Esc returns to Dev Space from any module
- Built-in shortcuts take precedence over plugin shortcuts; conflicts produce a warning and plugins must use an alternative key

## Project Structure

This diagram shows the CLI tool's **source code** structure:

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
│   │   ├── project.ts         # Project root detection + RN version discovery
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
│   │   ├── registry.ts        # Module registration (built-in only in SP1)
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
├── package.json
└── tsconfig.json
```

### Runtime Data Layout

Data created at runtime on the user's machine:

```
~/.rn-dev/                          # Global config
├── config.json                     # Global settings (theme, port pool, etc.)
├── profiles/                       # Global profiles (keyed by project hash)
│   └── <project-hash>/
│       └── <profile-name>.json
├── themes/                         # Custom user themes
│   └── my-theme.json
└── logs/
    └── rn-dev.log                  # CLI diagnostic log

<project>/.rn-dev/                  # Project-local data (gitignored)
├── profiles/                       # Project-local profiles
│   └── <profile-name>.json
├── artifacts/                      # Per-worktree state
│   ├── root.json                   # Root repo artifact
│   └── <worktree-hash>.json        # Worktree-specific artifacts
├── logs/
│   └── metro-<worktree>.log        # Metro log files
└── sock                            # Unix socket for TUI↔CLI IPC
```

### Architectural Principles

- **`core/`** is pure logic with no UI — testable independently, shared by TUI, CLI, and MCP
- **`ui/`** is Ink components only — consumes core via hooks/context
- **`modules/`** defines the sidebar module system — built-in modules only in Sub-project 1
- **`mcp/`** and **`cli/`** are thin wrappers that call into `core/`

## Profile System

### Profile Schema

Profiles are stored as JSON files. Filename convention: `<profile-name>.json`. Project-local profiles live in `<project>/.rn-dev/profiles/`, global profiles in `~/.rn-dev/profiles/<project-hash>/`.

```typescript
interface Profile {
  name: string;
  isDefault: boolean;              // one default per worktree+branch
  worktree: string | null;         // null = default/root repo
  branch: string;
  platform: "ios" | "android" | "both";
  mode: "dirty" | "clean" | "ultra-clean";
  metroPort: number;               // assigned or user-chosen
  devices: DeviceSelection;        // device(s) based on platform
  buildVariant: "debug" | "release";
  onSave: OnSaveAction[];          // ordered pipeline
  env: Record<string, string>;     // extra env vars passed to metro/builds
  projectRoot: string;             // detected or overridden RN project root
}

interface DeviceSelection {
  ios?: string | null;             // device ID, null = auto-detect
  android?: string | null;         // device ID, null = auto-detect
}

interface OnSaveAction {
  name: string;                    // "lint", "type-check", "custom:my-script"
  enabled: boolean;
  haltOnFailure: boolean;          // if true, skip subsequent actions on failure
  command?: string;                // for custom scripts
  glob?: string;                   // file pattern to trigger on
  showOutput: "tool-panel" | "notification" | "silent";
}
```

### Platform "both"

When `platform: "both"`:
- Preflight runs all checks for both iOS and Android
- Clean mode runs both `pod install` and gradle operations
- One Metro instance serves both platforms (Metro's native behavior)
- The device step asks for one device per platform (one iOS simulator + one Android emulator)
- Device picker tracks two device slots per session

### Storage

- Project-local profiles: `<project>/.rn-dev/profiles/<profile-name>.json`
- Global profiles: `~/.rn-dev/profiles/<project-hash>/<profile-name>.json`
- Resolution order: CLI flags → project-local profile → global profile → interactive wizard

### Profile Behaviors

**Multiple profiles per worktree+branch.** One is marked as `isDefault: true`. `rn-dev start` loads the default.

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

**Branch step behavior:** The Branch step detects and displays the current branch of the selected worktree for confirmation. It does NOT perform a `git checkout`. If the user wants a different branch, they should switch branches outside the CLI first, or create a new worktree for it.

**Copying:** When switching to a new worktree, offer to clone an existing profile and adjust worktree/branch/port.

**Port allocation:** Auto-assign from pool 8081–8099, tracked in `.rn-dev/artifacts/` to avoid collisions.

**Profile management CLI:**

```bash
rn-dev profiles                                # list all profiles
rn-dev profiles default <name>                 # set default for current worktree+branch
rn-dev profiles default <name> --worktree <p>  # set default for specific worktree
rn-dev profiles list --all                     # show all profiles including orphaned
rn-dev start --profile <name>                  # load specific profile
```

**TUI profile switching:** Press `Shift+P` to open overlay list of profiles for current worktree+branch. Selecting hot-swaps config (may require metro restart if port changes).

### First-Run Setup

- Detect `.gitignore`, offer to add `.rn-dev/`
- Detect missing `.nvmrc`/`.node-version` — offer to create from current Node version
- Detect missing `.env` — offer to copy from `.env.example` if it exists

## Preflight Engine

Preflight checks run automatically before starting a session. Results display in the Interactive panel. Each check has a severity and optional auto-fix. Checks are filtered by the selected platform.

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
  worktree: string;          // worktree path or "root" for root repo
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
- Worktree hash: SHA-256 of absolute worktree path, truncated to 12 hex chars. Root repo uses the literal key `root`.
- On start: check if persisted port is free. If occupied by stale process → kill. If occupied by another worktree's active Metro → assign new port.
- Port persistence matters: devices built against a port expect that port. Changing ports forces a rebuild even in dirty mode.
- `rn-dev artifacts cleanup` command prunes orphaned artifacts for deleted worktrees.

### Dirty Mode + Port Artifact Logic

If the artifact shows a different port was used for the last build, dirty mode warns: "Last build used port 8082, Metro is now on 8083 — rebuild required" and auto-escalates to a rebuild step.

### Process Lifecycle

- Metro spawned as detached child with `--port`, `--reset-cache` (if clean/ultra-clean), `--verbose`
- stdout/stderr piped to TUI metro log panel AND written to `.rn-dev/logs/metro-<worktree>.log`
- **Crash handling:** on crash, show error + one-key restart. Exponential backoff on consecutive crashes (1s, 2s, 4s, max 30s). After 3 crashes within 60 seconds, stop auto-restarting and show diagnostic message with common causes (port conflict, config error, syntax error). Last 3 crash outputs are kept for debugging.
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
4. (iOS) `pod deintegrate` + remove `Pods/` + remove DerivedData (project-level `ios/build/` + project-specific entries in `~/Library/Developer/Xcode/DerivedData`)
5. (Android) `./gradlew --stop` + clean project-scoped gradle caches (`<project>/android/.gradle/`, `<project>/android/app/build/`). Does NOT touch global `~/.gradle/caches/`.
6. (Android) Uninstall app via `adb uninstall <bundleId>`
7. (iOS) Uninstall app via `xcrun simctl uninstall <deviceId> <bundleId>`
8. Reinstall `node_modules`
9. (iOS) `pod install`
10. Start Metro with `--reset-cache`

### Self-Preservation (npx mode)

When running via `npx` (detected by checking if `process.argv[1]` resolves inside the project's `node_modules`), ultra-clean must avoid deleting itself mid-operation:

1. Copy the single esbuild-bundled CLI binary to a temp directory
2. Re-exec from the temp copy with the same arguments + a `--self-preserved` flag
3. The temp copy performs the full ultra-clean (including deleting `node_modules`)
4. After reinstall completes, spawn a new instance from the reinstalled location and exit
5. If the temp copy fails (disk space, permissions), abort with a message suggesting global install

Global installs are unaffected — the binary lives outside `node_modules`.

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

### Sub-project 1 Scope

In Sub-project 1, only built-in modules are loaded (hardcoded registration). The `RnDevModule` interface is defined as the forward-looking plugin API, but:
- No npm package discovery
- No `package.json` `rn-dev.plugins` config
- No third-party plugin loading
- Built-in modules: Dev Space (0), Lint/Test (10), Metro Logs (20), Settings (90)

Third-party plugin loading is deferred to a future sub-project.

### Plugin Context (forward-looking)

Plugins will receive a `context` object with: current profile, metro instance, device list, project paths, artifact state, `runCommand()` helper, MCP tool registry, and CLI command registry.

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
rn-dev start --root <path>            # override project root (monorepo support)

rn-dev reload                         # reload app
rn-dev dev-menu                       # open dev menu
rn-dev clean --mode ultra-clean       # run clean operation

rn-dev devices                        # list devices
rn-dev worktrees                      # list worktrees
rn-dev profiles                       # list profiles
rn-dev profiles default <name>        # set default profile
rn-dev profiles list --all            # show all including orphaned
rn-dev artifacts cleanup              # prune orphaned artifacts

rn-dev lint                           # run linter
rn-dev typecheck                      # run type-check
rn-dev preflight                      # run checks
rn-dev preflight --fix                # auto-fix all fixable

rn-dev config theme <name>            # switch theme
rn-dev mcp                            # start MCP server (stdio)

rn-dev logs                           # tail CLI diagnostic log
rn-dev --verbose                      # enable debug logging for any command
```

### Communication: Unix Socket IPC

When the TUI is running, CLI commands connect to the running instance via a Unix socket at `<project>/.rn-dev/sock` rather than spawning a new process.

**Protocol:** JSON-RPC 2.0 over Unix domain socket (same protocol family as MCP/stdio, consistent with the codebase).

**Connection flow:**
1. CLI command starts, checks if `<project>/.rn-dev/sock` exists
2. Attempts to connect. If `ECONNREFUSED` → stale socket, delete it, run command standalone
3. If connected → send JSON-RPC request, receive response, display result
4. If socket doesn't exist → run command standalone (no TUI running)

**MCP coexistence:**
- `rn-dev mcp` standalone (no TUI running) — starts its own Metro, manages its own state, acts as primary
- `rn-dev mcp` while TUI is running — MCP server starts on stdio for the AI tool, but proxies all commands to the running TUI via the Unix socket. The MCP server is always a stdio process; the question is whether it acts as primary or proxy.

### CLI Diagnostic Logging

The CLI writes its own diagnostic logs to `~/.rn-dev/logs/rn-dev.log`. Enabled via `--verbose` / `--debug` flag on any command. `rn-dev logs` tails the log file. Covers: profile load failures, socket connection drops, preflight exceptions, metro spawn errors.

## Theming

### Built-in Themes (4)

Default theme: **Midnight**.

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
- Pipeline runs actions sequentially in defined order — no interactive prompts during pipeline
- Each action has a `haltOnFailure` boolean (profile-level setting): if true and the action fails, subsequent actions in the pipeline are skipped (no prompt, just skip)
- Two placeholders for custom commands: `{file}` (first/primary changed file), `{files}` (all changed files space-separated). Each action runs once per batch, not once per file.
- Output routes to tool output panel by default (configurable per action)
- Pipeline is non-blocking — coding continues while actions run
- New save during pipeline run cancels current run and restarts with new file set
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
- **CLI parsing:** commander (lightweight, no framework opinions, sufficient for the flat subcommand tree)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **File watching:** chokidar
- **Bundler:** esbuild (single-file output for distribution + self-preservation)
- **IPC:** JSON-RPC 2.0 over Unix domain socket

## Out of Scope (Future Sub-projects)

- **Sub-project 2:** Preflight auto-fix implementation details, build orchestration for `react-native run-ios/android`, third-party plugin loading via npm/package.json
- **Sub-project 3:** Plugin marketplace/registry, community theme distribution
