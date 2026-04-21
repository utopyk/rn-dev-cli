# DevTools Agent-Native — Phase 1 → Phase 2 Handoff

**Written:** 2026-04-21
**By:** Claude (prior session)
**For:** The next Claude (or human) continuing this feature

---

## Where we are

### Shipped (Phase 1 — headless core)

- Open PR: **https://github.com/utopyk/rn-dev-cli/pull/1**
- Branch: `feat/devtools-network-agent-native` (branched from `main`)
- 2 commits on the branch:
  1. `feat(devtools): Phase 1 — core CDP proxy, NetworkTap, DevToolsManager` (`854617a`)
  2. `docs: mark Phase 1 acceptance criteria complete in plan` (`0c6aaad`)
- `main` has the brainstorm + plan committed (`8349d13`).
- Tests: **78 new tests pass** under `npx vitest run`.
- TypeScript: `npx tsc --noEmit 2>&1 | grep src/core/devtools` returns nothing (clean).

### Origin documents

- Brainstorm: `docs/brainstorms/2026-04-21-devtools-agent-native-brainstorm.md`
- Plan: `docs/plans/2026-04-21-feat-agent-native-devtools-network-plan.md` (see Phase 1 checkboxes — all done; Phase 2 & 3 — untouched)

---

## Files already written (Phase 1)

Core — read these before touching anything:

| File | Purpose |
|------|---------|
| `src/core/devtools.ts` | `DevToolsManager` orchestrator. State machine, per-worktree Map, MetroManager subscription, delta timer. |
| `src/core/devtools/types.ts` | All shared types. Discriminated unions. `DevToolsOpts`, `DEFAULTS`, `TargetDescriptor`, `DevToolsStatus`. |
| `src/core/devtools/proxy.ts` | `CdpProxy` — bidirectional WS, loopback bind, nonce, `sendCommand` with proxy-namespaced ids, `eagerUpstream` option, `connectUpstream()`. |
| `src/core/devtools/domain-tap.ts` | `DomainTap<T>` interface + `createRingBuffer<T>()`. |
| `src/core/devtools/network-tap.ts` | `NetworkTap` class — the only registered tap. Includes `BodyFetcher` worker. |
| `src/core/devtools/redact.ts` | Header deny-list redactor. |
| `src/mcp/devtools-dto.ts` | `toDto`, `toListDto`, S5 redaction, hand-rolled JSON Schema objects (unused until Phase 3 tool registration). |

Tests (under `src/core/__tests__/` and `src/mcp/__tests__/`):
- `devtools.redact.test.ts` (27)
- `devtools.ring-buffer.test.ts` (11)
- `devtools.network-tap.test.ts` (12)
- `devtools.proxy.test.ts` (10) — **the transparency invariant lives here**
- `devtools.test.ts` (11) — manager integration
- `devtools-dto.test.ts` (7)

---

## What's next — Phase 2 (Electron integration)

Per the plan's Phase 2 section:

### Files to modify

**`electron/ipc-bridge.ts`**
- Replace the existing `ipcMain.handle('devtools:getTargets', ...)` handler at **lines 490-507** with delegation to `DevToolsManager.listTargets`.
- Add new handlers:
  - `devtools:proxy-port` — returns `{ proxyPort, sessionNonce }` for the current active instance (for the URL rewrite).
  - `devtools:network-list` — filter param; calls `manager.listNetwork`. Returns the full `CaptureListResult<NetworkEntry>` (no DTO redaction — Electron is on-device and sees bodies).
  - `devtools:network-get` — single entry by requestId.
  - `devtools:select-target` — `{ targetId }`, delegates.
  - `devtools:clear` — clears the ring.
  - `devtools:status` — returns full `DevToolsStatus`.
- Instantiate `DevToolsManager` in `InstanceState` (**line ~30** — that's where `MetroManager` lives). Construct per instance: `new DevToolsManager(metro, {})`. Wire its `'delta'` and `'status'` events through IPC push to the renderer (channel name: `devtools:change`).
- Call `devtoolsManager.start(worktreeKey)` **lazily** — only when the DevTools view is first opened, not on instance creation. This is the "lazy-bind" from the plan.

**`renderer/views/DevToolsView.tsx`**
- The URL rewrite is the Key Assumption from the brainstorm. See the plan's Fusebox URL Rewrite section.
- Current code at lines 35-48 picks either `target.devtoolsFrontendUrl` (primary) or constructs a URL with `ws=${encodeURIComponent(wsPath)}`.
- Insert a step: before `setDevtoolsUrl(url)`, call `window.rndev.invoke('devtools:proxy-port')` to get `{ proxyPort, sessionNonce }`. Parse the chosen URL; replace its `ws=` query parameter with `ws://127.0.0.1:${proxyPort}/proxy/${sessionNonce}`; re-encode.
- Add a target dropdown if `status.targets.length > 1`. Invokes `devtools:select-target`.
- **Do NOT add a raw-JSON side panel** — simplicity review killed it.

### Phase 2 success criteria

- Fusebox Network / Debugger / Console / Runtime tabs behave identically with vs without the proxy interposed (the transparency test already proves the proxy forwards correctly; this just wires the human path to use it).
- No regression in existing DevTools UX.
- Proxy starts lazily on first DevTools tab open.

### Things not in Phase 2 (leave for Phase 3)

- Ink terminal module
- MCP tool registration
- `--enable-devtools-mcp` flag / `--mcp-capture-bodies` flag
- Preemption detection (TODO comment is in `src/core/devtools.ts` `onUpstreamClose`)
- README security section

---

## Critical context (easy to miss)

### Test runner weirdness

`package.json` has `"test": "bun test"` but Bun's test runner is **broken** for this project — `vi.mock(..., async (importOriginal) => ...)` fails because Bun doesn't pass `importOriginal`. This is pre-existing; even `src/core/__tests__/metro.test.ts` fails under `bun test`.

**Use `npx vitest run` for all test operations in this feature.** My PR description notes this; users/reviewers should be informed.

### Pre-existing test failures — NOT ours

`src/core/__tests__/clean.test.ts`, `preflight.test.ts`, `project.test.ts` — these fail on `main` and continue to fail on the feature branch. They are NOT regressions from this PR. Don't try to fix them in Phase 2; they're out of scope.

### `bun test` vs `vitest` runner

Some tests are collected from `.claude/worktrees/*` — ignore those. Scope runs to `src/`.

### Manager lifecycle caveat

`DevToolsManager.start(worktreeKey)` uses `eagerUpstream: true` internally. That's fine for headless AND for Electron — upstream opens before Fusebox connects, which means `sendCommand` works from the moment the tap is attached. Don't switch to lazy upstream without rethinking; the `BodyFetcher` depends on `sendCommand` being ready from `loadingFinished`.

### `eagerUpstream` — subtlety

In `CdpProxy`, `eagerUpstream: true` means `start()` waits for upstream to open. If the upstream URL is unreachable, `start()` rejects. The manager catches this by pre-fetching `/json` and only starting the proxy if a target exists. If no target, it creates a proxy **without** `eagerUpstream` that sits in `proxyStatus: 'no-target'` until... actually right now nothing re-polls `/json`. Phase 2 should consider adding a periodic `/json` poll for target discovery.

### Security controls — where each one is

| Control | Status | Location |
|---------|--------|----------|
| S1 header redaction | ✅ shipped | `src/core/devtools/redact.ts`, called from `NetworkTap` |
| S2 loopback bind | ✅ shipped | `CdpProxy.start` uses `host: "127.0.0.1"` |
| S3 128-bit nonce | ✅ shipped | `CdpProxy.start` uses `randomBytes(16).toString("hex")` |
| S4 MCP opt-in flag | ⏳ Phase 3 | Needs `--enable-devtools-mcp` in `src/mcp/server.ts` |
| S5 MCP body redaction | ✅ scaffolded | `toDto` already redacts by default; flag wiring in Phase 3 |
| S6 prompt-injection warning | ⏳ Phase 3 | Tool `description` strings in `src/mcp/tools.ts` |
| S7 warn-on-start banner | ⏳ Phase 3 | stderr print in `src/mcp/server.ts` |
| S8 origin check | ⏳ Phase 3 | `CdpProxy` already has `allowedOrigins` option — just needs to be passed `['file://', 'devtools://', '']` from Electron |
| S9 URL denylist | ⏳ Phase 3 | New config; capture-time filter in `NetworkTap` |

### DomainTap seam — verify it holds before Phase 3

The plan claims "Console subtool is purely additive." The code doesn't have a second tap yet. Before Phase 3 lands, **scaffold a dummy tap** (e.g. `ConsoleTap` stub that does nothing) and register it alongside NetworkTap to prove the seam actually works without touching `proxy.ts`. If registering a second tap requires code changes in proxy/manager, fix that architectural leak immediately.

### Existing `devtools:getTargets` handler

`electron/ipc-bridge.ts` lines 490-507 — used by the current `renderer/views/DevToolsView.tsx`. When you replace it with the manager-delegation version, make sure the renderer's `getTargets()` call still works (same shape returned: array of target objects with `webSocketDebuggerUrl`).

---

## Useful commands

```bash
# Run the new devtools tests
npx vitest run src/core/__tests__/devtools.*.test.ts src/mcp/__tests__/devtools-dto.test.ts

# Typecheck just the new code
npx tsc --noEmit 2>&1 | grep -E "src/(core/devtools|mcp/devtools)"

# Check PR status
gh pr view 1 --web

# Look at recent git history
git log --oneline main..HEAD
```

---

## Prompt to start the next session

Paste this when starting the next Claude session:

---

> I'm continuing work on the agent-native DevTools feature for the rn-dev-cli project (React Native developer CLI, greenfield TypeScript, Ink TUI + Electron + MCP).
>
> Phase 1 (headless core) is complete and open as PR #1 on `feat/devtools-network-agent-native`. I want to start **Phase 2 (Electron integration)** now.
>
> Before you do anything, please read these in order:
>
> 1. `docs/plans/2026-04-21-devtools-phase1-handoff.md` — session handoff with critical context and Phase 2 scope
> 2. `docs/plans/2026-04-21-feat-agent-native-devtools-network-plan.md` — the plan (see §Phase 2 specifically)
> 3. `docs/brainstorms/2026-04-21-devtools-agent-native-brainstorm.md` — the origin brainstorm
>
> Then:
> - Check I'm still on branch `feat/devtools-network-agent-native` (not `main`). If not, ask before switching.
> - Run `npx vitest run src/core/__tests__/devtools.*.test.ts src/mcp/__tests__/devtools-dto.test.ts` and confirm 78 tests still pass.
> - Tell me what you're about to build, what order, and flag any assumptions you're about to make. Wait for my OK before writing code.
>
> Key rules from last session (don't repeat mistakes):
> - Use `npx vitest run` not `bun test` — the project's `bun test` script is broken for vitest mocks (pre-existing).
> - Pre-existing failures in `clean.test.ts`, `preflight.test.ts`, `project.test.ts` are NOT ours. Leave them alone.
> - Do NOT add a raw-JSON side panel to the Electron DevTools view — simplicity review killed it.
> - The URL rewrite is the critical move in Phase 2. Get it right and everything else falls out.
> - Before Phase 3, scaffold a dummy second tap to prove the `DomainTap` seam really is additive.

---

## Open questions / flagged risks for Phase 2+

1. `/json` re-polling — manager currently polls once on `start()`. Should it poll periodically to detect new targets / Hermes reloads? Low priority for Phase 2 but decide before Phase 3.
2. Preemption detection — TODO comment in `onUpstreamClose`. Plan says it's a Phase 2/3 acceptance criterion. Real implementation needs `/json` diff between sessions.
3. Electron's `contextBridge` in `electron/preload.ts` exposes a generic `invoke` — no allowlist. Good for now, but Phase 3 security review may want one.
4. `devtools:change` event channel — decide whether it pushes the full delta or just a "something changed" tick that the renderer then queries. Per plan §Delta Event Emission, the delta `{ addedIds, updatedIds, evictedIds, meta }` should be pushed.
