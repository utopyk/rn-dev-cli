import { describe, it, expect } from "vitest";
import { createRingBuffer } from "../devtools/domain-tap.js";

interface Row {
  readonly id: string;
  readonly sequence: number;
  readonly version: number;
  readonly payload: string;
}

function newRing(capacity = 3) {
  return createRingBuffer<Row>(capacity);
}

function append(ring: ReturnType<typeof newRing>, id: string, payload: string) {
  return ring.upsert(id, (_prev, sequence, version) => ({
    id,
    sequence,
    version,
    payload,
  }));
}

describe("RingBuffer", () => {
  it("appends entries in order and assigns monotonic sequences", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    append(ring, "c", "v1");
    const snap = ring.snapshot();
    expect(snap.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(snap.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(ring.state.lastEventSequence).toBe(3);
    expect(ring.state.oldestSequence).toBe(1);
  });

  it("upsert replaces in place, keeps sequence, bumps version", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    const updated = ring.upsert("a", (prev, sequence, version) => ({
      id: "a",
      sequence,
      version,
      payload: (prev?.payload ?? "") + "+v2",
    }));
    expect(updated.version).toBe(2);
    expect(updated.sequence).toBe(1);
    expect(updated.payload).toBe("v1+v2");
    expect(ring.get("a")).toBe(updated);
    expect(ring.snapshot().entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("evicts FIFO at capacity, increments evictedCount", () => {
    const ring = newRing(2);
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    append(ring, "c", "v1");
    expect(ring.snapshot().entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(ring.state.evictedCount).toBe(1);
    expect(ring.state.oldestSequence).toBe(2);
  });

  it("FIFO eviction does NOT bump bufferEpoch", () => {
    const ring = newRing(2);
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    const epochBefore = ring.state.bufferEpoch;
    append(ring, "c", "v1");
    expect(ring.state.bufferEpoch).toBe(epochBefore);
    expect(ring.state.sessionBoundary).toBeNull();
  });

  it("clear() empties + bumps epoch with reason 'clear'", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    const epochBefore = ring.state.bufferEpoch;
    ring.clear();
    expect(ring.snapshot().entries).toEqual([]);
    expect(ring.state.bufferEpoch).toBe(epochBefore + 1);
    expect(ring.state.lastEventSequence).toBe(0);
    expect(ring.state.evictedCount).toBe(0);
    expect(ring.state.sessionBoundary?.reason).toBe("clear");
    expect(ring.state.sessionBoundary?.previousEpoch).toBe(epochBefore);
  });

  it("markSessionBoundary bumps epoch with given reason", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    ring.markSessionBoundary("target-swap");
    expect(ring.state.sessionBoundary?.reason).toBe("target-swap");
    expect(ring.snapshot().entries).toEqual([]);
  });

  it("snapshot with sinceSequence filters correctly", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    append(ring, "b", "v1");
    append(ring, "c", "v1");
    const snap = ring.snapshot({ sinceSequence: 1 });
    expect(snap.entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(snap.cursorDropped).toBe(false);
  });

  it("snapshot flags cursorDropped when cursor fell below oldestSequence", () => {
    const ring = newRing(2);
    append(ring, "a", "v1"); // seq 1
    append(ring, "b", "v1"); // seq 2
    append(ring, "c", "v1"); // seq 3 — evicts a, oldestSequence = 2
    const snap = ring.snapshot({ sinceSequence: 0 });
    expect(snap.cursorDropped).toBe(true);
    expect(snap.entries.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("snapshot returns frozen entry list", () => {
    const ring = newRing();
    append(ring, "a", "v1");
    const { entries } = ring.snapshot();
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it("incTapDropped / incBodyTruncated update state", () => {
    const ring = newRing();
    ring.incTapDropped();
    ring.incTapDropped(3);
    ring.incBodyTruncated(2);
    expect(ring.state.tapDroppedCount).toBe(4);
    expect(ring.state.bodyTruncatedCount).toBe(2);
  });

  it("throws on invalid capacity", () => {
    expect(() => createRingBuffer<Row>(0)).toThrow(/capacity must be/);
  });
});
