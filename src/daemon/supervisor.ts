// Placeholder. Phase 13.2 drives the session/start|stop|status state
// machine from here, backed by the session model in ./session.ts.
// Phase 13.1 only needs the module to exist so the folder layout
// matches the spec.

import type { SessionState } from "./session.js";
import { INITIAL_SESSION_STATE } from "./session.js";

export class Supervisor {
  private state: SessionState = INITIAL_SESSION_STATE;

  getState(): SessionState {
    return this.state;
  }
}
