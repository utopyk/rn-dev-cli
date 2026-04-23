/**
 * Per-worktree ring buffer for Metro stdout/stderr. Subscribed to by the
 * host at `startServicesAsync` time — each `log` event from `MetroManager`
 * lands here as a numbered entry, and each `status` event that flips a
 * worktree back to `running` bumps the epoch (Metro restarted → old
 * cursors stale).
 *
 * The `metro-logs` host capability (see `./host-capability.ts`) wraps a
 * single store instance; the module subprocess calls it over
 * `vscode-jsonrpc` `host/call` with its declared worktree.
 */

import type {
  MetroLogLine,
  MetroLogsCursor,
  MetroLogsFilter,
  MetroLogsListResult,
  MetroLogsMeta,
  MetroLogsStatus,
  MetroLogStream,
  ProcessStatus,
} from "./types.js";

/**
 * Max entries a single `list()` call may return — clamps `filter.limit`.
 * Matches the capacity of the devtools network ring so agents get a
 * consistent "page" size regardless of surface.
 */
export const MAX_LIST_LIMIT = 1000;

/** Default per-worktree ring capacity. Tunable via constructor options. */
export const DEFAULT_BUFFER_CAPACITY = 2000;

interface WorktreeRing {
  capacity: number;
  // Held as a plain array; `entries.length <= capacity`. When full, the
  // oldest entry is dropped. The sequence counter runs independently.
  entries: MetroLogLine[];
  bufferEpoch: number;
  totalLinesReceived: number;
  evictedCount: number;
  nextSequence: number;
  metroStatus: ProcessStatus;
}

export interface MetroLogsStoreOptions {
  /** Per-worktree ring capacity. Defaults to `DEFAULT_BUFFER_CAPACITY`. */
  capacity?: number;
}

export class MetroLogsStore {
  private readonly rings = new Map<string, WorktreeRing>();
  private readonly capacity: number;

  constructor(options: MetroLogsStoreOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_BUFFER_CAPACITY;
  }

  /** Append a log line for `worktreeKey`. Allocates a ring on first touch. */
  append(worktreeKey: string, stream: MetroLogStream, line: string, at: number = Date.now()): MetroLogLine {
    const ring = this.ensureRing(worktreeKey);
    const entry: MetroLogLine = {
      sequence: ring.nextSequence++,
      at,
      stream,
      line,
    };
    ring.entries.push(entry);
    ring.totalLinesReceived++;
    if (ring.entries.length > ring.capacity) {
      ring.entries.shift();
      ring.evictedCount++;
    }
    return entry;
  }

  /**
   * Bump the epoch for `worktreeKey`, drop all held lines. Called on:
   *   - explicit `capability.clear()` from the module
   *   - Metro status transition from non-running → `running` (restart)
   */
  clear(worktreeKey: string): MetroLogsMeta {
    const ring = this.ensureRing(worktreeKey);
    ring.entries = [];
    ring.bufferEpoch++;
    // Sequence counter intentionally NOT reset. Sequences are globally
    // monotonic per worktree — an agent that was watching sequence 500
    // sees its cursor go stale via the epoch bump, and the next emitted
    // line is 501 (not 0). Cleaner than colliding sequences across clears.
    return this.metaFor(ring, worktreeKey);
  }

  /**
   * Report the last-known Metro lifecycle status. Used by the capability's
   * `status()` surface so agents can tell "buffer empty because Metro not
   * running" from "buffer empty because nothing logged yet".
   *
   * A transition **from** any non-`running` status **to** `running` bumps
   * the epoch automatically — Metro restart invalidates cursor continuity.
   */
  setMetroStatus(worktreeKey: string, status: ProcessStatus): void {
    const ring = this.ensureRing(worktreeKey);
    const wasRunning = ring.metroStatus === "running";
    ring.metroStatus = status;
    if (!wasRunning && status === "running" && ring.entries.length > 0) {
      // New session starting, but we still hold lines from the previous
      // one — drop them and bump so cursors don't straddle restarts.
      ring.entries = [];
      ring.bufferEpoch++;
    }
  }

  list(worktreeKey: string, filter?: MetroLogsFilter): MetroLogsListResult {
    const ring = this.ensureRing(worktreeKey);
    const since = filter?.since;
    const cursorDropped =
      since !== undefined && since.bufferEpoch !== ring.bufferEpoch;

    let pool: readonly MetroLogLine[] = ring.entries;
    if (since !== undefined && !cursorDropped) {
      pool = pool.filter((e) => e.sequence > since.sequence);
    }
    if (filter?.stream) {
      pool = pool.filter((e) => e.stream === filter.stream);
    }
    if (filter?.substring) {
      const needle = filter.substring;
      pool = pool.filter((e) => e.line.includes(needle));
    }
    const limit = clampLimit(filter?.limit);
    const entries = pool.slice(-limit);
    return {
      entries,
      cursorDropped,
      meta: this.metaFor(ring, worktreeKey),
    };
  }

  status(worktreeKey: string): MetroLogsStatus {
    const ring = this.ensureRing(worktreeKey);
    return {
      meta: this.metaFor(ring, worktreeKey),
      bufferSize: ring.entries.length,
      bufferCapacity: ring.capacity,
    };
  }

  /** Test/debug accessor — current retained count without filtering. */
  size(worktreeKey: string): number {
    return this.rings.get(worktreeKey)?.entries.length ?? 0;
  }

  private ensureRing(worktreeKey: string): WorktreeRing {
    let ring = this.rings.get(worktreeKey);
    if (!ring) {
      ring = {
        capacity: this.capacity,
        entries: [],
        bufferEpoch: 1,
        totalLinesReceived: 0,
        evictedCount: 0,
        nextSequence: 1,
        metroStatus: "idle",
      };
      this.rings.set(worktreeKey, ring);
    }
    return ring;
  }

  private metaFor(ring: WorktreeRing, worktreeKey: string): MetroLogsMeta {
    const oldest = ring.entries[0]?.sequence ?? 0;
    const last = ring.entries[ring.entries.length - 1]?.sequence ?? 0;
    return {
      worktreeKey,
      bufferEpoch: ring.bufferEpoch,
      oldestSequence: oldest,
      lastEventSequence: last,
      totalLinesReceived: ring.totalLinesReceived,
      evictedCount: ring.evictedCount,
      metroStatus: ring.metroStatus,
    };
  }
}

function clampLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    return MAX_LIST_LIMIT;
  }
  return Math.min(raw, MAX_LIST_LIMIT);
}

export type { MetroLogsCursor };
