/**
 * DevTools IPC dispatcher tests — Phase 3 Track A.
 *
 * Two layers:
 *   1. `dispatchDevtoolsAction` — pure function over (manager, msg). Fast
 *      unit tests using a real DevToolsManager + fake Metro/upstream.
 *   2. `registerDevtoolsIpc` — the glue over IpcServer. End-to-end round-
 *      trip via a real `IpcClient` to prove Track B's MCP tools will work
 *      when talking to this dispatcher over the unix socket.
 *
 * These tests are the contract boundary between Track A (this file's
 * dispatcher) and Track B (MCP tools calling via IpcClient). If this
 * suite passes, Track B's IPC fallback path is wired correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import type { MetroManager } from "../../core/metro.js";
import type { MetroInstance } from "../../core/types.js";
import { DevToolsManager } from "../../core/devtools.js";
import { IpcServer, IpcClient, type IpcMessage } from "../../core/ipc.js";
import {
  dispatchDevtoolsAction,
  registerDevtoolsIpc,
} from "../devtools-ipc.js";

// ---------------------------------------------------------------------------
// Metro + upstream fixture (copied from devtools.test.ts patterns)
// ---------------------------------------------------------------------------

interface MetroFake extends EventEmitter {
  getInstance(worktreeKey: string): MetroInstance | undefined;
  setInstance(worktreeKey: string, instance: MetroInstance | undefined): void;
}

function makeMetroFake(): MetroFake {
  const bus = new EventEmitter() as MetroFake;
  const instances = new Map<string, MetroInstance>();
  bus.getInstance = (k) => instances.get(k);
  bus.setInstance = (k, i) => {
    if (i) instances.set(k, i);
    else instances.delete(k);
  };
  return bus;
}

interface MetroEnv {
  http: HttpServer;
  ws: WebSocketServer;
  metroPort: number;
  send(frame: string): void;
  teardown(): Promise<void>;
}

async function startMetroEnv(): Promise<MetroEnv> {
  const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => ws.once("listening", () => r()));
  const wsAddr = ws.address() as AddressInfo;
  const inspectorPath = `/inspector/debug?device=dev&page=1`;
  let live: WsSocket | null = null;
  ws.on("connection", (sock) => {
    live = sock;
  });
  const send = (frame: string) => {
    if (live && live.readyState === 1) live.send(frame);
  };

  const http = createHttpServer((req, res) => {
    if (req.url === "/json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          {
            id: "abc",
            type: "node",
            title: "App A",
            webSocketDebuggerUrl: `ws://127.0.0.1:${wsAddr.port}${inspectorPath}`,
          },
          {
            id: "def",
            type: "node",
            title: "App B",
            webSocketDebuggerUrl: `ws://127.0.0.1:${wsAddr.port}${inspectorPath}`,
          },
        ])
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const metroPort = (http.address() as AddressInfo).port;

  return {
    http,
    ws,
    metroPort,
    send,
    async teardown() {
      try {
        ws.clients.forEach((c) => c.terminate());
      } catch {
        // ignore
      }
      await new Promise<void>((r) => ws.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeMsg(action: string, payload?: unknown): IpcMessage {
  return {
    type: "command",
    action,
    payload,
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Layer 1 — dispatchDevtoolsAction (pure, no socket)
// ---------------------------------------------------------------------------

describe("dispatchDevtoolsAction", () => {
  let env: MetroEnv;
  let metro: MetroFake;
  let manager: DevToolsManager;

  beforeEach(async () => {
    env = await startMetroEnv();
    metro = makeMetroFake();
    metro.setInstance("w1", {
      worktree: "w1",
      port: env.metroPort,
      pid: 1,
      status: "running",
      startedAt: new Date(),
      projectRoot: "/tmp",
    });
    manager = new DevToolsManager(metro as unknown as MetroManager, {
      deltaFlushIntervalMs: 30,
    });
    await manager.start("w1");
    await waitMs(30);
  });

  afterEach(async () => {
    await manager.stopAll();
    await env.teardown();
  });

  it("devtools/status returns DevToolsStatus for the default worktree", async () => {
    const resp = await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/status")
    );
    expect(resp).toMatchObject({
      meta: { proxyStatus: "connected" },
      targets: expect.any(Array),
    });
  });

  it("devtools/list returns the capture envelope with entries", async () => {
    env.send(
      JSON.stringify({
        method: "Network.requestWillBeSent",
        params: {
          requestId: "r1",
          request: { url: "https://a.example/x", method: "GET", headers: {} },
          timestamp: 1,
        },
      })
    );
    await waitMs(30);

    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/list")
    )) as { entries: { requestId: string }[]; meta: { proxyStatus: string } };
    expect(resp.entries).toHaveLength(1);
    expect(resp.entries[0]!.requestId).toBe("r1");
    expect(resp.meta.proxyStatus).toBe("connected");
  });

  it("devtools/list respects urlRegex filter", async () => {
    for (const [id, url] of [
      ["r1", "https://api.example/a"],
      ["r2", "https://other.com/b"],
    ]) {
      env.send(
        JSON.stringify({
          method: "Network.requestWillBeSent",
          params: {
            requestId: id,
            request: { url, method: "GET", headers: {} },
            timestamp: 1,
          },
        })
      );
    }
    await waitMs(30);

    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/list", { urlRegex: "example" })
    )) as { entries: { requestId: string }[] };
    expect(resp.entries.map((e) => e.requestId)).toEqual(["r1"]);
  });

  it("devtools/get returns the entry for a known requestId", async () => {
    env.send(
      JSON.stringify({
        method: "Network.requestWillBeSent",
        params: {
          requestId: "r1",
          request: { url: "https://x", method: "GET", headers: {} },
          timestamp: 1,
        },
      })
    );
    await waitMs(30);

    const resp = await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/get", { requestId: "r1" })
    );
    expect(resp).toMatchObject({ requestId: "r1" });
  });

  it("devtools/get returns null for an unknown requestId", async () => {
    const resp = await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/get", { requestId: "missing" })
    );
    expect(resp).toBeNull();
  });

  it("devtools/get returns null when requestId is missing", async () => {
    const resp = await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/get", {})
    );
    expect(resp).toBeNull();
  });

  it("devtools/clear returns { status: 'cleared', meta } and bumps epoch", async () => {
    env.send(
      JSON.stringify({
        method: "Network.requestWillBeSent",
        params: {
          requestId: "r1",
          request: { url: "https://x", method: "GET", headers: {} },
          timestamp: 1,
        },
      })
    );
    await waitMs(30);
    const before = manager.status("w1").meta.bufferEpoch;

    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/clear")
    )) as { status: string; meta: { bufferEpoch: number; sessionBoundary: { reason: string } } };
    expect(resp.status).toBe("cleared");
    expect(resp.meta.bufferEpoch).toBe(before + 1);
    expect(resp.meta.sessionBoundary.reason).toBe("clear");
    expect(manager.listNetwork("w1").entries).toHaveLength(0);
  });

  it("devtools/select-target switches target + bumps epoch", async () => {
    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/select-target", { targetId: "def" })
    )) as { status: string; meta: { selectedTargetId: string; sessionBoundary: { reason: string } } };
    expect(resp.status).toBe("switched");
    expect(resp.meta.selectedTargetId).toBe("def");
    expect(resp.meta.sessionBoundary.reason).toBe("target-swap");
  });

  it("devtools/select-target returns { error } for an unknown targetId", async () => {
    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/select-target", { targetId: "unknown" })
    )) as { error: string };
    expect(resp.error).toContain("unknown");
  });

  it("devtools/select-target returns { error: 'missing-targetId' } when arg omitted", async () => {
    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/select-target", {})
    )) as { error: string };
    expect(resp.error).toBe("missing-targetId");
  });

  it("unknown action returns { error: 'unknown-action', action }", async () => {
    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/bogus")
    )) as { error: string; action: string };
    expect(resp.error).toBe("unknown-action");
    expect(resp.action).toBe("devtools/bogus");
  });

  it("worktree in payload is preferred over defaultWorktreeKey", async () => {
    metro.setInstance("w2", {
      worktree: "w2",
      port: env.metroPort,
      pid: 2,
      status: "running",
      startedAt: new Date(),
      projectRoot: "/tmp",
    });
    // Payload selects an unknown worktree → manager returns a clean
    // 'no-target' envelope, not the default worktree's data.
    const resp = (await dispatchDevtoolsAction(
      { manager, defaultWorktreeKey: "w1" },
      makeMsg("devtools/list", { worktree: "unknown-worktree" })
    )) as { entries: unknown[]; meta: { proxyStatus: string } };
    expect(resp.entries).toEqual([]);
    expect(resp.meta.proxyStatus).toBe("no-target");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — round-trip through IpcServer + IpcClient
// ---------------------------------------------------------------------------

describe("registerDevtoolsIpc (end-to-end through unix socket)", () => {
  let env: MetroEnv;
  let metro: MetroFake;
  let manager: DevToolsManager;
  let ipc: IpcServer;
  let socketPath: string;
  let unsubscribe: (() => void) | null = null;

  beforeEach(async () => {
    env = await startMetroEnv();
    metro = makeMetroFake();
    metro.setInstance("w1", {
      worktree: "w1",
      port: env.metroPort,
      pid: 1,
      status: "running",
      startedAt: new Date(),
      projectRoot: "/tmp",
    });
    manager = new DevToolsManager(metro as unknown as MetroManager, {
      deltaFlushIntervalMs: 30,
    });
    await manager.start("w1");
    await waitMs(30);

    const tmp = mkdtempSync(path.join(tmpdir(), "rn-dev-ipc-"));
    socketPath = path.join(tmp, "sock");
    ipc = new IpcServer(socketPath);
    await ipc.start();
    unsubscribe = registerDevtoolsIpc(ipc, {
      manager,
      defaultWorktreeKey: "w1",
    });
  });

  afterEach(async () => {
    unsubscribe?.();
    await ipc.stop();
    await manager.stopAll();
    await env.teardown();
  });

  it("MCP-over-IPC: client round-trips devtools/status", async () => {
    const client = new IpcClient(socketPath);
    const resp = await client.send(makeMsg("devtools/status"));
    expect(resp.action).toBe("devtools/status");
    expect(resp.payload).toMatchObject({
      meta: { proxyStatus: "connected" },
    });
  });

  it("MCP-over-IPC: client round-trips devtools/list after network activity", async () => {
    env.send(
      JSON.stringify({
        method: "Network.requestWillBeSent",
        params: {
          requestId: "r1",
          request: { url: "https://x", method: "GET", headers: {} },
          timestamp: 1,
        },
      })
    );
    await waitMs(30);

    const client = new IpcClient(socketPath);
    const resp = await client.send(makeMsg("devtools/list"));
    const payload = resp.payload as { entries: { requestId: string }[] };
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.requestId).toBe("r1");
  });

  it("non-devtools actions are ignored (no reply, client times out) — dispatcher is scoped", async () => {
    const client = new IpcClient(socketPath);
    // Expect a timeout (~5s default) — assert via Promise rejection. Keep
    // test snappy by asserting rejection only, not timing.
    await expect(
      Promise.race([
        client.send(makeMsg("metro-status")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("intentional-early-stop")), 300)),
      ])
    ).rejects.toThrow("intentional-early-stop");
  });

  it("unsubscribe stops the dispatcher from handling further messages", async () => {
    unsubscribe?.();
    unsubscribe = null;
    const client = new IpcClient(socketPath);
    await expect(
      Promise.race([
        client.send(makeMsg("devtools/status")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("intentional-early-stop")), 300)),
      ])
    ).rejects.toThrow("intentional-early-stop");
  });
});
