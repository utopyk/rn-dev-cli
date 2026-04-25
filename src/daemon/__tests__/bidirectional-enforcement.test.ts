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

  it.skip("rejects RPC on a subscribe socket without supportsBidirectionalRpc", async () => {
    // Wired in Task 2.3 once IpcClient gains the multiplexer's send() method.
    // Daemon-side check is implemented in this task; client-side is in Phase 2.
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
        payload: {},
      },
      { onEvent: () => {} },
    );

    try {
      // Placeholder — real assertion gets wired in Task 2.3.
      expect(sub).toBeDefined();
    } finally {
      sub.close();
    }
  });
});
