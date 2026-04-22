---
title: CDP proxy + DomainTap pattern
tags: [devtools, cdp, architecture, pattern]
date: 2026-04-21
status: accepted
---

# CDP proxy + DomainTap pattern

Institutional writeup of the Chrome DevTools Protocol (CDP) proxy
architecture that powers the DevTools Network module. Purpose: the next
author adding a CDP-backed subtool (Console, Performance, React Profiler,
…) should be able to pattern-match against this and ship purely additive
code.

## Problem

Modern React Native (Hermes + Fusebox since RN 0.76) deliberately moved
runtime observability — network, console, timings — out of Metro stdout
and into the Chrome DevTools debugger. Humans benefit (rich Fusebox UI);
our CLI's agent surface does not (nothing to read).

Three surfaces need the same raw data:

1. **Electron:** Fusebox must keep working, byte-transparent.
2. **Terminal (Ink):** live table of requests the user can watch.
3. **MCP:** agent-callable tools returning structured snapshots.

Two approaches were rejected early:

- **Second CDP client alongside Fusebox.** Hermes is single-client;
  attaching another client kicks Fusebox or silently drops events.
- **fetch/XHR shim injected into the RN app.** Invasive; misses native
  HTTP; doesn't generalize to Console/Performance.

## Pattern — transparent CDP proxy + domain taps

We interpose a WebSocket proxy between Fusebox (downstream) and
Metro's `/inspector/debug` endpoint (upstream). Fusebox's URL is
rewritten to point at the proxy; the proxy forwards frames
byte-transparently and hands a parsed clone of each event to a registry
of `DomainTap` instances.

```
 Fusebox webview  ──ws──►  CdpProxy  ──ws──►  Metro /inspector/debug  ──►  Hermes
                              │
                              ▼
                       DomainTap registry
                         ├─ NetworkTap  ─► RingBuffer<NetworkEntry>
                         ├─ ConsoleTap (future)
                         └─ PerformanceTap (future)
                              │
                              ▼ coalesced 100ms delta
                       ┌──────┴───────┐
                       │              │
                   ServiceBus     IPC push       (MCP polls on demand)
                       │              │
                   Ink module   Electron renderer
```

## Invariants the proxy must preserve

The proxy is transparent, not smart. Getting this right is what keeps
Fusebox happy:

1. **Frames forwarded in arrival order.** No `await` between receive and
   forward on the wire path. If you buffer for parsing, do it on a
   clone.
2. **Raw payloads forwarded untouched.** JSON parsing happens on a
   copy for the tap dispatch path only — never on the bytes we forward.
3. **Command `id` namespacing.** Proxy-originated commands use
   ids ≥ `1_000_000_000`. Their responses are matched internally and
   **not** re-emitted downstream. Fusebox's own ids are forwarded as
   they arrive.
4. **Upstream close → downstream close code 1012 (service restart).**
   Fusebox will re-initialize its domains on reconnect, preventing the
   stale-breakpoint bug.
5. **Loopback bind + 128-bit nonce path.** Hard-bind `127.0.0.1`;
   WS path is `/proxy/<nonce>`. Cross-process local access requires the
   nonce.

These live in [`src/core/devtools/proxy.ts`](../../src/core/devtools/proxy.ts).
If a future tap tempts you to change any of them, stop — it means the tap
is layering incorrectly.

## DomainTap — the extension seam

```ts
export interface DomainTap<TEntry> extends AnyDomainTap {
  readonly domain: string;              // "Network", "Console", …
  readonly enableCommands: readonly CdpCommand[];
  readonly ring: RingBuffer<TEntry>;
  attach(dispatch: TapDispatch): void;
  detach(): void;
  handleEvent(evt: CdpEvent): void;
}
```

`DevToolsManager` owns an array of `AnyDomainTap` per worktree. On
`start()` it:

1. Invokes every registered `TapFactory` with `DevToolsOpts`.
2. Connects upstream via the proxy.
3. Iterates taps: `tap.attach(dispatch)`, then sends each
   `tap.enableCommands[]` entry with proxy-namespaced ids.
4. On every incoming CDP event, dispatches to taps whose `domain`
   matches the event's method prefix (`Network.` → NetworkTap,
   `Console.` → ConsoleTap, …).
5. On session boundary (metro restart, target swap, clear), iterates
   every tap's ring and bumps epoch.

Registering a new tap is one call:

```ts
manager.registerTap((opts) => new ConsoleTap(opts));
```

There is a pre-Phase-3 test
([`devtools.tap-seam.test.ts`](../../src/core/__tests__/devtools.tap-seam.test.ts))
whose sole purpose is to prove a second tap can be added **without
modifying `proxy.ts` or the manager's lifecycle code**. Run it before
starting work on a new subtool. If it fails after your changes, you've
leaked a domain assumption into the core — fix that before shipping.

## Three-surface contract (must hold across subtools)

The value of the pattern is that Electron, Ink, and MCP stay lossless
clones of the same ring:

| Capability                   | Electron | Ink       | MCP                               |
| ---------------------------- | -------- | --------- | --------------------------------- |
| List captured entries        | Fusebox  | Ink table | `<domain>-list` (opt-in)          |
| Drill into one entry         | Fusebox  | `Enter`   | `<domain>-get`                    |
| Clear buffer                 | (UI)     | `C`       | `devtools-clear`                  |
| Switch CDP target            | dropdown | `T`       | `devtools-select-target`          |
| Proxy status / RN version    | banner   | banner    | `devtools-status` (always on)     |

The MCP surface MUST:

- Be opt-in via a `--enable-<domain>-mcp` flag (S4).
- Redact bodies/payloads by default, require a second
  `--mcp-capture-<field>` flag to pass through (S5).
- Append a prompt-injection warning to every tool's description (S6).
- Emit a stderr banner on start when the flag is on (S7).

These controls live in [`src/mcp/tools.ts`](../../src/mcp/tools.ts) and
[`src/mcp/server.ts`](../../src/mcp/server.ts). The DTO conversion that
applies S5 lives in [`src/mcp/devtools-dto.ts`](../../src/mcp/devtools-dto.ts).

## Gotchas collected from shipping this

### Fusebox `ws=` URL format

The Fusebox frontend expects `ws=HOST:PORT/PATH` — without the `ws://`
scheme prefix. Fusebox prepends `ws://` itself. Passing a full URL
produces `ws://ws://...` and the WebSocket silently fails to open. The
Electron symptom is: "all Fusebox subtabs load, but Network shows no
data." See [`renderer/views/DevToolsView.tsx`](../../renderer/views/DevToolsView.tsx).

### eager vs lazy upstream open

`CdpProxy` accepts `eagerUpstream: true`. The DevToolsManager uses it —
the proxy opens upstream *before* Fusebox connects, guaranteeing taps
see `enable` responses and can start `Network.getResponseBody` fetches
immediately. Theoretically this risks missing the first few events
(before Fusebox subscribes). In practice live traffic shows up fine.
Don't flip to lazy without a concrete repro + a plan for the body
fetcher.

### Manager lifecycle on Metro retry

`DevToolsManager` subscribes to `metro.on('status')` at construction
time. Always call `manager.dispose()` before rebuilding `MetroManager`
(e.g. from a retry button) — otherwise the listener leaks and points at
a dead manager. See the `retryStep('metro')` branch in
[`electron/ipc-bridge.ts`](../../electron/ipc-bridge.ts).

### `/json` polling + preemption detection

The manager polls Metro `/json` every 10s (configurable via
`pollIntervalMs`) to discover new targets and detect Hermes reloads.
On unexpected upstream close, an immediate poll runs — if the target is
still listed, `proxyStatus` goes to `'preempted'` (another debugger
claimed it). If the target is gone, `proxyStatus` goes to
`'no-target'`. `'preempted'` is a stronger signal than `'no-target'`;
routine polling will not overwrite it.

### Single-client Hermes contention

Two worktrees pointing at the same physical device / simulator will
fight for the Hermes debugger. The losing side lands in `'preempted'`;
don't aggressively reconnect (you'll flap-kick your peer). v1 polls
passively and relies on the user to back off one side.

## Related reads

- Plan: [`docs/plans/2026-04-21-feat-agent-native-devtools-network-plan.md`](../plans/2026-04-21-feat-agent-native-devtools-network-plan.md)
- Phase 1 → 2 handoff: [`docs/plans/2026-04-21-devtools-phase1-handoff.md`](../plans/2026-04-21-devtools-phase1-handoff.md)
- Phase 2 → 3 handoff: [`docs/plans/2026-04-21-devtools-phase2-handoff.md`](../plans/2026-04-21-devtools-phase2-handoff.md)
- External: [CDP Network domain (tot)](https://chromedevtools.github.io/devtools-protocol/tot/Network/),
  [RN CDP status matrix](https://cdpstatus.reactnative.dev/devtools-protocol/1-2/Network),
  [@react-native/dev-middleware README](https://github.com/facebook/react-native/blob/main/packages/dev-middleware/README.md).
