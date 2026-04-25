// Per-connection registry of subscribe-socket capabilities.
//
// Phase 13.6 — under the multiplexed channel design (Lean D), a
// subscribe socket optionally accepts follow-up RPCs from the same
// connection. The opt-in is daemon-enforced via the
// `supportsBidirectionalRpc` field on the events/subscribe payload;
// without it, the daemon rejects any RPC arriving on that socket.
//
// Mirrors `SenderBindings`'s API shape. One instance per supervisor
// boot, cleared by `clearConnection(connectionId)` on socket close.

export interface SubscribeEntry {
  /** Whether the client declared `supportsBidirectionalRpc: true`. */
  readonly bidirectional: boolean;
  /**
   * Per-subscriber event-kind filter. `null` = all kinds (default).
   * Empty array = no events. Validated entries (each non-empty,
   * either exact `metro/log` or prefix `modules/*`).
   */
  readonly kindFilter: readonly string[] | null;
}

export class SubscribeRegistry {
  private entries = new Map<string, SubscribeEntry>();

  register(connectionId: string, entry: SubscribeEntry): void {
    this.entries.set(connectionId, entry);
  }

  has(connectionId: string): boolean {
    return this.entries.has(connectionId);
  }

  isBidirectional(connectionId: string): boolean {
    return this.entries.get(connectionId)?.bidirectional === true;
  }

  kindFilter(connectionId: string): readonly string[] | null {
    return this.entries.get(connectionId)?.kindFilter ?? null;
  }

  clearConnection(connectionId: string): void {
    this.entries.delete(connectionId);
  }
}
