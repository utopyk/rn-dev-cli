// Per-daemon session model. Phase 13.2 grows this from a bare status
// placeholder into the full state machine the DaemonSupervisor drives.
//
// State transitions are strict:
//   stopped  -> starting        (session/start)
//   starting -> running|stopped (boot succeeded | boot failed)
//   running  -> stopping        (session/stop)
//   stopping -> stopped         (teardown complete)
// No other transitions are legal — the supervisor enforces them.

export type SessionStatus = "stopped" | "starting" | "running" | "stopping";

/** Minimal, serializable snapshot of per-service health. */
export interface ServicesSnapshot {
  metro: { status: string };
  devtools: { status: string };
  modules: { count: number };
}

export interface SessionState {
  readonly status: SessionStatus;
  /** Non-null only when `status === "running"`. */
  readonly services: ServicesSnapshot | null;
}

export const INITIAL_SESSION_STATE: SessionState = Object.freeze({
  status: "stopped",
  services: null,
}) as SessionState;

/**
 * Tagged-union envelope for events/subscribe streaming. Clients filter on
 * `kind`. `worktreeKey` lets a future multi-session daemon disambiguate
 * when one subscriber watches multiple sessions.
 */
export interface SessionEvent {
  kind:
    | "session/status"
    | "metro/status"
    | "metro/log"
    | "devtools/status"
    | "modules/state-changed"
    | "modules/crashed"
    | "modules/failed"
    | "session/log";
  worktreeKey: string;
  data: Record<string, unknown>;
}
