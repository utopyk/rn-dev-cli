# Module System Phase 11 — Metro Logs 3p extraction — Handoff

**Branch:** `feat/module-system-phase-11-metro-logs`
**Target:** `main` (stacks on Phase 10's squash-merge `6c87500`)
**Scope:** Second built-in → 3p migration. Mirrors Phase 9 devtools-
network, with every Phase 10 lesson applied up-front. Bundles the
three Phase 10 deferred items that naturally surfaced during the work.

---

## Summary

`@rn-dev-modules/metro-logs` lands as the second 3p module. The old
built-in was TUI-only with no MCP tools — the extraction therefore
required building the full host-side infrastructure (ring buffer, host
capability, granular permissions) in addition to the module package
itself. Every Phase 11 scope follow-up from the queued prompt shipped.

| # | Item | Status |
|---|------|--------|
| Core 1 | `modules/metro-logs/` with manifest + src + tests + panel | done |
| Core 2 | Fixture registry entry + local tarball | done |
| Core 3 | Built-in `src/modules/built-in/metro-logs.ts` removed | done |
| Core 4 | Legacy `rn-dev/metro-logs` MCP tool retired | done |
| Lesson 5 | Granular permissions (`metro:logs:read` + `:mutate`) | done |
| Lesson 6 | `rn-dev/modules-available` surfaces metro-logs | done |
| Lesson 7 | S6 warning on every tool + prefix in SENSITIVE list | done |
| Lesson 8 | Entry gate via `import.meta.url` + `pathToFileURL` | done |
| Lesson 9 | Strict module tsc wired into `bun run typecheck` | done |
| Lesson 10 | Audit parity (install / uninstall / host/call / config-set) | inherited |
| Deferred 11 | `PERMISSION_ALIASES` → `capabilities.ts` | done |
| Deferred 12 | `modules-available` payload shape guard | done |
| Deferred 13 | `canonicalize` → `src/core/canonicalize.ts` | done |

### Stats

- 1 commit, 41 files changed, +2,081 / −278 lines
- 1 new host capability (`metro-logs`)
- 1 new module package (`@rn-dev-modules/metro-logs`)
- 3 new MCP tools: `metro-logs__status`, `metro-logs__list`,
  `metro-logs__clear` (surfaced via the module subprocess, not the
  base tool list)
- 1 MCP tool retired: `rn-dev/metro-logs` (disk-scraping legacy)
- 2 new granular permissions: `metro:logs:read`, `metro:logs:mutate`
- 1 file relocation: `canonicalize` / `AuditCanonicalizationError` →
  `src/core/canonicalize.ts`; `_canonicalizeForTests` re-export dropped
- 1 security-policy relocation: `PERMISSION_ALIASES` +
  `expandPermissionAliases` → `capabilities.ts`

---

## Baselines (all preserved or improved)

- **vitest:** 843 / 0 failed (was 812 before this branch; +31)
- **root tsc `--noEmit`:** 150 errors (unchanged baseline — all
  pre-existing wizard / LogViewer / Modal / AppContext code)
- **electron tsc:** 0 errors
- **device-control tsc:** 0 errors
- **devtools-network tsc:** 0 errors
- **metro-logs tsc:** 0 errors (NEW — included in `bun run typecheck`
  + `bun run typecheck:modules`)
- **`bun run build`:** green
- **`rn-dev/modules-available`:** regression test asserts the
  metro-logs entry surfaces via the stubbed marketplace payload

---

## Per-task details

### Core 1 — module package

`modules/metro-logs/` has the same shape as devtools-network:

```
modules/metro-logs/
├── build.ts              # Bun.build → dist/index.js
├── package.json          # @rn-dev-modules/metro-logs@0.1.0
├── rn-dev-module.json    # manifest — 3 tools, 1 panel, 1 config schema
├── tsconfig.json         # strict; mirrors the other two modules
├── panel/                # Electron panel — DOM builders, no innerHTML
│   ├── index.html
│   └── panel.js
└── src/
    ├── index.ts          # subprocess entry + arg narrowers
    ├── tools.ts          # handlers — status / list / clear
    ├── host-capability.ts # local mirror of the host interface
    ├── types.ts          # local mirror of MetroLog* types
    └── __tests__/
        ├── parity.test.ts   # host ↔ module type equivalence
        └── tools.test.ts    # handler dispatch + extractFilter guards
```

Manifest declares permissions `["metro:logs:read", "metro:logs:mutate"]`.
The host sees them at install consent; `loadSingleManifest()` lints
them against `KNOWN_PERMISSIONS` (now including both); the S6-warning
gate (Phase 10 P2-12) enforces the canonical sentence on all three
tool descriptions because `metro:logs` is on
`SENSITIVE_PERMISSION_PREFIXES`.

### Core 2 — host capability infrastructure

`src/core/metro-logs/` is new:

- **`buffer.ts` — `MetroLogsStore`**. Per-worktree ring buffer
  (default capacity 2000/worktree). Monotonic `sequence` counter that
  does NOT reset on `clear()` — sequences are globally ordered per
  worktree. `bufferEpoch` bumps on `clear()` and on Metro restart
  (status transition from non-`running` to `running` with lines held);
  held cursors go stale cleanly. `MAX_LIST_LIMIT = 1000` clamps rogue
  `filter.limit` values.
- **`host-capability.ts` — `createMetroLogsHostCapability`**. Surface
  `status()` / `list()` / `clear()`, each routing through a worktree-
  key validator. Unknown worktrees silently redirect to the default,
  preventing a `metro:logs:read` grant from peeking at another
  worktree's buffer (same pattern as Phase 9 devtools).
- **`types.ts` — wire shapes**. Mirrored in the module package so
  `parity.test.ts` catches drift.

`start-flow.ts` wires Metro's event emitters into the store before
`metro.start()`, so the very first log line lands in the ring. Status
events are normalized through a `known` map — a misspelled emit can't
keep a dead buffer flagged `running`.

### Core 3 / Core 4 — built-in + legacy removal

- `src/modules/built-in/metro-logs.ts` deleted.
- `metroLogsManifest` removed from `src/modules/built-in/manifests.ts`.
- All six registration / test sites updated (start-flow, create-module-
  system, modules/index, built-in-registration test, marketplace test,
  create-module-system test, electron/modules-list test, electron
  module-system-bootstrap test).
- Built-in count dropped from 4 → 3 (dev-space, lint-test, settings).
  Marketplace still adds one for a registered total of 4.
- `rn-dev/metro-logs` MCP tool (read `.rn-dev/logs/*.log` from disk)
  retired. Tool count 31 → 30. Test's expected-names list updated.
  Handler comment documents the rationale so future archaeologists
  find the migration.

### Lesson 5 — granular permissions from day one

Split `metro:logs:read` (status / list) and `metro:logs:mutate` (clear)
from the start. Both in `KNOWN_PERMISSIONS`; `METRO_LOGS_METHOD_PERMISSIONS`
is the Phase 10 P2-7 per-method override map. A read-only grant can't
drop the buffer; a mutate grant is advertised explicitly in the
install-consent dialog. No legacy umbrella needed — the module ships
fresh.

### Lesson 6 — modules-available regression

Added a targeted test in `src/mcp/__tests__/tools.test.ts`:

> Surfaces a metro-logs entry (Phase 11 agent-native discoverability
> regression)

Seeds a stubbed marketplace payload containing a metro-logs entry and
asserts the handler filters + projects it correctly. Runs on every
`vitest run` — if a future refactor swallows the entry, the test fails.

### Lesson 7 — S6 warning on every tool

Every tool description in `rn-dev-module.json` includes the canonical
sentence shape the Phase 10 P2-A regex demands. Added `metro:logs` to
`SENSITIVE_PERMISSION_PREFIXES` so `assertSensitiveToolWarnings()`
enforces the lint on future contributions. The S7 startup banner's
wording was widened from "traffic and device capture" to "untrusted
external content (network traffic, device output, Metro log lines)"
so the new prefix doesn't ship a misleading banner.

### Lesson 8 — entry gate

`modules/metro-logs/src/index.ts` uses:

```ts
const invokedAsEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
```

No regex on argv[1]. Works under any hoisted layout.

### Lesson 9 — strict module tsc

`modules/metro-logs/tsconfig.json` mirrors the other two:
`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`.
`bun run typecheck` chains all four tsc projects; `bun run
typecheck:modules` runs only the three modules. Both green.

### Lesson 10 — audit parity

No new audit code needed. The existing `host-call` audit path in
`host-rpc.ts` records every `host/call` route, which covers the three
new tools automatically. Install / uninstall / config-set remain
inside `AuditLog` — unchanged. Verified by running the
`src/app/__tests__/modules-ipc.test.ts` suite (27 tests, all green).

### Deferred 11 — PERMISSION_ALIASES relocation

`PERMISSION_ALIASES` + `expandPermissionAliases` +
`resetPermissionAliasWarningsForTests` moved from `host-rpc.ts` to
`capabilities.ts`. The alias table is security policy (which strings
expand to which granular perms), not transport (JSON-RPC framing) —
it belongs next to `KNOWN_PERMISSIONS`, not in the RPC layer.
Zero external importers, so the move is invisible to consumers.
`host-rpc.ts` now imports `expandPermissionAliases` from
`capabilities.js`.

### Deferred 12 — modules-available payload guards

New `toAvailableEntry()` helper + `ModulesAvailableEntry` interface in
`src/mcp/tools.ts`. Every entry projected out of `marketplace/list`
now goes through a full shape guard:

- `id` required non-empty string
- `description` required string
- `installed` required boolean
- `permissions` required `string[]` (non-string elements drop entire
  entry)
- Optional fields validated per type, omitted when wrong

Bad entries drop entirely rather than leaking undefined fields to MCP
consumers. New test: "drops entries that fail the shape guard".

### Deferred 13 — canonicalize extraction

`canonicalize` + `AuditCanonicalizationError` moved to
`src/core/canonicalize.ts` as a pure helper. No audit-log coupling.
`audit-log.ts` imports + re-exports the error type so downstream
importers don't break. Tests import `canonicalize` directly — the
`_canonicalizeForTests` re-export smell is gone.

---

## Deferred / Out of Scope (Phase 12+)

From the Phase 11 next-session prompt's "Do NOT do" list:

- **Shared `@rn-dev/module-sdk-devtools` types package.** Still waiting
  on a third `devtools-*` module.
- **Electron bootstrap parity with `registerHostCapabilities`**
  (Architecture P1 from Phase 10) — TUI-only helper today; still its
  own PR.
- **Runtime-derived `KNOWN_PERMISSIONS`** — no third capability family
  yet.
- **`keepData` retention + GC sweep.** Still its own PR.
- **Publishing to real npm** + production
  `EXPECTED_MODULES_JSON_SHA256`. Separate ops task.
- **Detached Ed25519 signature verification of `modules.json`.**

One new follow-up discovered during Phase 11:

- **Unify the three modules' `build.ts` scripts.** All three are
  near-identical Bun.build invocations. A 3-line workspace script
  template would avoid drift when a fourth module lands. Trigger is
  "fourth module" — premature to pull out now.

---

## Review focus

Four parallel reviewers (Kieran TS, Architecture, Security,
Simplicity). Focus areas per reviewer:

- **Security**: the `metro-logs` capability never reads disk — all
  data is in-memory. But confirm `setMetroStatus` can't be tricked
  into a stale-ring leak via malformed status events (the `known` map
  should catch this, worth double-checking). Also confirm
  `metro:logs:mutate` is the only mutating surface — no disk writes,
  no external calls.
- **Architecture**: the new `src/core/metro-logs/` module — is the
  tri-file split (types / buffer / host-capability) the right seam,
  or should it collapse into one file like
  `src/core/devtools/host-capability.ts`? Also the
  `MetroLogsStore.setMetroStatus` epoch-bump-on-restart behavior —
  is "empty ring + already-running" the right guard?
- **Kieran TS**: the module's `parity.test.ts` uses bidirectional
  `expectTypeOf` (no unique-symbol cursor to worry about, unlike
  devtools). Is this stricter or looser than Phase 9's one-way check?
  Also the `toAvailableEntry` guard — could it be code-generated
  from the JSON Schema instead of hand-written?
- **Simplicity**: `MetroLogsStore` is ~170 lines — is the
  `WorktreeRing` interface worth the indirection, or does it just
  hide a `Map<string, ArrayBuilder>`? Also the panel's dual
  polling-mode (visibilitychange + interval) — is it simpler to let
  the browser stall polling when hidden?
