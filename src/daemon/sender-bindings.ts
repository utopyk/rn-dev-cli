// Per-connection module-binding table. Phase 13.5 — tightens the
// authorization story for `modules/host-call`. Pre-13.5, `hostCall`
// trusted the `moduleId` field on the wire because there was at most
// one client connected to a daemon at a time, and that client was
// presumed honest. With Phase 13.5 multi-client coexistence (TUI +
// Electron + MCP), a same-UID compromised module subprocess inside
// the daemon can talk on the socket too — and absent a binding gate,
// it could impersonate any other module's host-call by passing that
// module's id in the payload.
//
// The fix: each connection must call `modules/bind-sender { moduleId }`
// to register the moduleIds it's authorized to act on behalf of.
// Subsequent `modules/host-call`s gate `payload.moduleId` against
// the connection's allowed set. Socket-close clears the entry.
//
// Threat model alignment: this is a defense-in-depth measure. The
// existing socket 0o600 + UID gate is the load-bearing security
// boundary; binding lookup adds a second gate so a same-UID
// compromised module can't laterally hop into another module's
// capability surface even without breaking the socket perimeter.
//
// Idempotency: bind() is a Set.add — re-binding the same (connId,
// moduleId) is a no-op. clearConnection() is idempotent on unknown
// connection ids.

export class SenderBindings {
  private readonly table = new Map<string, Set<string>>();

  /**
   * Authorize `connectionId` to act on behalf of `moduleId` on
   * subsequent `modules/host-call` requests. Idempotent.
   */
  bind(connectionId: string, moduleId: string): void {
    let set = this.table.get(connectionId);
    if (!set) {
      set = new Set();
      this.table.set(connectionId, set);
    }
    set.add(moduleId);
  }

  /**
   * Returns true iff `connectionId` has been bound to `moduleId` via
   * a prior `bind()` call. The default — no binding — is "deny."
   */
  canCall(connectionId: string, moduleId: string): boolean {
    return this.table.get(connectionId)?.has(moduleId) ?? false;
  }

  /**
   * Drop every binding held by this connection. Called from the
   * daemon's per-socket onClose hook so a closed connection's
   * authorizations don't survive into a future connection that
   * happens to inherit the same connection id (which never happens
   * given the monotonic counter, but the defensive scrub costs
   * nothing).
   */
  clearConnection(connectionId: string): void {
    this.table.delete(connectionId);
  }

  /** Test-only: total number of bindings across all connections. */
  size(): number {
    let n = 0;
    for (const set of this.table.values()) n += set.size;
    return n;
  }

  /** Test-only: the set of moduleIds bound to a connection. */
  boundModules(connectionId: string): ReadonlySet<string> {
    return this.table.get(connectionId) ?? new Set();
  }
}
