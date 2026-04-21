/**
 * Domain-agnostic tap + ring buffer primitives.
 *
 * A `DomainTap<T>` is the seam that lets DevToolsManager support multiple CDP
 * domains (Network first, Console/Performance later) without touching the
 * proxy or manager code. Each tap declares its enable-commands, owns its own
 * `RingBuffer<T>`, and receives every CDP event the proxy sees.
 *
 * `RingBuffer<T>` is a FIFO + Map dual-structure: O(1) lookup by id (for
 * upsert), O(1) append with FIFO eviction. Entries are immutable from the
 * outside — upsert builds a new entry with incremented `version`.
 */

import type { SessionBoundary } from "./types.js";

// ---------------------------------------------------------------------------
// CDP message shapes
// ---------------------------------------------------------------------------

export interface CdpCommand {
  method: string;
  params?: Record<string, unknown>;
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
}

export interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// TapDispatch — the proxy's outward API to a tap
// ---------------------------------------------------------------------------

export interface TapDispatch {
  /**
   * Send a CDP command upstream, resolve with the typed response. Proxy
   * assigns ids from its reserved range (>= 1_000_000_000) and dispatches
   * the matching response back. Rejects on upstream close or timeout.
   */
  sendCommand(cmd: CdpCommand, timeoutMs?: number): Promise<CdpResponse>;
}

// ---------------------------------------------------------------------------
// DomainTap
// ---------------------------------------------------------------------------

export interface DomainTap<TEntry> {
  /** Stable name, used for logging and event dispatch (Network → "Network"). */
  readonly domain: string;
  /** Sent once on every upstream attach. */
  readonly enableCommands: readonly CdpCommand[];
  /** Public buffer. Manager composes `CaptureMeta` from its state. */
  readonly ring: RingBuffer<TEntry>;
  /** Called after upstream attach + enable commands flushed. */
  attach(dispatch: TapDispatch): void;
  /** Called on upstream close / manager stop. Tap should cancel pending work. */
  detach(): void;
  /** Called for every CDP event the proxy receives. Tap filters by method. */
  handleEvent(evt: CdpEvent): void;
}

// ---------------------------------------------------------------------------
// RingBuffer state (exposed read-only for meta composition)
// ---------------------------------------------------------------------------

export interface RingBufferState {
  /** Incremented by `clear()` and `markSessionBoundary()`. */
  bufferEpoch: number;
  /** Lowest sequence still resident, or `lastEventSequence + 1` if empty. */
  oldestSequence: number;
  /** Monotonic within an epoch. Reset to 0 on epoch bump. */
  lastEventSequence: number;
  /** FIFO evictions since epoch start. */
  evictedCount: number;
  /** Tap backpressure drops. Tap-specific semantics (body queue overflow). */
  tapDroppedCount: number;
  /** Body-cap truncations. */
  bodyTruncatedCount: number;
  sessionBoundary: SessionBoundary | null;
}

// ---------------------------------------------------------------------------
// RingBuffer<T>
// ---------------------------------------------------------------------------

export interface RingSnapshot<T> {
  entries: readonly T[];
  cursorDropped: boolean;
}

export interface RingBuffer<T> {
  /**
   * Upsert by identity key. The factory receives the previous entry (if any)
   * plus a freshly assigned sequence number (only on first insert — reused
   * on replacement) and a version number (bumped on each call).
   */
  upsert(
    id: string,
    factory: (prev: T | undefined, sequence: number, version: number) => T
  ): T;

  get(id: string): T | undefined;

  /**
   * Return a frozen shallow clone of the entries.
   *
   * If `sinceSequence` is provided and it is below the current `oldestSequence`,
   * `cursorDropped` is `true` and entries are returned starting from
   * `oldestSequence`. Otherwise entries with `sequence > sinceSequence` are
   * returned.
   */
  snapshot(opts?: { sinceSequence?: number }): RingSnapshot<T>;

  /** Clear the buffer and bump epoch with `reason: 'clear'`. */
  clear(): void;

  /** Bump epoch with a given reason. Does NOT empty the buffer. */
  markSessionBoundary(reason: SessionBoundary["reason"]): void;

  /** Increment tap-dropped counter. */
  incTapDropped(n?: number): void;

  /** Increment body-truncated counter. */
  incBodyTruncated(n?: number): void;

  readonly state: Readonly<RingBufferState>;
  readonly capacity: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface RingEntry<T> {
  id: string;
  sequence: number;
  version: number;
  value: T;
}

export function createRingBuffer<T>(
  capacity: number,
  options: { getSequence?: (value: T) => number } = {}
): RingBuffer<T> {
  if (capacity < 1) throw new Error("RingBuffer capacity must be >= 1");

  let entries: RingEntry<T>[] = [];
  const byId = new Map<string, RingEntry<T>>();

  const state: RingBufferState = {
    bufferEpoch: 1,
    oldestSequence: 1, // when empty, oldestSequence == lastEventSequence + 1
    lastEventSequence: 0,
    evictedCount: 0,
    tapDroppedCount: 0,
    bodyTruncatedCount: 0,
    sessionBoundary: null,
  };

  function resetCounters(reason: SessionBoundary["reason"]): void {
    const previousEpoch = state.bufferEpoch;
    state.bufferEpoch += 1;
    state.lastEventSequence = 0;
    state.oldestSequence = 1;
    state.evictedCount = 0;
    state.tapDroppedCount = 0;
    state.bodyTruncatedCount = 0;
    state.sessionBoundary = {
      previousEpoch,
      reason,
      at: Date.now(),
    };
  }

  function upsert(
    id: string,
    factory: (prev: T | undefined, sequence: number, version: number) => T
  ): T {
    const existing = byId.get(id);
    if (existing) {
      existing.version += 1;
      existing.value = factory(existing.value, existing.sequence, existing.version);
      return existing.value;
    }
    state.lastEventSequence += 1;
    const sequence = state.lastEventSequence;
    const fresh: RingEntry<T> = {
      id,
      sequence,
      version: 1,
      value: factory(undefined, sequence, 1),
    };
    entries.push(fresh);
    byId.set(id, fresh);

    if (entries.length > capacity) {
      const evicted = entries.shift();
      if (evicted) {
        byId.delete(evicted.id);
        state.evictedCount += 1;
      }
      state.oldestSequence = entries.length > 0 ? entries[0]!.sequence : sequence + 1;
    } else if (entries.length === 1) {
      state.oldestSequence = sequence;
    }

    return fresh.value;
  }

  function get(id: string): T | undefined {
    return byId.get(id)?.value;
  }

  function snapshot(opts?: { sinceSequence?: number }): RingSnapshot<T> {
    const since = opts?.sinceSequence;
    if (since == null) {
      return { entries: Object.freeze(entries.map((e) => e.value)), cursorDropped: false };
    }
    const cursorDropped = since < state.oldestSequence - 1;
    const filtered = entries.filter((e) => e.sequence > since).map((e) => e.value);
    return { entries: Object.freeze(filtered), cursorDropped };
  }

  function clear(): void {
    entries = [];
    byId.clear();
    resetCounters("clear");
    // `sequence` used internally for determining snapshot ordering — it's moot
    // once entries is empty. oldestSequence already reset to 1.
  }

  function markSessionBoundary(reason: SessionBoundary["reason"]): void {
    entries = [];
    byId.clear();
    resetCounters(reason);
  }

  function incTapDropped(n = 1): void {
    state.tapDroppedCount += n;
  }

  function incBodyTruncated(n = 1): void {
    state.bodyTruncatedCount += n;
  }

  // We mark getSequence as intentionally unused — reserved for future domains
  // that want to reorder by a non-insertion sequence. Network uses insertion.
  void options.getSequence;

  return {
    upsert,
    get,
    snapshot,
    clear,
    markSessionBoundary,
    incTapDropped,
    incBodyTruncated,
    get state() {
      return state;
    },
    capacity,
  };
}
