# Next-Session Prompt — Module System Phase 3d / Phase 4

**Paste the block below at the start of the next session.**

---

We're continuing the third-party module system for rn-dev-cli. PR [#2](https://github.com/utopyk/rn-dev-cli/pull/2) on `feat/module-system-phase-0` now contains **Phases 0, 0.5, 1, 2, 3a, 3b, 3c** — 17 commits, ~150 new tests, all shipped on 2026-04-22.

Before writing any code:

1. Read `docs/plans/2026-04-22-module-system-phase-3c-handoff.md` for the latest state — it lists everything deferred and what remains.
2. Skim the earlier per-phase handoffs only if you need to understand *why* a specific decision was made:
   - `docs/plans/2026-04-22-module-system-phase-1-handoff.md` (SDK + manifest schema + registry)
   - `docs/plans/2026-04-22-module-system-phase-2-handoff.md` (subprocess host — state machine, supervisor, lockfile, RPC, manager)
   - `docs/plans/2026-04-22-module-system-phase-3a-handoff.md` (tool-namespacer + daemon IPC for read-only module lifecycle)
   - `docs/plans/2026-04-22-module-system-phase-3b-handoff.md` (tools/call end-to-end + destructiveHint)
   - `docs/plans/2026-04-22-module-system-phase-3c-handoff.md` (enable/disable persistence)
3. Check the plan's Phase 4 section at `docs/plans/2026-04-21-feat-module-system-and-device-control-plan.md`.

### Branching

PR #2 is stacked high (6 phases). First question to Martin: **"Do you want to squash-merge PR #2 to main and start Phase 4 on a fresh branch, or keep stacking?"** The Phase 3c handoff suggests splitting, but that's his call.

```bash
gh pr view 2 --json state -q .state
```

- If `MERGED` already: `git checkout main && git pull && git checkout -b feat/module-system-phase-4`.
- If `OPEN`: default to continuing on `feat/module-system-phase-0`. If he wants a split, branch from the merge commit.

### Recommended Phase 3d (before Phase 4) — ~1 day

**Ship these two items first; they unblock Phase 4's Electron work.**

1. **`tools/listChanged` notification emission.**
   - Add a subscribe-style IPC action `modules/subscribe` that streams `{ kind: 'changed' }` events.
   - `ModuleHostManager` events (`crashed`, `failed`, new entry) trigger; `modules/enable` / `modules/disable` / `modules/restart` trigger.
   - In `src/mcp/server.ts`, subscribe at startup; on each event, call `server.sendNotification("notifications/tools/list_changed")` per the MCP spec.
   - Optional: re-snapshot the module tool list inside the server so subsequent `tools/list` returns fresh contributions.

2. **SDK `module-runtime.ts`.**
   - New file at `packages/module-sdk/src/module-runtime.ts`.
   - Export `runModule({ manifest, tools, activate?, deactivate? })` that wires `process.stdin` / `process.stdout` → `ModuleRpc` (reuse host's `src/core/module-host/rpc.ts` types; import or copy as needed), registers `initialize` (returns `{ moduleId, toolCount, sdkVersion }`), and routes `tool/<name>` → `tools[<moduleId>__<name>]`.
   - `ctx` passed to each tool handler should expose `{ log, appInfo, hostVersion, sdkVersion }`. `log` is a `Logger`-shape that sends `log` notifications to the host. `appInfo` comes from the `initialize` request params (capability list + hostVersion).
   - Replace the echo fixture's hand-rolled jsonrpc setup with `runModule(...)` to validate the DX.
   - No RPC-proxy for `metro`/`artifacts` yet — Phase 4+ tackles that.

### Phase 4 scope — Electron panel contributions (~3–5 days)

Deliberate pivot from the brainstorm's `<webview>` to `WebContentsView` (Electron 30+, 2026-recommended).

1. **`electron/panel-bridge.ts`** — host-side registry. Given a manifest with `contributes.electron.panels[]`, create a `WebContentsView` per panel with:
   - `partition: 'persist:mod-<id>'`
   - `preload: electron/preload-module.js` (single preload, receives `moduleId` + `hostApi[]` via query params)
   - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
   - Added to the main window's `contentView` tree, repositioned on renderer layout events.
   - Audit-log cross-module postMessage sends per Revision Log.

2. **`electron/preload-module.ts`** — per-module preload. `contextBridge.exposeInMainWorld('rnDev', ...)` exposing ONLY the methods the manifest's `hostApi[]` allowlist declared. Method calls route through `ModuleHostManager.<managed>.rpc.sendRequest("host/<method>", args)` — which requires…

3. **Daemon-side `host/*` RPC handlers** (on each managed module's `rpc`). Resolve via the capability registry with the module's granted permissions. This is the piece that makes `host.capability<T>(id)` actually do something; currently `HostApi` is type-only.

4. **`renderer/components/ModulePanel.tsx`** — generic `WebContentsView` embedder that resizes on layout changes and focuses on click.

5. **`renderer/App.tsx` refactor** — build view map from `invoke('modules:list')` instead of the hardcoded `ViewTab` switch. Remove the `ViewTab` union; `string` is fine.

6. **Security controls (Revision Log):**
   - `panel-bridge.ts` enforces no cross-module delivery.
   - Every cross-channel send audit-logged.
   - Matches the S1–S6 controls from the DevTools plan applied per-module.

### Do NOT do

- Marketplace / install flow / `@npmcli/arborist` — Phase 6.
- Device Control adapters — Phase 7+.
- Module signing (`manifest.signature`) — V2.
- Sandbox enforcement (`manifest.sandbox`) — V2.

### Permanent contract rules (unchanged — do not drift)

- `<moduleId>__<tool>` for 3p / flat for built-ins.
- SDK exports `host.capability<T>(id: string)` — not hardcoded names.
- Manifest at `rn-dev-module.json` at package root.
- Schema is additive-only within 1.x.
- `ModuleHostManager` lives in the daemon — Electron main + MCP server are clients.
- Per-module Electron partition `persist:mod-<id>` + dedicated preload.
- `destructiveHint: true` tools require confirmation (`--allow-destructive-tools` OR `permissionsAccepted[]`).

### Success criteria for Phase 3d + 4

**Phase 3d:**
- `tools/listChanged` fires within 100ms of `modules/enable` / `modules/disable`.
- Echo fixture rewritten using `runModule(...)` passes the existing `manager.integration.test.ts` suite (5+ tests) unchanged.
- `runModule()` has its own unit tests.

**Phase 4:**
- A fixture module declaring `contributes.electron.panels[]` renders an embedded `WebContentsView` in the GUI.
- `rnDev.<method>` calls from the panel reach the module subprocess over RPC.
- Panel resize + focus work.
- Manual playwright-electron smoke test (or `bun run dev:gui` manual check) confirms no regression to existing panels (Dev Space, Settings, Lint/Test, Metro Logs, DevTools Network).

### When done

Per phase:
1. Commit with Conventional Commits + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
2. Write `docs/plans/2026-04-??-module-system-phase-{3d,4}-handoff.md` matching the existing format.
3. Push; verify PR is clean.

Remember:
- `vitest run`, not `bun test`.
- `bun run build` for production bundle verification.
- tsc baseline is 154 errors (unchanged since Phase 0.5). Any new errors in your own code = red flag.
- 18 pre-existing test failures in `src/core/__tests__/{clean,preflight,project}.test.ts` — unrelated, chip tracked separately.
- `.claude/` is gitignored.

Total estimated effort for Phase 3d + Phase 4: 4–6 days.
