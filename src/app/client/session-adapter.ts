// Client-side Session adapter. The daemon publishes `session/log` and
// `session/status` over events/subscribe — these used to be silently
// dropped in `routeEventToAdapters`'s default arm because no client
// adapter consumed them, leaving the user/agent with no visibility into
// `bootSessionServices` progress (preflight, install, watchman setup,
// port-kill, simulator boot — every step the daemon emits as a
// `session/log` line at supervisor.ts:425).
//
// After Bug 6 fix: this adapter is published once per session by
// `connectToDaemonSession` and every client (MCP, Electron renderer,
// TUI) subscribes to its `log`/`status` events to surface daemon-side
// progress at its own UI/agent surface.
//
// No RPCs — sessions are managed via the existing `session/start` /
// `session/stop` actions on the raw `IpcSender`. This adapter is
// strictly an event dispatcher, parallel with metro/devtools/etc. but
// without the round-trip query API.

import { EventEmitter } from "node:events";
import type { AdapterSink, SessionEventKind } from "./adapter-sink.js";

export interface SessionLogEvent {
  /** "info" | "warn" | "error" — daemon-supplied, freeform string. */
  level: string;
  message: string;
}

export interface SessionStatusEvent {
  status: string;
}

export interface SessionClientEvents {
  log: (evt: SessionLogEvent) => void;
  status: (evt: SessionStatusEvent) => void;
  /** Fires once on unexpected daemon death (Phase 13.4 prereq #1). */
  disconnected: (err?: Error) => void;
}

/** Default cap on the in-memory log ring — see `SessionClient` doc. */
const DEFAULT_LOG_RING_SIZE = 200;

export class SessionClient
  extends EventEmitter
  implements AdapterSink<SessionEventKind>
{
  /**
   * In-memory ring buffer of recent `session/log` events, populated by
   * `dispatch()` and snapshot-readable via `recentLogs()`. The ring
   * exists because daemon-emitted boot progress fires DURING
   * `connectToDaemonSession` — between the `events/subscribe` ACK and
   * the `session/status: running` edge that resolves the await — so
   * any caller that adds an `on("log", ...)` listener AFTER
   * `connectToDaemonSession` returns races the events. Without the
   * ring those listeners would silently miss every boot-time log line
   * (which is exactly what an MCP server, an Electron renderer
   * subscribing post-connect, or a TUI would do).
   *
   * The fix is buffer-on-dispatch: every log event lands in the ring
   * regardless of whether anyone is subscribed yet. Late attachers
   * call `recentLogs()` to backfill before listening live.
   */
  private readonly logRing: SessionLogEvent[] = [];
  private readonly logRingSize: number;

  constructor(opts: { logRingSize?: number } = {}) {
    super();
    this.logRingSize = opts.logRingSize ?? DEFAULT_LOG_RING_SIZE;
  }

  dispatch(kind: SessionEventKind, data: unknown): void {
    if (kind === "session/log") {
      const evt = data as SessionLogEvent;
      this.logRing.push(evt);
      if (this.logRing.length > this.logRingSize) {
        this.logRing.shift();
      }
      this.emit("log", evt);
    } else {
      this.emit("status", data as SessionStatusEvent);
    }
  }

  /**
   * Snapshot of the in-memory log ring. Returned as a defensive copy
   * so callers iterating over the result during a subsequent dispatch
   * don't observe mid-mutation state.
   */
  recentLogs(): readonly SessionLogEvent[] {
    return this.logRing.slice();
  }

  notifyDisconnected(err?: Error): void {
    this.emit("disconnected", err);
  }
}
