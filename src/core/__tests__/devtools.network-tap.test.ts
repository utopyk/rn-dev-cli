import { describe, it, expect, beforeEach, vi } from "vitest";
import { NetworkTap } from "../devtools/network-tap.js";
import type { CdpCommand, CdpResponse, TapDispatch } from "../devtools/domain-tap.js";

// ---------------------------------------------------------------------------
// Test dispatch — queues responses by (method + requestId)
// ---------------------------------------------------------------------------

interface StubDispatch extends TapDispatch {
  queueGetBody(
    requestId: string,
    response: CdpResponse | { throw: string }
  ): void;
  sentCommands: CdpCommand[];
}

function makeDispatch(): StubDispatch {
  const pending = new Map<string, CdpResponse | { throw: string }>();
  const sent: CdpCommand[] = [];
  return {
    sentCommands: sent,
    queueGetBody(requestId, response) {
      pending.set(requestId, response);
    },
    async sendCommand(cmd: CdpCommand): Promise<CdpResponse> {
      sent.push(cmd);
      if (cmd.method === "Network.getResponseBody") {
        const id = String((cmd.params?.requestId as string) ?? "");
        const q = pending.get(id);
        if (!q) return { id: 1, error: { code: -32000, message: "not-found" } };
        pending.delete(id);
        if ("throw" in q) throw new Error(q.throw);
        return q;
      }
      return { id: 1, result: {} };
    },
  };
}

function ts(secs: number): number {
  return secs; // CDP timestamps are seconds-since-epoch-ish; code multiplies by 1000
}

async function flush(): Promise<void> {
  // Let microtasks drain for body fetcher
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NetworkTap", () => {
  let tap: NetworkTap;
  let dispatch: StubDispatch;

  beforeEach(() => {
    tap = new NetworkTap();
    dispatch = makeDispatch();
    tap.attach(dispatch);
  });

  it("happy path: request → response → finished → body captured", async () => {
    dispatch.queueGetBody("req1", {
      id: 1,
      result: { body: '{"hello":"world"}', base64Encoded: false },
    });
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req1",
        request: {
          url: "https://api.example.com/health",
          method: "GET",
          headers: { Authorization: "Bearer xyz", Accept: "application/json" },
        },
        timestamp: ts(100),
        initiator: { type: "script", stack: { callFrames: [] } },
      },
    });
    tap.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req1",
        response: {
          url: "https://api.example.com/health",
          status: 200,
          statusText: "OK",
          mimeType: "application/json",
          headers: { "Content-Type": "application/json", "Set-Cookie": "s=1" },
        },
      },
    });
    tap.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req1", timestamp: ts(101) },
    });

    await flush();

    const entry = tap.ring.get("req1");
    expect(entry).toBeDefined();
    expect(entry!.terminalState).toBe("finished");
    expect(entry!.method).toBe("GET");
    // Headers redacted
    expect(entry!.requestHeaders.Authorization).toBe("[REDACTED]");
    expect(entry!.requestHeaders.Accept).toBe("application/json");
    if (entry!.terminalState === "finished") {
      expect(entry!.status).toBe(200);
      expect(entry!.statusText).toBe("OK");
      expect(entry!.mimeType).toBe("application/json");
      expect(entry!.responseHeaders["Set-Cookie"]).toBe("[REDACTED]");
      expect(entry!.responseBody.kind).toBe("text");
      if (entry!.responseBody.kind === "text") {
        expect(entry!.responseBody.data).toBe('{"hello":"world"}');
        expect(entry!.responseBody.truncated).toBe(false);
      }
      expect(entry!.timings.completedAt).toBeGreaterThan(entry!.timings.startedAt);
    }
  });

  it("loadingFailed transitions entry to failed with reason", async () => {
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req2",
        request: { url: "https://x", method: "POST", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.loadingFailed",
      params: { requestId: "req2", timestamp: ts(11), errorText: "net::ERR_FAILED" },
    });
    const entry = tap.ring.get("req2");
    expect(entry!.terminalState).toBe("failed");
    if (entry!.terminalState === "failed") {
      expect(entry!.failureReason).toBe("net::ERR_FAILED");
      expect(entry!.timings.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("204/304 skips body fetch, sets absent with 204-or-304 reason", async () => {
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req3",
        request: { url: "https://x", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req3",
        response: {
          status: 204,
          statusText: "No Content",
          mimeType: "",
          headers: {},
        },
      },
    });
    tap.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req3", timestamp: ts(11) },
    });
    await flush();
    const entry = tap.ring.get("req3");
    expect(entry!.terminalState).toBe("finished");
    if (entry!.terminalState === "finished") {
      expect(entry!.responseBody.kind).toBe("absent");
      if (entry!.responseBody.kind === "absent") {
        expect(entry!.responseBody.reason).toBe("204-or-304");
      }
    }
    // Body fetch was NOT issued
    expect(
      dispatch.sentCommands.find((c) => c.method === "Network.getResponseBody")
    ).toBeUndefined();
  });

  it("binary MIME → metadata-only, no body fetch", async () => {
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req4",
        request: { url: "https://x/img.png", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req4",
        response: {
          status: 200,
          statusText: "OK",
          mimeType: "image/png",
          headers: {},
        },
      },
    });
    tap.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req4", timestamp: ts(11) },
    });
    await flush();
    const entry = tap.ring.get("req4");
    if (entry!.terminalState === "finished") {
      expect(entry!.responseBody.kind).toBe("binary");
      if (entry!.responseBody.kind === "binary") {
        expect(entry!.responseBody.mimeType).toBe("image/png");
      }
    }
    expect(
      dispatch.sentCommands.find((c) => c.method === "Network.getResponseBody")
    ).toBeUndefined();
  });

  it("body cap truncates text bodies and bumps bodyTruncatedCount", async () => {
    const tapCapped = new NetworkTap({ responseBodyCap: 10 });
    const d = makeDispatch();
    tapCapped.attach(d);
    d.queueGetBody("req5", {
      id: 1,
      result: { body: "0123456789ABCDEF", base64Encoded: false },
    });
    tapCapped.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req5",
        request: { url: "https://x", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tapCapped.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req5",
        response: {
          status: 200,
          statusText: "OK",
          mimeType: "text/plain",
          headers: {},
        },
      },
    });
    tapCapped.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req5", timestamp: ts(11) },
    });
    await flush();
    const entry = tapCapped.ring.get("req5");
    if (entry!.terminalState === "finished" && entry!.responseBody.kind === "text") {
      expect(entry!.responseBody.truncated).toBe(true);
      expect(entry!.responseBody.data).toBe("0123456789");
      expect(entry!.responseBody.droppedBytes).toBe(6);
    }
    expect(tapCapped.ring.state.bodyTruncatedCount).toBe(1);
  });

  it("captureBodies: false → all bodies redacted, no fetch issued", async () => {
    const noBodies = new NetworkTap({ captureBodies: false });
    const d = makeDispatch();
    noBodies.attach(d);
    noBodies.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req6",
        request: {
          url: "https://x",
          method: "POST",
          headers: {},
          postData: "body-content",
        },
        timestamp: ts(10),
      },
    });
    noBodies.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req6",
        response: {
          status: 200,
          statusText: "OK",
          mimeType: "application/json",
          headers: {},
        },
      },
    });
    noBodies.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req6", timestamp: ts(11) },
    });
    await flush();
    const entry = noBodies.ring.get("req6");
    expect(entry!.requestBody.kind).toBe("redacted");
    if (entry!.terminalState === "finished") {
      expect(entry!.responseBody.kind).toBe("redacted");
    }
    expect(
      d.sentCommands.find((c) => c.method === "Network.getResponseBody")
    ).toBeUndefined();
  });

  it("getResponseBody failure → absent with fetch-failed", async () => {
    dispatch.queueGetBody("req7", { throw: "boom" });
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req7",
        request: { url: "https://x", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req7",
        response: {
          status: 200,
          statusText: "OK",
          mimeType: "application/json",
          headers: {},
        },
      },
    });
    tap.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req7", timestamp: ts(11) },
    });
    await flush();
    const entry = tap.ring.get("req7");
    if (entry!.terminalState === "finished" && entry!.responseBody.kind === "absent") {
      expect(entry!.responseBody.reason).toBe("fetch-failed");
    } else {
      throw new Error("expected finished + absent body");
    }
  });

  it("redirect: redirectResponse appends prior URL to redirectChain", async () => {
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req8",
        request: { url: "https://a", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req8",
        request: { url: "https://b", method: "GET", headers: {} },
        timestamp: ts(11),
        redirectResponse: { url: "https://a", status: 301 },
      },
    });
    const entry = tap.ring.get("req8");
    expect(entry!.url).toBe("https://b");
    expect(entry!.redirectChain).toEqual(["https://a"]);
  });

  it("ignores non-Network events", () => {
    tap.handleEvent({
      method: "Debugger.paused",
      params: {},
    });
    expect(tap.ring.snapshot().entries.length).toBe(0);
  });

  it("detach disposes body fetcher; later events don't fetch", async () => {
    tap.detach();
    tap.handleEvent({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "req9",
        request: { url: "https://x", method: "GET", headers: {} },
        timestamp: ts(10),
      },
    });
    tap.handleEvent({
      method: "Network.responseReceived",
      params: {
        requestId: "req9",
        response: {
          status: 200,
          statusText: "OK",
          mimeType: "text/plain",
          headers: {},
        },
      },
    });
    tap.handleEvent({
      method: "Network.loadingFinished",
      params: { requestId: "req9", timestamp: ts(11) },
    });
    await flush();
    // Body fetcher is disposed, so getResponseBody should NOT have been called.
    expect(
      dispatch.sentCommands.find((c) => c.method === "Network.getResponseBody")
    ).toBeUndefined();
  });

  it("enableCommands exposes Network.enable", () => {
    expect(tap.enableCommands.map((c) => c.method)).toEqual(["Network.enable"]);
  });

  it("body queue overflow bumps tapDroppedCount", async () => {
    const small = new NetworkTap({
      bodyFetchQueueCap: 2,
      bodyFetchConcurrency: 1,
      bodyFetchTimeoutMs: 1000,
    });
    const d = makeDispatch();
    // Never resolve — hold the worker
    d.sendCommand = vi.fn(() => new Promise<CdpResponse>(() => {}));
    small.attach(d);

    // Enqueue 5 finished requests rapidly; only 1 goes inflight, queue caps at 2.
    for (let i = 0; i < 5; i++) {
      const id = `q${i}`;
      small.handleEvent({
        method: "Network.requestWillBeSent",
        params: {
          requestId: id,
          request: { url: "https://x", method: "GET", headers: {} },
          timestamp: ts(10),
        },
      });
      small.handleEvent({
        method: "Network.responseReceived",
        params: {
          requestId: id,
          response: {
            status: 200,
            statusText: "OK",
            mimeType: "text/plain",
            headers: {},
          },
        },
      });
      small.handleEvent({
        method: "Network.loadingFinished",
        params: { requestId: id, timestamp: ts(11) },
      });
    }
    // 5 enqueue attempts, 1 inflight, queue holds 2 → at least 2 dropped
    expect(small.ring.state.tapDroppedCount).toBeGreaterThanOrEqual(2);
  });
});
