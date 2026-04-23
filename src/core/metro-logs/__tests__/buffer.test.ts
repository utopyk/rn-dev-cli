import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUFFER_CAPACITY,
  MAX_LIST_LIMIT,
  MetroLogsStore,
} from "../buffer.js";

const WK = "w1";

describe("MetroLogsStore — append + list", () => {
  it("returns empty state for a fresh worktree", () => {
    const store = new MetroLogsStore();
    const status = store.status(WK);
    expect(status.bufferSize).toBe(0);
    expect(status.bufferCapacity).toBe(DEFAULT_BUFFER_CAPACITY);
    expect(status.meta.bufferEpoch).toBe(1);
    expect(status.meta.oldestSequence).toBe(0);
    expect(status.meta.lastEventSequence).toBe(0);
    expect(status.meta.metroStatus).toBe("idle");
  });

  it("assigns monotonic sequences starting at 1", () => {
    const store = new MetroLogsStore();
    const a = store.append(WK, "stdout", "alpha");
    const b = store.append(WK, "stderr", "beta");
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    const { entries, meta } = store.list(WK);
    expect(entries.map((e) => e.line)).toEqual(["alpha", "beta"]);
    expect(meta.lastEventSequence).toBe(2);
    expect(meta.oldestSequence).toBe(1);
    expect(meta.totalLinesReceived).toBe(2);
  });

  it("evicts oldest lines once capacity is exceeded", () => {
    const store = new MetroLogsStore({ capacity: 3 });
    for (const line of ["a", "b", "c", "d", "e"]) {
      store.append(WK, "stdout", line);
    }
    const { entries, meta } = store.list(WK);
    expect(entries.map((e) => e.line)).toEqual(["c", "d", "e"]);
    expect(meta.oldestSequence).toBe(3);
    expect(meta.lastEventSequence).toBe(5);
    expect(meta.evictedCount).toBe(2);
    expect(meta.totalLinesReceived).toBe(5);
  });

  it("filters by stream", () => {
    const store = new MetroLogsStore();
    store.append(WK, "stdout", "out-1");
    store.append(WK, "stderr", "err-1");
    store.append(WK, "stdout", "out-2");
    const stderrOnly = store.list(WK, { stream: "stderr" });
    expect(stderrOnly.entries.map((e) => e.line)).toEqual(["err-1"]);
  });

  it("filters by substring (case-sensitive)", () => {
    const store = new MetroLogsStore();
    store.append(WK, "stdout", "Hello World");
    store.append(WK, "stdout", "hello world");
    store.append(WK, "stdout", "something else");
    const { entries } = store.list(WK, { substring: "hello" });
    expect(entries.map((e) => e.line)).toEqual(["hello world"]);
  });

  it("applies since cursor filter when epoch matches", () => {
    const store = new MetroLogsStore();
    store.append(WK, "stdout", "a");
    store.append(WK, "stdout", "b");
    const afterFirst = store.list(WK, {
      since: { bufferEpoch: 1, sequence: 1 },
    });
    expect(afterFirst.cursorDropped).toBe(false);
    expect(afterFirst.entries.map((e) => e.line)).toEqual(["b"]);
  });

  it("drops cursor when epoch has bumped", () => {
    const store = new MetroLogsStore();
    store.append(WK, "stdout", "a");
    store.clear(WK);
    store.append(WK, "stdout", "b");
    const result = store.list(WK, {
      since: { bufferEpoch: 1, sequence: 0 },
    });
    expect(result.cursorDropped).toBe(true);
    // Even with a stale cursor, the caller still gets the current
    // ring — they just need to throw the cursor away.
    expect(result.entries.map((e) => e.line)).toEqual(["b"]);
  });

  it("clamps limit to MAX_LIST_LIMIT", () => {
    const store = new MetroLogsStore({ capacity: MAX_LIST_LIMIT + 500 });
    for (let i = 0; i < MAX_LIST_LIMIT + 250; i++) {
      store.append(WK, "stdout", `line-${i}`);
    }
    const huge = store.list(WK, { limit: MAX_LIST_LIMIT * 10 });
    expect(huge.entries.length).toBe(MAX_LIST_LIMIT);
    const defaulted = store.list(WK);
    expect(defaulted.entries.length).toBe(MAX_LIST_LIMIT);
  });
});

describe("MetroLogsStore — clear + epoch", () => {
  it("clear() bumps epoch and empties the ring but keeps sequence monotonic", () => {
    const store = new MetroLogsStore();
    store.append(WK, "stdout", "a");
    store.append(WK, "stdout", "b");
    const pre = store.status(WK);
    expect(pre.meta.bufferEpoch).toBe(1);
    const afterClear = store.clear(WK);
    expect(afterClear.bufferEpoch).toBe(2);
    expect(store.size(WK)).toBe(0);
    const nextLine = store.append(WK, "stdout", "c");
    expect(nextLine.sequence).toBe(3);
  });

  it("setMetroStatus flips to running bumps epoch when prior lines exist", () => {
    const store = new MetroLogsStore();
    store.setMetroStatus(WK, "running");
    store.append(WK, "stdout", "a");
    expect(store.size(WK)).toBe(1);
    // Simulate Metro stopping and starting again — ring must drop stale
    // lines so a cursor held during the first session doesn't bleed
    // into the second.
    store.setMetroStatus(WK, "stopped");
    store.setMetroStatus(WK, "running");
    expect(store.size(WK)).toBe(0);
    const status = store.status(WK);
    expect(status.meta.bufferEpoch).toBe(2);
    expect(status.meta.metroStatus).toBe("running");
  });

  it("setMetroStatus does not bump epoch when ring is already empty", () => {
    const store = new MetroLogsStore();
    store.setMetroStatus(WK, "starting");
    store.setMetroStatus(WK, "running");
    const status = store.status(WK);
    // No lines existed across the transition — no cursors to invalidate.
    expect(status.meta.bufferEpoch).toBe(1);
  });
});

describe("MetroLogsStore — isolation", () => {
  it("keeps rings per-worktree independent", () => {
    const store = new MetroLogsStore();
    store.append("a", "stdout", "alpha");
    store.append("b", "stdout", "beta");
    expect(store.list("a").entries.map((e) => e.line)).toEqual(["alpha"]);
    expect(store.list("b").entries.map((e) => e.line)).toEqual(["beta"]);
    store.clear("a");
    expect(store.size("a")).toBe(0);
    expect(store.size("b")).toBe(1);
  });
});
