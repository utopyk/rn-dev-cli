# DevTools Agent-Native — Phase 2 → Phase 3 Handoff

**Written:** 2026-04-21
**By:** Claude (Phase 2 session)
**For:** The next Claude (or human) continuing this feature

---

## Where we are

### Shipped (Phase 1 — headless core)

- Commit `854617a` — proxy + NetworkTap + DevToolsManager + 78 tests.
- Plan Phase 1 checkboxes all ticked.

### Shipped (Phase 2 — Electron integration)

- Commit `733719d` — Electron wiring + URL rewrite + target dropdown.
- Plan Phase 2 checkboxes all ticked.
- Branch: `feat/devtools-network-agent-native` (4 commits ahead of `main`).
- Open PR: <https://github.com/utopyk/rn-dev-cli/pull/1>
- Tests: **78/78 still green** under `npx vitest run`.
- Typecheck on touched files: clean.
- **Manually verified end-to-end:** Electron app → DevTools view → all Fusebox subtabs load (Console, Network, Debugger, Runtime). Live fetches from the running RN app show up in the Network panel.

### Files touched in Phase 2

| File | Change |
|------|--------|
| `src/core/devtools.ts` | Added `DevToolsManager.dispose()` — releases Metro status listener. |
| `electron/ipc-bridge.ts` | `InstanceState.devtools` + `devtoolsStarted`. Lazy-bound per-instance manager. 7 new IPC handlers under `devtools-network:*` namespace. Delta/status events pushed as `devtools-network:change` scoped by port. Teardown paths in `instances:remove` and `retryStep('metro')`. |
| `renderer/views/DevToolsView.tsx` | Full rewrite: calls `devtools-network:proxy-port` → `status`, rewrites Fusebox `ws=` param to proxy URL, target dropdown, `devtools-network:change` subscription. |
| `renderer/views/DevToolsView.css` | `.devtools-target-select` styles. |

---

## What's next — Phase 3 (Terminal + MCP + polish)

Per the plan's Phase 3 section. Three independent tracks share zero files and can go in one phase:

### Track A — Terminal (Ink)
- `src/modules/built-in/devtools-network.ts` — Ink module; table (method | status | URL | duration); keybinds `c` clear, `Enter` detail, `/` filter, `t` target.
- `src/modules/index.ts` — export.
- `src/app/service-bus.ts` — add `devtools` topic (see module-system brainstorm note below on namespacing).
- `src/app/AppContext.tsx` — subscribe to `liveDevTools.on('delta')` + `on('status')`; expose `networkEntries`, `devtoolsMeta`, `devtoolsTargets`.
- `src/app/start-flow.ts` — instantiate `DevToolsManager` after Metro; publish via `serviceBus.setDevTools(...)`.

### Track B — MCP
- `src/mcp/tools.ts` — register `rn-dev/devtools-status` unconditionally; register the other four tools only when `ctx.flags.enableDevtoolsMcp === true`. Each tool: `inputSchema` + `outputSchema`, `structuredContent` returned, `isError` on failures, description string ends with the S6 prompt-injection warning.
- `src/app/start-flow.ts` — register IPC actions `devtools/list`, `devtools/get`, `devtools/select-target`, `devtools/clear`, `devtools/status` for the MCP-over-IPC fallback.
- `src/mcp/server.ts` — parse `--enable-devtools-mcp` and `--mcp-capture-bodies` flags into `ctx.flags`; emit S7 stderr banner when enabled.
- `src/mcp/__tests__/tools.test.ts` — extend tool-count assertion; cover each new tool's success path + `isError` path + redaction-by-default.

### Track C — Polish / missing functional criteria
- **Preemption detection** — currently a TODO in `src/core/devtools.ts` `onUpstreamClose`. Needs `/json` re-poll after upstream close; if another `webSocketDebuggerUrl` is listed, set `proxyStatus: 'preempted'` with polite backoff.
- **`/json` re-polling** — the manager polls once on `start()`. Phase 3 should add periodic polling (e.g. 10s interval) to detect new targets / Hermes reloads without requiring the user to click Reconnect.
- **README** — module list entry; prominent security note on what `--enable-devtools-mcp` + `--mcp-capture-bodies` expose.
- **`docs/solutions/2026-XX-XX-cdp-proxy-pattern.md`** — DomainTap pattern writeup (learnings-researcher confirmed no institutional base yet).
- **Perf smoke test** — scripted 1000 req/min for 60s; assert memory under 400 MiB, zero forwarded-frame drops, delta emit cadence 10±2/s.

### Before Phase 3 code: validate the DomainTap seam

Scaffold a dummy second tap (e.g. a `ConsoleTap` stub that does nothing but registers) alongside `NetworkTap`. Goal: prove that registering a second tap requires **zero changes to `proxy.ts` / manager core**. If it doesn't — fix that architectural leak *before* building real Phase 3 tracks on top of it. This is cheap (20 min) and the plan's success metric depends on it.

---

## Critical context carried forward from Phase 2

### The URL rewrite gotcha (don't forget)

Fusebox / Chrome DevTools expect the `ws=` query param value to be **`HOST:PORT/PATH` without the `ws://` prefix**. The frontend prepends `ws://` itself. Passing a full `ws://...` URL produces `ws://ws://...` and the WebSocket silently fails to open — the Electron symptom was "all subtabs load but show no data". If you ever touch the URL construction again, this is the trap. Lives in `rewriteFuseboxUrl()` in `renderer/views/DevToolsView.tsx`.

### IPC namespace decision: `devtools-network:*`

Phase 2 uses `devtools-network:*` (not the `devtools:*` the original handoff suggested) to future-proof for the module-system brainstorm (`2026-04-21-module-system-and-device-control-brainstorm.md`), which frames `devtools-network` as one of several in-process built-in modules. Phase 3's MCP tool names are already `rn-dev/devtools-network-*`, so this matches. Future Console / Performance taps will get their own `devtools-console:*` etc. channels if needed.

### `eagerUpstream: true` — latent but benign in practice

`DevToolsManager.start()` hardcodes `eagerUpstream: true` so the proxy opens upstream before any Fusebox downstream connects. In theory this could cause Fusebox to miss initial `Network.*` events fired before it connects. In practice (Phase 2 manual test) live network activity showed up fine in the Network tab. Leave it alone unless a concrete repro appears. If it does bite: make `eagerUpstream` opt-in via `DevToolsOpts`, default to lazy for Electron.

### Lazy-bind trigger

The first `devtools-network:proxy-port` IPC call starts the manager. `ensureDevtoolsStarted()` in `electron/ipc-bridge.ts` is the idempotent entry point. Subsequent calls return the cached port/nonce via `manager.status()`.

### Manager lifecycle on Metro retry

`retryStep('metro')` now disposes the DevToolsManager **before** rebuilding MetroManager. If you add other places that rebuild Metro, remember to dispose DevTools first — the manager subscribes to `metro.on('status')` at construction time and needs the listener removed via `dispose()` to avoid a stale reference.

### Event scoping

`devtools-network:change` broadcasts to every renderer and includes `{ instanceId, port, kind, payload }`. The renderer filters on `port` since `DevToolsView` only knows its `metroPort` prop, not the instance id.

### `DomainTap` event filter

`DevToolsManager.handleCdpEvent` dispatches to NetworkTap only if `evt.method.startsWith('network.')` — the check is against `tap.domain`. For Console/Performance you'll need the manager to iterate over *all* registered taps and dispatch to each matching tap. Today there's only one tap so the code uses it directly. **This is exactly the seam the pre-Phase-3 dummy tap should exercise.**

### Test runner is still `npx vitest run`

The project's `bun test` script remains broken for vitest mocks (pre-existing on `main`). Do not try to fix it as part of Phase 3 — out of scope. Pre-existing failures in `clean.test.ts` / `preflight.test.ts` / `project.test.ts` are NOT ours; leave them alone.

### TypeScript baseline

There are ~154 pre-existing TS errors on the branch (mostly Ink component types in `src/ui/` and some Promise misuse in `src/mcp/tools.ts` / `src/cli/commands.ts`). They're unchanged by Phase 1+2. Don't attempt to clean them up alongside Phase 3 work.

---

## Module-system brainstorm context

The brainstorm `docs/brainstorms/2026-04-21-module-system-and-device-control-brainstorm.md` is parallel work, **not yet planned**. It frames `devtools-network` as one of the to-be-converted built-in modules under a future manifest-driven system. Phase 3 should:

- Keep DevTools cleanly namespaced (`devtools-network:*` IPC, `rn-dev/devtools-network-*` MCP tool ids) so a future extraction pass is mechanical.
- Not invent its own manifest shape — the module-system plan will.
- Treat service-bus topic naming as provisional; its generalization is a module-system concern.

---

## Useful commands

```bash
# Run devtools tests (use the broader glob — handoff-prompt glob missed devtools.test.ts)
npx vitest run src/core/__tests__/devtools src/mcp/__tests__/devtools-dto.test.ts

# Typecheck only our files
npx tsc --noEmit 2>&1 | grep -E "(electron/ipc-bridge|renderer/views/DevToolsView|src/core/devtools)"

# PR
gh pr view 1 --web

# Branch history
git log --oneline main..HEAD
```

---

## Prompt to start the next session

Paste this at the top of the next Claude session:

---

> I'm continuing work on the agent-native DevTools feature for the rn-dev-cli project (React Native developer CLI, greenfield TypeScript, Ink TUI + Electron + MCP).
>
> Phase 1 (headless core) and Phase 2 (Electron integration) are complete and open as PR #1 on `feat/devtools-network-agent-native`. Phase 2 has been **manually verified end-to-end**: Fusebox subtabs load, live Network activity shows up. I want to start **the pre-Phase-3 DomainTap seam validation**, then **Phase 3 (Terminal + MCP + polish)**.
>
> Before you do anything, please read these in order:
>
> 1. `docs/plans/2026-04-21-devtools-phase2-handoff.md` — this doc; Phase 2 → 3 handoff with all critical gotchas (especially the **Fusebox `ws=` URL gotcha** and the **`devtools-network:*` IPC namespace decision**)
> 2. `docs/plans/2026-04-21-feat-agent-native-devtools-network-plan.md` — the plan (see §Phase 3 specifically)
> 3. `docs/brainstorms/2026-04-21-module-system-and-device-control-brainstorm.md` — parallel brainstorm that frames `devtools-network` as a future built-in-module; informs namespacing decisions in Phase 3
> 4. `docs/plans/2026-04-21-devtools-phase1-handoff.md` — older handoff; mostly superseded but useful for earlier decisions
>
> Then:
> - Check I'm still on branch `feat/devtools-network-agent-native` (not `main`). If not, ask before switching.
> - Run `npx vitest run src/core/__tests__/devtools src/mcp/__tests__/devtools-dto.test.ts` and confirm 78 tests still pass.
> - **First task:** scaffold a dummy second `DomainTap` (e.g. a `ConsoleTap` stub that registers but captures nothing) alongside `NetworkTap`. Goal: prove zero changes needed in `proxy.ts` / `devtools.ts` core to add another tap. If this fails (the seam leaks), fix the architectural issue before anything else.
> - **Then:** tell me what Phase 3 order you propose (Track A Terminal / Track B MCP / Track C Polish) and wait for my OK before writing code. All three tracks are independent — my preference is probably MCP first (highest agent-native value), but call it out.
>
> Key rules carried forward (don't repeat mistakes):
> - Use `npx vitest run`, NOT `bun test` — the project's `bun test` script is broken for vitest mocks (pre-existing).
> - Pre-existing failures in `clean.test.ts`, `preflight.test.ts`, `project.test.ts` are NOT ours. Leave them alone.
> - ~154 pre-existing TS errors in unrelated files are NOT ours. Don't clean them up as part of Phase 3.
> - IPC channels stay `devtools-network:*` (future module-system namespacing).
> - MCP tool names stay `rn-dev/devtools-network-*` (matches plan).
> - The `ws=` URL must be `HOST:PORT/PATH` without `ws://` prefix — don't rebreak the URL rewrite.
> - `eagerUpstream: true` stays as-is; it's benign in practice per manual Phase 2 test.
> - S4/S5/S6/S7/S8/S9 security controls land in Phase 3 per the plan's security table.

---

## Open questions / flagged risks for Phase 3+

1. **Preemption detection** — real `/json` re-poll logic needs writing. Currently a TODO in `onUpstreamClose`. Plan calls it out; leave until Phase 3 Track C.
2. **`/json` periodic polling** — the manager polls once on `start()`. User currently has to click "Reconnect" in the Electron view to rediscover targets after the app launches late. Low priority for Phase 3 but worth adding alongside preemption detection since they share `/json` diffing.
3. **`electron/preload.ts` allowlist** — `contextBridge` exposes a generic `invoke` with no channel allowlist. Acceptable for now; security review may want tightening when the module-system lands.
4. **DomainTap dispatch loop** — `handleCdpEvent` currently hard-codes dispatch to `state.networkTap`. When Phase 3 adds a second tap, the dispatch needs to iterate a list. Tie this to the pre-Phase-3 scaffolding task.
5. **`bun test` runner** — still broken for vitest mocks. Not in Phase 3 scope but the team should resolve before the project grows a lot more test files.
