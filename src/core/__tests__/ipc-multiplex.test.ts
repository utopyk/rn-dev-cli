import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { IpcClient, IpcServer } from "../ipc.js";

describe("IpcClient.subscribe multiplex", () => {
  const sockets: string[] = [];

  afterEach(() => {
    for (const s of sockets.splice(0)) {
      try { fs.unlinkSync(s); } catch { /* ignore */ }
    }
  });

  function makeSock(): string {
    const p = path.join(os.tmpdir(), `mux-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
    sockets.push(p);
    return p;
  }

  it("send() over a subscribed socket correlates response by id", async () => {
    const sockPath = makeSock();
    const server = new IpcServer(sockPath);
    server.on("message", ({ message, reply }) => {
      if (message.action === "events/subscribe") {
        reply({
          type: "response",
          action: "events/subscribe",
          id: message.id,
          payload: { subscribed: true },
        });
      } else if (message.action === "echo") {
        reply({
          type: "response",
          action: "echo",
          id: message.id,
          payload: { ok: true, echoed: (message.payload as { v: number }).v },
        });
      }
    });
    await server.start();

    const client = new IpcClient(sockPath);
    const sub = await client.subscribe(
      { type: "command", action: "events/subscribe", id: "sub-1" },
      { onEvent: () => {} },
    );

    const r = await sub.send({
      type: "command",
      action: "echo",
      id: "rpc-1",
      payload: { v: 42 },
    });
    expect(r.id).toBe("rpc-1");
    expect((r.payload as { ok: boolean; echoed: number }).ok).toBe(true);
    expect((r.payload as { ok: boolean; echoed: number }).echoed).toBe(42);

    sub.close();
    await server.stop();
  });
});
