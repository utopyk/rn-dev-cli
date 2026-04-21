# DevTools as the Agent-Native Playground

**Date:** 2026-04-21
**Status:** Brainstorm — not yet planned

## What We're Building

Turn the DevTools module from an Electron-only Fusebox embed into the **first truly agent-native module** in the CLI. The agent should be able to inspect the output of DevTools subtools — starting with Network — and reason about what's happening in the running RN app.

Scope for the first pass:

- **Subtool:** Network only (Console, Performance, Elements follow once the foundation is proven).
- **Agent-facing capabilities:** read-on-demand, query/filter. Streaming is out of scope for MVP.
- **Parity across three surfaces:** structured MCP tools for agents, text-digest view in the terminal module, existing Fusebox webview for humans in Electron.
- **Data:** metadata + headers + text request/response bodies up to a size cap. Binary bodies captured as metadata only (MIME + size + URL).
- **Retention:** in-memory ring buffer, bounded by count and/or bytes, resets with Metro.
- **Redaction:** none in MVP — captured data is raw. Redaction ships with the separate Settings auto-discovery brainstorm.

Explicitly **out of scope for this pass:**

- Correlation with other signals (Metro logs, crashes, repo code). Agents can correlate on their own by calling multiple tools — we just expose network cleanly.
- Streaming / subscriptions.
- React DevTools protocol (separate transport).
- JSC / legacy remote debugger support — Hermes + Fusebox only.
- Redaction of sensitive fields (deferred — see Resolved Questions).

## Why This Approach

The current DevTools module is an Electron webview embedding React Native's `rn_fusebox.html`. The entire debugger payload — Network, Console, Performance — flows CDP-over-WebSocket directly between Fusebox and the Hermes inspector (via Metro's `/inspector/debug` proxy). Our process sees **none of it**. No structured data exists outside the webview.

Modern RN (Hermes default) deliberately moved runtime data — console.log, fetch traces — out of Metro's terminal and into the debugger. That means: without a capture layer, **there is no way for an agent to see what's happening in the app**, even though a human developer can. This gap is the whole point of the project.

**Chosen approach: CDP proxy.** We interpose between Fusebox and Metro's CDP endpoint. Fusebox connects to our local proxy port; we own the single upstream connection to Metro/Hermes; we fan out events to both the webview (unchanged human UX) and an internal capture buffer. Commands from the webview forward upstream transparently.

Rejected alternatives:

- **Attach a second CDP client alongside Fusebox.** Hermes historically allows one debugger client. Silently drops events or kicks the webview. Unacceptable regression risk.
- **Inject a fetch/XHR wrapper into the RN app.** Invasive (user code changes or Babel transform), misses native-level HTTP, doesn't generalize to Console or Performance. Dead end.

The proxy is the architectural investment that pays off across *every* future subtool, because every modern DevTools subtool speaks CDP.

## Assumptions

- **Fusebox is redirectable to our proxy port.** Today `renderer/views/DevToolsView.tsx` gets the debugger URL from Metro's `/json` response (`webSocketDebuggerUrl`). We'll rewrite that URL to point at our proxy. If for any reason the URL can't be rewritten in-process, the approach needs revisiting.
- **Hermes' CDP `Network` domain is available** in the RN versions we target. The proxy assumes we can enable and receive `Network.*` events. If a user's RN version lacks this, the module surfaces an empty capture — degrade gracefully, don't crash.
- **The proxy is faithfully transparent to Fusebox.** Any divergence from upstream behavior is a bug, not a feature.

## Key Decisions

1. **First subtool = Network.** Highest agent value, clearest text representation, most common debugging need.
2. **Capture depth = metadata + headers + text bodies up to a size cap; binary bodies as metadata only** (MIME + size + URL, bytes dropped).
3. **Retention = in-memory ring buffer.** Bounded, resets with Metro. Matches existing `metro-logs` pattern.
4. **Terminal parity for Network = strict text parity.** Recent requests listed as a table (method, status, URL, duration). Visual-only panels (flame charts, element trees) that arrive in later passes will accept lossy text-summary parity — noted here but not designed.
5. **Agent correlation is the agent's job.** We expose clean, queryable network data; the agent calls other tools (Metro logs, file reads, etc.) to synthesize. No special "correlate" tool.
6. **Shared core module.** `src/core/devtools.ts` owned per Metro instance, mirroring `MetroManager`. All three surfaces call into it — no surface reimplements logic.
7. **Redaction and module-scoped configuration deferred.** The Settings auto-discovery pattern and the redaction UX both move to a separate brainstorm. MVP captures and exposes raw data.

## Resolved Questions

- **Binary body handling** → metadata only (MIME + size + URL), drop bytes. Binaries are rarely useful for agent reasoning and bloat the buffer.
- **Settings module-config pattern** → out of scope here. Gets its own brainstorm since it's cross-cutting across every module.
- **Redaction in MVP** → deferred. Ships with the Settings auto-discovery brainstorm. MVP exposes raw data.

## Open Questions (defer to planning)

All WHAT-level decisions are resolved. These are HOW-level questions captured so they aren't lost when planning starts:

- Ring buffer sizing defaults (count vs bytes; per-domain limits) and how users override.
- Proxy port selection (fixed vs dynamic vs Metro-derived) and how Fusebox is redirected to it.
- Naming for the MCP tool family: `devtools/network-list`, `devtools/network-get`, etc. Match the existing `rn-dev/*` convention or introduce a subnamespace.
- Lifecycle: when Metro restarts or the inspector target disappears, how the proxy reconnects and whether the ring buffer persists across target switches.

## Success Criteria

- A developer can ask an agent "why is the login failing?" and the agent can call an MCP tool to see the 401 response, its headers, and the response body — without asking the developer to copy anything.
- The terminal module lists recent requests with method, status, URL, duration — enough to spot an outlier without leaving the terminal.
- The Electron Fusebox webview experience is unchanged for human users. Nothing regresses.
- Adding the next subtool (Console) is purely additive: the proxy, ring buffer, snapshot-API, and three-surface wiring patterns are reused without redesign.
