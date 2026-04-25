import { describe, it, expect, afterEach } from "vitest";
import {
  makeTestWorktree,
  spawnTestDaemon,
  type TestDaemonHandle,
} from "../../../test/helpers/spawnTestDaemon.js";
import { IpcClient } from "../../core/ipc.js";
import path from "node:path";

describe("bidirectional flag enforcement", () => {
  const liveHandles: TestDaemonHandle[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const h of liveHandles.splice(0)) await h.stop();
    for (const c of cleanups.splice(0)) c();
  });

  it("rejects RPC on a subscribe socket without supportsBidirectionalRpc", async () => {
    const { path: worktree, cleanup } = makeTestWorktree();
    cleanups.push(cleanup);
    const daemon = await spawnTestDaemon(worktree, {
      env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
    });
    liveHandles.push(daemon);

    const client = new IpcClient(path.join(worktree, ".rn-dev", "sock"));
    const sub = await client.subscribe(
      {
        type: "command",
        action: "events/subscribe",
        id: "sub-1",
        payload: {},   // no supportsBidirectionalRpc
      },
      { onEvent: () => {} },
    );
    try {
      const r = await sub.send({
        type: "command",
        action: "metro/reload",
        id: "rpc-x",
      });
      expect((r.payload as { code: string }).code).toBe("E_RPC_NOT_AUTHORIZED");
    } finally {
      sub.close();
    }
  });

  it("accepts RPC on a subscribe socket WITH supportsBidirectionalRpc", async () => {
    const { path: worktree, cleanup } = makeTestWorktree();
    cleanups.push(cleanup);
    const daemon = await spawnTestDaemon(worktree, {
      env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
    });
    liveHandles.push(daemon);

    const client = new IpcClient(path.join(worktree, ".rn-dev", "sock"));
    const sub = await client.subscribe(
      {
        type: "command",
        action: "events/subscribe",
        id: "sub-1",
        payload: { supportsBidirectionalRpc: true },
      },
      { onEvent: () => {} },
    );
    try {
      // The daemon will reply with E_SESSION_NOT_RUNNING because no
      // session/start was issued, but crucially NOT E_RPC_NOT_AUTHORIZED.
      const r = await sub.send({
        type: "command",
        action: "metro/reload",
        id: "rpc-x",
      });
      expect((r.payload as { code: string }).code).not.toBe("E_RPC_NOT_AUTHORIZED");
    } finally {
      sub.close();
    }
  });
});
