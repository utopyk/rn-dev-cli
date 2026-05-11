# Kimoby Dev CLI — Research & Inspiration for rn-dev-cli

**Date:** 2026-04-29
**Status:** Brainstorm — research input for plug-in / build-step extensibility design
**Sources read:** `kimoby-mobile-app/bin/dev-cli.js` + `bin/dev-cli/{build,devices,packages,preflight,profiles,tmux,utils,worktree}.js`, `bin/worktree`, `bin/change-env.js`, `bin/assemble-release-android`, `lefthook.yml`, `package.json`, `bin/dev-tips.txt`, `bin/worktree-devices.conf.example`. Compared against rn-dev-cli's `src/core/`, `src/app/`, `src/modules/`, `electron/ipc/`, and the in-flight module-system plan.

---

## 1. Overview of kimoby's dev-cli

### What it is

A single-repo, project-private interactive TUI prompting the developer for environment / platform / device / scheme, then orchestrating the entire "from cold to running app" pipeline: env-file rewrite, Firebase config swap, preflight tooling checks, package install, watchman/Metro reset, native build, app launch, and on-failure error extraction. It is invoked via `pnpm dev` (mapped to `node bin/dev-cli.js` in `package.json:19`). It is **not** a published CLI — it is a per-repo script sourced from `bin/`.

The single mental model: a kimoby developer runs `pnpm dev` and gets a guided prompt the first time, then `pnpm dev` again to build with saved choices. `pnpm dev -i` re-prompts; `pnpm dev --set-profile` updates without building; `bin/worktree create <name>` spins up an isolated parallel workspace.

### Surface area

**Subcommands / modes** (resolved through flags, not positional verbs):
- Default: prompt or use saved profile, then build+run.
- `-i / --interactive`: re-prompt all selections.
- `--set-profile`: persist preferences without building.
- `--set-checks`: change preflight cadence (`always` / `once`) + which checks run.
- `--no-checks`: skip preflight entirely.
- `--use-local-packages`: rewrite `@kimoby/*` deps to `file:` paths.
- `--test-errors <logfile>`: replay the build-error extractor against a saved log.
- `--no-tmux`: skip multipanel.
- `-v / --verbose`: full xcodebuild/gradle output (no spinner).
- `--show-profile`: rendered for the tmux profile pane.
- `--key-forwarder`: internal — runs the logo pane that forwards Metro hotkeys.

**Companion shell tool** at `bin/worktree` (Bash, ~1000 lines):
- `create <name>` / `remove <name>` / `list` / `status` / `sync [name]` / `start <name> <ios|android> [--no-build]`.
- Owns the per-worktree device pool (`worktree-devices.conf`), AVD provisioning, port derivation, hardlink artifact copy, and Gradle daemon lifecycle.

### Architecture

Five-layer module split inside `bin/dev-cli/`, all CommonJS:

| Module | Job |
| --- | --- |
| `dev-cli.js` (entry) | Flag parsing, signal handlers, top-level state machine, tmux gate, profile-vs-prompt branching. |
| `build.js` | Metro spawn/kill/`/status` poll, watchman start/stop, Xcode-running detection, `executeClean` / `executeUltraClean` / `executeRun`, `extractBuildErrors` (regex pipeline), iOS pod-version mismatch resolver, Android isolated build path (assemble + adb install on a single device). |
| `devices.js` | iOS sim + physical device enumeration via `xcrun simctl list devices --json` + `xctrace list devices`; Android via `adb devices -l` + `emulator -list-avds`; sim-runtime arch map; SDK-version mismatch warning; AVD auto-creation from system images or template-clone. |
| `preflight.js` | 11 named checks (`node`, `pnpm`, `cocoapods`, `xcode-cli`, `xcode`, `android-home`, `java-home`, `ideviceinstaller`, `adb`, `tmux`, `github-token`); `multiselect` UI; auto-fix loop (`nvm install`, `npm i -g pnpm`, …). |
| `profiles.js` | `loadProfile/saveProfile` to `bin/.build-profile`, `renderProfileToConsole` (the cyan boxed display in the tmux profile pane), `isEnvStale` (mtime check on `.env`). |
| `packages.js` | `getKimobyPackages` (filter `package.json` deps by `@kimoby/*`), `promptLocalPackages` (groupMultiselect by deps/devDeps), `applyLocalPackages` (rewrite to `file:` refs), `applyEnvSwitch` (chains `change-env.switchEnv` + `updateDevToolsConfig` + `copyFirebaseConfigs`), `arePackagesStale` (compare `pnpm-lock.yaml` mtime vs `node_modules/.modules.yaml`). |
| `tmux.js` | tmux session creation, 5-pane layout (logo, CLI, profile, terminal, Metro), key forwarder for Metro shortcuts (`r`/`d`/`j` forwarded to the Metro pane, `f` runs format+lint in terminal pane), rotating tips banner, neon purple/cyan styling. |
| `worktree.js` | `detectContext` (parse `.worktree-local`), `create`, `list` (HTTP-probe each worktree's port for live Metro), `getRecentBranches`, `suggestWorktreeName`, `smartArtifactCopy` (hardlinks `ios/build` and `android/app/build` if `package.json` deps + Podfile match). |
| `utils.js` | `derivePort` (md5 of slug → 9000-9999), `commandExists`, `ensureValidPort`, terminal-width helper. |

`bin/change-env.js` is shared with `bin/proxy` and external scripts: it parses commented-out `#env-<name>` blocks in `.env`, "switches" the active environment by uncommenting one block + commenting others, swaps Firebase config files (`ios/firebase/staging.plist` ↔ `ios/GoogleService-Info.plist`), and rewrites `API_URL` to point at the local IP + proxy port when `local` is selected. It also calls `git update-index --assume-unchanged` on the swapped Firebase configs so they don't pollute git.

The whole thing is glue — no daemon, no IPC, no plugin loader. It is "shell scripts pretending to be a TUI." That's the strength: trivial to read, trivial to fork, trivial for a per-repo customisation. It is also the limit: nothing is reusable outside this repo.

---

## 2. What kimoby's tool does BETTER than rn-dev-cli

### 2.1 Environment-file orchestration as a first-class concept

kimoby's `bin/change-env.js` understands that a kimoby developer toggles between `local` / `staging` / `production` / `custom` environments by uncommenting one block in `.env` and that this requires:
- Rewriting `API_URL` to the developer's LAN IP when `local` is selected.
- Copying `ios/firebase/staging.plist` (or production) into the active `GoogleService-Info.plist` slot.
- `git update-index --assume-unchanged` on the swapped files.
- Clearing keys like `PUSHER_KEY` for local mode.
- Detecting that `.env` mtime > `lastBuildAt` (`profiles.js:isEnvStale`) and **escalating the run mode** from `dirty` → `ultra-clean` with a prompt: "Env vars changed since last build. How do you want to proceed?"

rn-dev-cli's `Profile.env: Record<string, string>` ([src/core/types.ts:13](../../src/core/types.ts:13)) is just a key/value map passed to spawned subprocesses. There is **no** `.env` file rewriter, **no** environment-switching concept, **no** Firebase-config swap, **no** mtime-based env-staleness escalation. The closest analog is `MetroManager.needsRebuild()` ([src/core/metro.ts:509](../../src/core/metro.ts:509)) which only checks port drift.

**Gap:** rn-dev-cli has no opinion on multi-environment apps. Most React Native apps have at least dev/staging/prod and platform-specific signing assets that need swapping. We currently delegate to whatever `react-native run-ios --scheme` happens to do.

### 2.2 Stale-state detection drives mode escalation, not just warnings

`dev-cli.js:608-687` (the `useProfile && runMode === 'dirty'` branch) detects two staleness signals (`arePackagesStale` and `isEnvStale`) and offers the user a tri-state escalation: Switch to ultra-clean / Switch to clean / Continue dirty anyway. Crucially the wording **recommends** the safe choice and labels the current path "may fail." rn-dev-cli surfaces no such warning today; the wizard simply runs whatever the saved profile says.

`packages.js:arePackagesStale` is a simple mtime compare:
```
pnpm-lock.yaml.mtime > node_modules/.modules.yaml.mtime ⇒ "pnpm-lock.yaml changed since last install"
```

That's a one-liner per check, but it converts "user unknowingly building against stale state" into "user is asked the right question at the right moment." rn-dev-cli's `Artifact.checksums` ([src/core/types.ts:60](../../src/core/types.ts:60)) reserves space for `packageJson`/`lockfile`/`podfileLock` checksums but the wizard / start flow doesn't act on them.

### 2.3 The build-error extractor

`build.js:extractBuildErrors` (~80 lines, lines 26-102) is a hand-tuned regex pipeline that turns 50,000 lines of xcodebuild noise into a 3-15 line "what actually broke" list. It has separate `ERROR_PATTERNS` (clang: error, linker command failed, undefined symbol, no such module, code signing error, provisioning profile error, build input file cannot be found, duplicate symbol …) and `SKIP_PATTERNS` (warnings, `-Werror`, `-Wno-`, derived data noise, RN CLI boilerplate, `** BUILD FAILED **`, …). Each error captures up to 8 continuation lines of context (`Caused by:`, `Add `, `Please `, `In file `).

When extraction fires, the user sees a `p.note(…, 'Build Errors')` boxed list of the actual problems, not "Process exited with code 65." The CLI explicitly hands the user `--verbose` for next time and saves the full log to `/tmp/kimoby-build.log`.

rn-dev-cli's [src/core/build-parser.ts](../../src/core/build-parser.ts) already handles xcresult bundle parsing + xcodebuild/gradle regex parsing + line-context extraction at [src/core/builder.ts:237-271](../../src/core/builder.ts:237). The kimoby extractor has worse coverage (no xcresult), but **its output style is better**: a 3-15 line tight list, not a vertical column of structured `BuildError[]` objects. There's a UX lesson: agents and humans both want the answers, not the schema.

### 2.4 Worktree device pool — the killer feature

`bin/worktree-devices.conf.example` declares slots:
```
1:iPhone 16 Pro - WT1:worktree-1:5560
2:iPhone 16 Pro - WT2:worktree-2:5562
3:iPhone 16 Pro - WT3:worktree-3:5564
```
A worktree is allocated `(slot, ios_simulator, android_avd, emu_port)` automatically on `bin/worktree start`. If the requested device is held by another worktree with running Metro, kimoby reassigns to a free slot. If the AVD doesn't exist, `ensure_android_avd` provisions it from a template clone. Each worktree gets its own `.worktree-local` shell-export file consumed by both the Bash worktree script and the Node CLI.

rn-dev-cli has multi-worktree state in [src/core/metro.ts](../../src/core/metro.ts) and per-worktree port allocation, but **no device-pool concept** — two worktrees could attempt to deploy to the same simulator and silently overwrite each other (which is exactly why kimoby's `executeIsolatedAndroidBuild` exists: rnc-cli's Gradle install task targets ALL connected devices and clobbers other worktrees' APKs). The bash worktree script's `cmd_start_android` comment makes this explicit: kimoby's response is to do `gradlew assembleBetaDebug` + `adb -s <device> install` themselves so they can target one device.

### 2.5 Hardlink artifact bootstrap for new worktrees

`worktree.js:smartArtifactCopy` and `bin/worktree:_cmd_create_install_deps` do something rn-dev-cli doesn't: **hardlink-copy** the main repo's `ios/build` and `android/app/build` into the new worktree on creation, but **only if** `package.json` deps + Podfile content match. The `cp -al` is near-instant and converts a 5-minute first-build into a 30-second incremental build for the new worktree.

### 2.6 Branch-deterministic port derivation

`utils.js:derivePort` and `bin/worktree:derive_port` compute the same MD5-based port (range 9000-9999) from the branch name in **both** Node and Bash. Two cooperating tools (the JS CLI, the bash worktree script) agree on the port without consulting each other. rn-dev-cli's port allocator ([src/core/metro.ts:64-87](../../src/core/metro.ts:64)) finds-the-first-free-port — fine in single-process mode, but it forces a coordination round-trip if a second tool wants to know "what port will worktree X use?"

### 2.7 The tmux multipanel is genuinely magical

5 panes — logo+shortcuts (with raw-mode keypress forwarding to Metro pane), build profile (auto-refreshing on save via `tmux send-keys`), CLI prompts, terminal scratchpad, Metro logs. `Ctrl+B`+arrows to switch. Pressing `r`/`d`/`j` in the logo pane forwards to Metro. Pressing `f` runs `pnpm format --write && pnpm lint --fix` in the terminal pane. Rotating tips banner cycling through `bin/dev-tips.txt` every 8 seconds.

This is project-aware terminal automation that no general-purpose CLI does well. The closest rn-dev-cli surface is the OpenTUI Ink-style App ([src/app/App.tsx](../../src/app/App.tsx)) which is in-process and doesn't decompose the screen the same way.

### 2.8 Local-package linking workflow

`packages.js:promptLocalPackages` + `applyLocalPackages` — surface ALL `@kimoby/*` deps grouped by `dependencies` / `devDependencies`, prompt for each selected package's local path (defaulting to `..`), and rewrite `package.json` deps to `file:<relative>`. Then enforces a runMode ≥ `clean` ("Switch to clean — recommended"). Trivial in shell terms, very high payoff for a monorepo team developing SDKs alongside the app.

rn-dev-cli has no equivalent; agents and humans both have to do it manually.

### 2.9 Pod-version mismatch self-resolution

`build.js:executePodInstall` reads cocoapods version from `Gemfile.lock` and `Podfile.lock`, detects mismatch, and asks: "Use project version (delete Podfile.lock + bundle exec pod install)" or "Update project to <X> (bundle update cocoapods + bundle exec pod install)." rn-dev-cli's clean step ([src/core/clean.ts:354-360](../../src/core/clean.ts:354)) just runs `bundle exec pod install --repo-update` and doesn't notice the version drift.

### 2.10 First-time-only checks

The GitHub Packages token check in `preflight.js:233-281` runs only when `loadProfile()` returns null (first run on this machine), prompts for the token via `p.password`, and appends to `~/.npmrc`. Smart cadence: don't block experienced developers but make sure new ones get authed.

### 2.11 Per-environment guidance prose

`dev-cli.js:951-973` — when env is `local`, the CLI starts the local proxy, checks port reachability for backend (5050), web app (3000), and Reactotron (9090), and surfaces each with `success`/`warn`. Not a generic feature; a project-specific one. But it's the kind of project-specific knowledge that a CLI can encode and replay every session, instead of forcing the developer to remember what to check.

---

## 3. What rn-dev-cli does BETTER than kimoby's tool

### 3.1 Daemon + per-worktree state machines

rn-dev-cli's [src/core/metro.ts](../../src/core/metro.ts) `MetroManager` (`EventEmitter` + `Map<worktreeKey, MetroInstance>`), [src/core/builder.ts](../../src/core/builder.ts) `Builder` (with explicit concurrency guard at [src/core/builder.ts:64-78](../../src/core/builder.ts:64)), [src/daemon/](../../src/daemon/) supervisor, and [src/core/devtools.ts](../../src/core/devtools.ts) all run inside a long-lived per-project daemon with proper lifecycle. kimoby has **no daemon** — every `pnpm dev` invocation starts from zero. That means kimoby can't:
- Watch Metro logs without a foreground process holding the terminal.
- Run multiple agent sessions against the same Metro.
- Survive a TUI exit and let the build keep running.
- Subscribe to events that started before the consumer attached.

rn-dev-cli's session-snapshot-then-subscribe model ([src/app/start-flow.ts:266-275](../../src/app/start-flow.ts:266) for `recentLogs() → on('log')`) avoids the "missed the event" race that kimoby's spawn-on-demand approach can't.

### 3.2 MCP server — the "agent can do everything a human can" thesis

[src/mcp/](../../src/mcp/) exposes Metro / DevTools / Builder / Watcher / module operations as MCP tools. kimoby has zero agent integration — it is a human-only CLI. For a Claude or Cursor agent operating on a kimoby-style project today, **everything is opaque**: the agent can't list devices, can't switch env, can't kick a build, can't see Metro logs without manually `cat`-ing a tmpfile. rn-dev-cli treats MCP as the primary contract, with the GUI/TUI as derived consumers ([README.md:5-7](../../README.md:5)).

### 3.3 GUI parity — Electron renderer

[renderer/](../../renderer/) + [electron/ipc/](../../electron/ipc/) provide a GUI surface (Marketplace, DevTools Network panel, Module config forms, Settings, build progress) reusing exactly the same daemon. kimoby's CLI is terminal-only.

### 3.4 Audit log

[src/core/audit-log.ts](../../src/core/audit-log.ts) — HMAC-chained append-only `~/.rn-dev/audit.log` for every privileged operation (module install/uninstall/config-set, destructive tool calls). kimoby has nothing comparable — destructive operations like `pnpm clean` happen with no record.

### 3.5 Module subprocess sandbox

[src/core/module-host/](../../src/core/module-host/) — manifest-driven module system, vscode-jsonrpc subprocess isolation, marketplace + consent dialog, module-scoped panels with `partition: 'persist:mod-<id>'`. kimoby has **no extensibility** — to add a feature you fork `bin/dev-cli.js`. rn-dev-cli is designed as a platform.

### 3.6 Build-error xcresult extraction

[src/core/build-parser.ts](../../src/core/build-parser.ts) `parseXcresultErrors` reads the structured xcresult bundle directly — far more reliable than kimoby's stdout-regex pipeline. The detection at [src/core/builder.ts:147-150](../../src/core/builder.ts:147) auto-discovers the path from xcodebuild's stderr line.

### 3.7 Test layering rigor

The three-layer verification standard in [CLAUDE.md:20-28](../../CLAUDE.md:20) (vitest → tsc → playwright Electron smoke) catches what kimoby has no equivalent for. kimoby has Jest + lefthook for the **app's own** code, but the CLI itself has no tests — it's hand-validated.

### 3.8 Per-worktree isolation by design

rn-dev-cli's port allocator + DevTools manager + Builder + Metro manager are all keyed by `worktreeKey`. kimoby achieves worktree isolation by **separate process trees** (`bin/worktree start` runs in the worktree's own cwd) — which works for human use but breaks down when one daemon needs to manage state across multiple worktrees (e.g. agent says "show me Metro logs for branch X" while the human is working on branch Y).

### 3.9 Theme system

[src/themes/](../../src/themes/) — `loadTheme` + `getThemeEffects` (vignette + scanlines) ([src/app/start-flow.ts:73-75](../../src/app/start-flow.ts:73)). kimoby hard-codes neon purple/cyan in tmux.js with no override. (Honestly, kimoby's hard-coded look is gorgeous — but the abstraction is missing.)

---

## 4. What rn-dev-cli is missing that kimoby has

Each entry: **[priority] short title — what it is, why we need it, ~implementation sketch.**

### [P0] Environment-file switcher (`.env` block toggle)

**What kimoby does:** `bin/change-env.js:switchEnv(name)` parses `#env-<name>` markers in `.env`, uncomments the block matching the chosen environment and comments others. Coordinates with Firebase config swap.
**Why we need it:** Real RN apps multiplex environments via `.env`; without first-class support we'll always feel like a layer below kimoby's CLI for production teams. Every kimoby dev would feel this on day 1.
**Sketch:** New `src/core/env-switcher.ts` exposing `EnvFileManager.list()`, `.activate(name)`, `.activeName()`, `.isStale(profile)`. Driven by a per-project config (see §6) that declares which file format the project uses (kimoby-style commented blocks, dotenv-flow stack, `.env.<name>` files, …). Surface as MCP `env/list`, `env/activate`, `env/active`. Wire into wizard between platform-pick and device-pick.

### [P0] Stale-state detection that escalates the run mode

**What kimoby does:** `arePackagesStale` (lockfile mtime > node_modules/.modules.yaml mtime) + `isEnvStale` (env file mtime > profile.lastBuildAt) → tri-state escalation prompt.
**Why we need it:** Stale lockfile or stale env vars ⇒ silent build failure or confusing runtime crash. We currently store `lastBuildPort` ([src/core/types.ts:66](../../src/core/types.ts:66)) but no `lastBuildAt`. A 50-line addition per check pays for itself within a week.
**Sketch:** Extend `Artifact` ([src/core/types.ts:56](../../src/core/types.ts:56)) with `lastBuildAt: number`, `lastEnvHash: string`, `lastLockfileHash: string`. Add `StalenessDetector` ([src/core/staleness.ts](../../src/core/staleness.ts)) returning a typed reason (`PackagesOutdated` / `EnvChanged` / `Both`). Wizard consumes it to show the escalation select + sets `profile.mode = 'clean'`/`'ultra-clean'` if user accepts. MCP tool `staleness/check` for agents.

### [P0] Worktree device pool config

**What kimoby does:** `bin/worktree-devices.conf` slots assignment. Auto-AVD creation. Cross-worktree collision detection (refuses to start if another worktree owns the device with running Metro).
**Why we need it:** rn-dev-cli ships a Device Control module ([modules/device-control/](../../modules/device-control/)) but no concept of "this worktree owns this device" arbitration. Two parallel agents would fight over the same simulator.
**Sketch:** New artifact field `Artifact.deviceSlot: number | null`. New per-project `rn-dev.devices.json` (committed) declaring the pool. `DeviceManager` ([src/core/device.ts](../../src/core/device.ts)) gains `acquireSlot(worktreeKey)` / `releaseSlot(worktreeKey)` / `findSlotOwner(deviceId)`. Wire collision check into auto-build trigger. AVD-from-template logic lifts to `src/core/device.ts` (new method `ensureAndroidAvd(name)`). MCP `device/acquire-slot`, `device/release-slot`.

### [P0] Build-error extractor refresh — `note`-style condensed output

**What kimoby does:** Returns `errors: string[]` of exactly the lines that matter, deduplicated, grouped with continuation context. Emits `p.note(errors.slice(0, 15).join('\n\n'), 'Build Errors')`.
**Why we need it:** rn-dev-cli has structured `BuildError[]` but the renderer / TUI / MCP consumer often shows the full structured detail when a 3-line summary would do. Agent context windows particularly suffer.
**Sketch:** Add `BuildError.shortSummary?: string` (defaults to `summary.slice(0, 150)`). Add `summarizeErrors(errors): string[]` ([src/core/build-parser.ts](../../src/core/build-parser.ts)) used by MCP tool responses + the build-failure renderer. New deduplication pass: if two errors share `file:line`, collapse.

### [P0] First-run-only preflight gating + auto-fix loop

**What kimoby does:** `preflight.js:runPreflightChecks` collects `issues` (only `severity=error` ones), prompts "Attempt to fix automatically?", runs the `autoFix` shell command per issue, surfaces success/fail with manual fallback. 11 named checks with stable ids the user can opt out of via `--set-checks`.
**What rn-dev-cli has:** [src/core/preflight.ts](../../src/core/preflight.ts) `PreflightEngine` runs in parallel and has a `fix()` method, but the wizard doesn't drive an interactive auto-fix loop. The "checks frequency: once|always" idea is in the type ([src/core/types.ts:21](../../src/core/types.ts:21)) but not wired through the CLI start flow.
**Sketch:** In [src/cli/commands.ts](../../src/cli/commands.ts) `start`, run preflight when `profile.preflight.frequency === 'always'` OR `!artifact.preflightPassed`. After collecting failed checks with a non-null `fix` fn, show the auto-fix select. Persist `artifact.preflightPassed = true` after first all-green pass. New MCP `preflight/run`, `preflight/fix`.

### [P1] Local-package linking workflow

**What kimoby does:** `--use-local-packages` → `groupMultiselect` → per-package path picker → `package.json` rewrite to `file:`.
**Why we need it:** Anyone consuming rn-dev-cli who also ships an SDK alongside their app will want this. Today it's the user's manual job.
**Sketch:** Build-step hook (see §6) `linkLocalPackages` that takes a list of `{ name, path }` and rewrites `package.json`. Detection convention: hook lists packages it's interested in (`@org/*` glob), hook returns list with paths.

### [P1] tmux multipanel mode (or terminal multiplexer abstraction)

**What kimoby does:** 5-pane tmux session, key forwarder pane, profile auto-refresh.
**Why we need it:** OpenTUI's in-process splits can't replicate "Metro logs in a separate scrollable terminal pane that the user can attach/detach with tmux." Many devs already live in tmux; the multipanel feature is the strongest single reason a kimoby dev would not switch to rn-dev-cli.
**Sketch:** Optional `src/app/multipanel/` driver supporting tmux + zellij + (Wezterm). Detect terminal program (`process.env.TERM_PROGRAM`), warn on Warp/VS Code, prompt once and persist preference. The feature is low-risk because we can ship a "no-tmux" default.

### [P1] On-launch project-specific port-reachability checks

**What kimoby does:** When env is `local`, hits the proxy/backend/Reactotron ports and warns on each unreachable.
**Why we need it:** Generic version: "user can declare per-environment readiness probes." Today rn-dev-cli has no concept of this.
**Sketch:** Build-step hook `onEnvironmentSelected({ name })` returns `Array<{ name, url, expectedStatus }>`; daemon probes them and surfaces in the UI panel + as `serviceBus.log` lines.

### [P1] CocoaPods version mismatch self-resolver

**What kimoby does:** Compare Gemfile.lock vs Podfile.lock cocoapods version, prompt resolution choice.
**Why we need it:** Pod install failures are a top-3 reason builds fall over. We currently just `--repo-update` and hope.
**Sketch:** Add to [src/core/clean.ts](../../src/core/clean.ts) `executePodInstall` step a pre-check; if mismatch, emit a `clean/podVersionMismatch` event the wizard or auto-build path resolves before continuing.

### [P2] Branch-deterministic port allocator

**What kimoby does:** md5 of branch slug → port ∈ [9000, 9999].
**Why we need it:** External tooling (CI scripts, IDE integrations, tmux statuslines) can predict the port without consulting the daemon.
**Sketch:** Add `derivePort(branch)` ([src/core/metro.ts](../../src/core/metro.ts)) as an alternative allocator, opt-in via `profile.portStrategy = 'free' | 'branch-derived'`.

### [P2] Hardlink artifact bootstrap on worktree create

**What kimoby does:** `cp -al` of `ios/build` and `android/app/build` after dep-match check.
**Why we need it:** First build in a fresh worktree drops from 5 min to 30 s. Big quality-of-life win for parallel agent workflows we already encourage.
**Sketch:** Add to [src/core/module-host/manager.ts](../../src/core/module-host/manager.ts) or a new `src/core/worktree-bootstrap.ts` invoked from a `worktree/create` MCP tool we don't have yet.

### [P2] Rotating tips ribbon

**What kimoby does:** `bin/dev-tips.txt` cycled every 8 seconds in the tmux logo pane.
**Why we need it:** Discoverability for shortcuts and project conventions. Kimoby's `dev-tips.txt` includes things like "Don't use `git push --no-verify`" and "Use Luxon, not moment.js" — opinions encoded into the dev surface.
**Sketch:** Per-project `rn-dev.tips.txt` (one tip per line). Renderer/TUI cycles them in a status strip when the build is idle. Trivial.

### [P2] First-run GitHub Packages token capture

**What kimoby does:** First-run check inserts an auth line into `~/.npmrc` if missing.
**Why we need it:** Generalized version: "this project requires auth-token X in your environment; here's how to provide it." Useful for npm Pro, GitHub Packages, custom registries.
**Sketch:** Build-step hook `requireSecrets() → Array<{ envVarOrConfigKey, doc, validate }>`; daemon prompts on first run, persists to `~/.rn-dev/` (NOT to the project), validates on subsequent runs.

---

## 5. Inspiration: design patterns we could borrow

### 5.1 The "mode-escalation" prompt pattern

Kimoby's escalation UX (warn → select with `recommended` hint → user picks → mode bumps) is a fantastic pattern for any "we detected drift; here's what we'd do" decision. We can apply it beyond stale lockfiles: when the saved device is gone, when the saved scheme is gone, when a new RN version is detected, when Xcode SDK ≠ simulator iOS major. Build a generic `EscalationPrompt` UI primitive in renderer + TUI that takes `{ reasons: string[], options: Array<{ value, label, hint, recommended? }> }`.

### 5.2 Profile rendering as a diagnostic surface

`profiles.js:renderProfileToConsole` draws a cyan box with run-mode/env/platform/device/scheme + checks state + multipanel state. It is surfaced in tmux's profile pane and refreshes after every save. This is essentially "show me what is going to happen" — and rn-dev-cli already has a `Profile` data model, so we could render this in the Electron status bar and the TUI header today.

### 5.3 Lefthook as the canonical pre-push gate

[lefthook.yml](../../../../Documents/GitHub/kimoby-mobile-app/lefthook.yml) runs format-check + lint + ts + translations-check + jsonapi-codegen-integrity-check in **parallel** on `pre-push`. Our `package.json` in rn-dev-cli already has `vitest run`, `tsc --noEmit`, and `playwright test` listed, but no shipped lefthook config. We could publish an opinionated `lefthook.yml.example` that consuming RN apps can drop in (and that the daemon could even auto-run on save in "agent mode").

### 5.4 Tips file as a tribal-knowledge encoding

`bin/dev-tips.txt` (15 lines) encodes 15 things a new kimoby dev needs to know — node version source, pod install command, multipanel hotkeys, format-before-commit, tailwind colors. This is documentation that the dev sees while working, not in a wiki. Per-project `rn-dev.tips.txt` (or section in the rn-dev config) feels like it would slot perfectly into the OpenTUI status bar.

### 5.5 Bash + Node hybrid for portability

kimoby's `bin/worktree` is Bash, `bin/dev-cli.js` is Node, and they share the port-derivation algorithm bit-exactly. This is a real pattern: things that need to be invoked from CI (shellable, no node setup) vs things that need rich terminal UI (Node). We don't need to replicate it, but it suggests our build-step hook contract should be **subprocess-shaped** so a `bin/preflight.sh` Bash script can be a hook just as easily as a `preBuild.ts` TypeScript callback.

### 5.6 The "Xcode is open" detection / kill flow

`build.js:isXcodeRunning` + `ensureXcodeClosed` is a tiny but high-value flow — `pgrep -x Xcode`, prompt to quit, `osascript -e 'quit app "Xcode"'`, poll, fall back to manual confirmation. We have `isXcodeRunning` / `killXcode` in [src/core/clean.ts:228-256](../../src/core/clean.ts:228) but they're not wired into the build flow. Adding a "before pod install, ensure Xcode closed" step (configurable, default-on for ultra-clean) would prevent a category of confusing "Pods/Manifest.lock conflict" errors.

### 5.7 `--test-errors <logfile>` — ship the parser standalone

kimoby's `--test-errors` flag re-runs the build-error extractor against a saved log. We should ship `rn-dev parse-build-log <file>` similarly so devs can iterate on parser improvements offline (and so agents can ask "what was wrong with that build?" by passing in the logfile path).

---

## 6. Plugin / build-step extensibility design

This is where the kimoby tool actually maps onto rn-dev-cli's architectural decisions. Kimoby drops scripts into `bin/`. We have two extension surfaces that need to carry that pattern: the **third-party module system** ([rn-dev-module.json manifest](../../docs/plans/2026-04-21-feat-module-system-and-device-control-plan.md)) for capabilities you'd publish, and a new **per-project build-step hooks** system for capabilities that are inherently project-specific.

### 6.1 Map of kimoby features → module vs. hook

| Kimoby feature | Naturally a 3p MODULE | Naturally a per-project HOOK | Notes |
| --- | --- | --- | --- |
| `.env` block switcher | | ✓ | `.env` shape varies per project; hook owns it. |
| Firebase config swap | | ✓ | Path layout (`ios/firebase/<env>.plist`) is project-specific. |
| Local `@kimoby/*` package linking | | ✓ | Hook declares the dep glob; rn-dev-cli runs the multiselect UI. |
| Worktree device pool | ✓ (built-in) | | Lives in core; pool data lives in a per-project committed config. |
| AVD provisioning from template | ✓ (device-control module) | | Generic enough for the marketplace. |
| Build-error extractor regex pipeline | ✓ (built-in) | | Generic + can be augmented by a hook for project-specific patterns. |
| tmux multipanel | ✓ (optional terminal-driver module) | | Module slot is right because alternatives (zellij, wezterm) are pluggable. |
| Pod-version mismatch resolver | ✓ (built-in) | | Generic. |
| GitHub Packages first-run setup | | ✓ | Project declares "we need token X for registry Y". |
| Local-mode port reachability check | | ✓ | Project declares which probes to run per env. |
| Custom Android assemble path (assemble + adb install) | | ✓ | Some projects have unusual install flows; hook lets them override. |
| Rotating tips file | | ✓ | Per-project file. |
| `--set-profile` UI | ✓ (built-in) | | Already exists in our wizard. |
| `bin/assemble-release-android` (apksigner + zipalign) | | ✓ | Per-project release flow; hook is right. |

### 6.2 Proposed config file: `rn-dev.config.ts`

A consuming RN app drops a single TypeScript file at the project root. Example skeleton (not real code; illustrative shape):

```
import { defineConfig } from '@rn-dev/config'

export default defineConfig({
  hooks: {
    preBuild: 'bin/preflight.sh',
    onEnvironmentSelected: 'bin/swap-firebase.sh',
    customClean: 'bin/wipe-derived-data.sh',
    postMetroStart: { script: 'bin/start-mock-server.js', timeoutMs: 30_000 },
  },
  env: {
    file: '.env',
    format: 'commented-blocks',  // or 'dotenv-stack', 'env-files'
    blockMarker: /^#env-(\S+)/i,
  },
  packages: {
    localLink: { glob: '@kimoby/*' },
  },
  worktree: {
    devicesFile: 'bin/worktree-devices.conf',
    portStrategy: 'branch-derived',
  },
  preflight: {
    extra: [{ id: 'github-packages-token', script: 'bin/check-token.sh' }],
  },
  tips: 'bin/dev-tips.txt',
})
```

Loaded at daemon startup via the same `vscode-jsonrpc` machinery (or — for hot iteration — a Bun-native dynamic import). The config is **typed**, exported via an `@rn-dev/config` package that ships the `defineConfig` helper + JSON Schema for IDE validation. Same DX as `vite.config.ts` / `playwright.config.ts`.

### 6.3 Hook lifecycle phases

| Phase | When fired | Receives | Use case |
| --- | --- | --- | --- |
| `init` | Daemon spawn for this project | `{ projectRoot, worktreeKey }` | Validate prerequisites (e.g. token in `~/.npmrc`). |
| `preflightExtra` | After built-in preflight, before profile decision | `{ profile, platform }` | Project-specific checks like the GitHub-Packages-token probe. |
| `onEnvironmentSelected` | After user picks env in wizard or auto-build | `{ name, profile }` | Swap Firebase configs, rewrite API URLs. |
| `preClean` | Before clean steps run | `{ mode, platform, profile }` | Kill custom long-running processes. |
| `customClean` | Replaces / augments built-in clean | `{ mode, platform, profile }` | kimoby-style "wipe non-default DerivedData paths". |
| `postClean` | After clean steps complete | `{ mode, platform, profile, results }` | Rebuild local caches that the clean wiped. |
| `preInstall` | Before package-manager install | `{ packageManager, profile }` | Apply `--use-local-packages` rewrites here. |
| `postInstall` | After package-manager install | `{ packageManager, profile }` | Run codegen (`pnpm codegen` in kimoby's case). |
| `preMetroStart` | Before spawning Metro | `{ port, projectRoot }` | Start a mock backend; warm watchman. |
| `postMetroStart` | After Metro `/status` returns ready | `{ port, projectRoot }` | Start Reactotron, port-reachability probes. |
| `preBuild` | Before `react-native run-*` | `{ platform, deviceId, port, profile }` | Validate signing, regenerate codegen artifacts. |
| `customBuild` | Replaces built-in build | same as preBuild | The kimoby Android assemble + adb install path. |
| `postBuild` | After build success | `{ platform, success, errors, profile }` | Send a slack ping, write a build-info file. |
| `onLaunch` | App launched | `{ deviceId, bundleId, profile }` | Auto-open a debugger URL, attach Reactotron. |
| `onShutdown` | Daemon exit | `{ projectRoot }` | Cleanup. |

Hooks are **additive**, not overriding — `customClean` and `customBuild` are the two exceptions because some projects (kimoby's Android isolated build) genuinely need to replace the default. Override hooks return `{ replaced: true }` from their first event to signal the daemon to skip the built-in step.

### 6.4 Hook contract (env vars, stdin/stdout, exit codes)

**Default flavor: subprocess.** Matches kimoby's `bin/`-script ergonomics + works for both Bash and Node. The daemon spawns the hook with:

- `cwd` = `projectRoot` (or worktree path).
- `env`:
  - all current process env, plus
  - `RN_DEV_PHASE` (e.g. `preBuild`)
  - `RN_DEV_PROFILE_JSON` (the active profile, JSON-stringified)
  - `RN_DEV_PROJECT_ROOT`
  - `RN_DEV_WORKTREE_KEY`
  - `RN_DEV_PLATFORM` / `RN_DEV_DEVICE_ID` / `RN_DEV_METRO_PORT` (when relevant to the phase)
  - `RN_DEV_HOST_VERSION`
- `stdin`: a single JSON line with the phase payload (a duplicate of the env vars in structured form, for hooks that prefer to parse JSON over reading env).
- `stdout`: hook may emit JSON-line records: `{ "kind": "log", "level": "info"|"warn"|"error", "message": "…" }` or `{ "kind": "result", "data": {…} }`. Anything not matching the JSON-line shape is treated as a free-form log line and forwarded to `serviceBus.log`.
- `stderr`: forwarded to `serviceBus.log` at warning level.
- Exit code: `0` = success; non-zero = failure (semantics depend on phase, see below).
- Timeout: per-hook configurable (default 30 s for `pre*` hooks, 5 min for `customBuild`/`customClean`).

**Alternative flavor: in-process JS callback.** When the hook is registered as a function in `rn-dev.config.ts` (not as a script path), the daemon `import()`s the module once (cached) and calls the function with the same payload as a typed object. Same return contract: void resolves clean, throw = failure, optional `{ replaced: true }` for override hooks.

**Module-host subprocess flavor — *not* recommended for hooks.** Reserved for the existing 3p module system; hooks don't need the heavyweight vscode-jsonrpc framing because they're short-lived and project-private. Hook framing is plain JSON-line over stdio. (We DO inherit the module-host's process-group orphan prevention so a hook crash doesn't leave watchman or Metro orphaned.)

### 6.5 Failure semantics

Each hook entry in the config can declare:
- `onFail: 'hard' | 'warn' | 'retry'` (default depends on phase — see below)
- `retries: number` (default 0)

| Phase | Default `onFail` | Rationale |
| --- | --- | --- |
| `init` | `hard` | If init fails, the daemon shouldn't pretend it's healthy. |
| `preflightExtra` | `warn` | Mirrors built-in preflight cadence: surface, don't block (unless severity=error). |
| `onEnvironmentSelected` | `hard` | If Firebase swap fails, build will be wrong. |
| `preClean` / `postClean` | `warn` | Cleaning is best-effort. |
| `customClean` | `hard` | If the override fails, we shouldn't silently fall back. |
| `preInstall` / `postInstall` | `hard` | Bad codegen output ⇒ broken types. |
| `preMetroStart` / `postMetroStart` | `warn` | Probes can fail without stopping Metro. |
| `preBuild` | `hard` | |
| `customBuild` | `hard` | |
| `postBuild` | `warn` | Side effects only. |
| `onLaunch` | `warn` | |
| `onShutdown` | `warn` | |

A hard failure surfaces in the same `note` UI as a build error and in the audit log; a warn failure goes to `serviceBus.log` and the modules panel's status icon turns yellow. Retries use exponential backoff (1 s, 2 s, 4 s, …), capped at 30 s.

### 6.6 Why not just use modules?

We considered making hooks a degenerate case of the module system. Reasons we landed on a separate config file:

1. **Discoverability for the consuming team.** A developer dropping into a kimoby-style repo today reads `bin/`. The equivalent for rn-dev-cli should be one file (`rn-dev.config.ts`) at the repo root, not "go install a module that lives elsewhere."
2. **Distribution.** Modules are npm packages with semver. Hooks are project artifacts that travel with the repo — they should be checked in next to `package.json` and reviewed in PRs. An npm package would feel wrong.
3. **Activation cost.** Modules use vscode-jsonrpc + a long-lived subprocess. Hooks are short-lived and parallelizable; a 100 ms `bin/check-token.sh` shouldn't pay framing overhead.
4. **Permission model.** Modules go through a consent dialog. Hooks run with the same privileges as the developer's terminal already has — the developer authored them.

That said, the **machinery** is shared: the module-host's process-group spawning, audit logging, and capability registry all back the hook runner. Hooks are just "modules with a fixed manifest, project-scoped, no MCP surface."

### 6.7 What goes in the audit log for hooks

Each hook invocation: `{ phase, configPath, scriptOrSymbol, durationMs, exitCode }`. Hook stdout/stderr are NOT audited (volume) but the build log captures them for replay.

---

## 7. Concrete next-session candidates

Numbered, sized for one session each. LOC estimates assume tests included.

1. **Add staleness detector with mode-escalation prompt.** Files: new `src/core/staleness.ts`, extend `src/core/types.ts` Artifact, update `src/app/start-flow.ts` and `src/app/auto-build.ts` to consult it, add MCP tool `staleness/check`. ~300 LOC. Depends on: nothing.

2. **`.env` block-switching plumbing + MCP tools.** Files: new `src/core/env-switcher.ts`, extend Profile + Artifact (`lastEnvHash`), MCP tools `env/list` / `env/activate` / `env/active`, wizard step. ~400 LOC. Depends on: nothing. Pairs naturally with #1 (env staleness becomes another input to the escalation).

3. **Build-error summarizer + condensed renderer output.** Files: `src/core/build-parser.ts` add `summarizeErrors`, dedupe by `file:line`, use it in the Builder `done` payload + MCP tool response. Tests cover the dedupe + cap. ~150 LOC. Depends on: nothing.

4. **Wire preflight auto-fix loop into wizard + auto-build path.** Files: `src/cli/commands.ts`, `src/app/start-flow.ts`, MCP tool `preflight/fix`, renderer + TUI prompt UI for `Attempt to fix?`. ~250 LOC. Depends on: existing PreflightEngine.

5. **`rn-dev.config.ts` loader skeleton + first hook (`preBuild`).** Files: new `packages/config/` with `defineConfig` + JSON schema, daemon-side loader `src/core/hooks/manager.ts`, single `preBuild` invocation point. ~500 LOC. Depends on: nothing — but is the gating piece for #6, #7, #11 below.

6. **Hook phases for `customClean` + `customBuild` (override semantics).** Files: extend `src/core/hooks/manager.ts`, plumb `replaced: true` flag, integrate with `CleanManager` and `Builder`. ~350 LOC. Depends on: #5.

7. **`onEnvironmentSelected` hook + Firebase-config-swap example doc.** Files: extend `src/core/hooks/manager.ts`, wire from env-switcher, ship a sample script in `examples/` showing the kimoby-style swap. ~150 LOC + docs. Depends on: #2 + #5.

8. **Worktree device pool config + collision detection.** Files: new `rn-dev.devices.json` schema, extend `src/core/device.ts` with `acquireSlot`/`releaseSlot`/`findSlotOwner`, AVD-from-template `ensureAndroidAvd`, collision check in auto-build. ~500 LOC. Depends on: nothing — but lifts `bin/worktree` semantics.

9. **Branch-deterministic port allocator (opt-in).** Files: extend `src/core/metro.ts` with `derivePort(branch)`, add `Profile.portStrategy`, expose via MCP `metro/derive-port`. ~100 LOC. Depends on: nothing.

10. **Hardlink artifact bootstrap on worktree create.** Files: new `src/core/worktree-bootstrap.ts`, dep-match check, `cp -al` (with Windows fallback to `mklink`), MCP tool `worktree/bootstrap`. ~250 LOC. Depends on: nothing — but high payoff once we ship a `worktree/create` MCP tool.

---

## Final notes

The kimoby tool is a single-repo, human-only CLI built by a small team for a single product. rn-dev-cli is a general-purpose, agent-native, multi-surface platform. We will never want to copy kimoby's code, but the **opinions** in kimoby's CLI — the staleness escalation, the Firebase swap, the device pool, the multipanel layout, the "tips file" as encoded tribal knowledge — are all signals about what RN dev teams actually need from their build tool. Section 6's hook config is the joinpoint: kimoby's `bin/` becomes our `rn-dev.config.ts` + scripts, and rn-dev-cli stops being a layer below kimoby's tool and starts being the thing kimoby's tool is implemented in.
