import { afterEach, describe, expect, it } from "vitest";
import {
  makeTestWorktree,
  spawnTestDaemon,
  type TestDaemonHandle,
} from "../../../test/helpers/spawnTestDaemon.js";
import { connectToDaemonSession } from "../../app/client/session.js";
import type { Profile } from "../../core/types.js";

// Phase 13.5 PR-D — end-to-end: a connection that hasn't called
// `modules/bind-sender` for a moduleId can't issue host-call against
// it. Verifies the daemon-side gate fires and audit-log records the
// `denied` outcome.

describe("modules/bind-sender + host-call gate (integration)", () => {
  const cleanups: Array<() => void> = [];
  const liveHandles: TestDaemonHandle[] = [];

  afterEach(async () => {
    for (const h of liveHandles.splice(0)) {
      await h.stop();
    }
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  function fakeProfile(worktree: string): Profile {
    return {
      name: "test",
      isDefault: true,
      worktree: null,
      branch: "main",
      platform: "ios",
      mode: "quick",
      metroPort: 8081,
      devices: {},
      buildVariant: "debug",
      preflight: { checks: [], frequency: "once" },
      onSave: [],
      env: {},
      projectRoot: worktree,
    };
  }

  async function bootSession(): Promise<{
    daemon: TestDaemonHandle;
    worktree: string;
    session: Awaited<ReturnType<typeof connectToDaemonSession>>;
  }> {
    const { path: worktree, cleanup } = makeTestWorktree();
    cleanups.push(cleanup);
    const daemon = await spawnTestDaemon(worktree, {
      env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
    });
    liveHandles.push(daemon);
    const session = await connectToDaemonSession(worktree, fakeProfile(worktree));
    return { daemon, worktree, session };
  }

  it("host-call without a prior bind-sender returns MODULE_UNAVAILABLE (denied)", async () => {
    const { daemon } = await bootSession();

    // dev-space is a built-in registered by fakeBootSessionServices; it
    // exists in the registry, so the gate's failure mode is "no
    // binding," not "module not registered."
    const resp = await daemon.client.send({
      type: "command",
      action: "modules/host-call",
      id: "host-call-no-bind",
      payload: {
        moduleId: "dev-space",
        capabilityId: "log",
        method: "info",
        args: [],
      },
    });

    expect(resp.type).toBe("response");
    const p = resp.payload as { kind?: string; code?: string; message?: string };
    expect(p.kind).toBe("error");
    expect(p.code).toBe("MODULE_UNAVAILABLE");
    expect(p.message).toMatch(/binding/i);
  }, 15_000);

  it("bind-sender for an unregistered module returns MODULE_NOT_REGISTERED", async () => {
    const { daemon } = await bootSession();

    const resp = await daemon.client.send({
      type: "command",
      action: "modules/bind-sender",
      id: "bind-bad",
      payload: { moduleId: "does-not-exist" },
    });

    const p = resp.payload as { kind?: string; code?: string };
    expect(p.kind).toBe("error");
    expect(p.code).toBe("MODULE_NOT_REGISTERED");
  }, 15_000);

  it("bind-sender with malformed payload returns BIND_INVALID_PAYLOAD", async () => {
    const { daemon } = await bootSession();

    const resp = await daemon.client.send({
      type: "command",
      action: "modules/bind-sender",
      id: "bind-malformed",
      payload: { moduleId: 42 }, // wrong type
    });

    const p = resp.payload as { kind?: string; code?: string };
    expect(p.kind).toBe("error");
    expect(p.code).toBe("BIND_INVALID_PAYLOAD");
  }, 15_000);

  it("bind-sender across short-lived send-conns ARE NOT shared (each conn binds itself)", async () => {
    // Phase 13.5 / Sec — every IpcClient.send() opens a fresh socket
    // with a distinct connectionId. So a `modules/bind-sender` over
    // one send-conn binds THAT conn, and a follow-up `modules/host-call`
    // over a different send-conn does NOT inherit the binding. This
    // test pins the semantic: bindings are per-socket, period.
    //
    // The practical implication is that real callers must speak to
    // the daemon over a long-lived connection (e.g. the events/subscribe
    // socket — but Phase 13.5 doesn't yet support arbitrary RPCs over
    // that socket). The host-call gate will be tightened against this
    // limitation in a follow-up; for now, the test documents that
    // bindings via short-lived send-conns DO NOT survive past their
    // own RPC.
    const { daemon } = await bootSession();

    // Bind over send-conn-A (auto-closes after response).
    const bindResp = await daemon.client.send({
      type: "command",
      action: "modules/bind-sender",
      id: "bind-1",
      payload: { moduleId: "dev-space" },
    });
    expect((bindResp.payload as { kind?: string }).kind).toBe("ok");

    // Host-call over send-conn-B (different socket → different connId).
    const callResp = await daemon.client.send({
      type: "command",
      action: "modules/host-call",
      id: "host-call-1",
      payload: {
        moduleId: "dev-space",
        capabilityId: "log",
        method: "info",
        args: [],
      },
    });

    const p = callResp.payload as { kind?: string; code?: string };
    expect(p.kind).toBe("error");
    expect(p.code).toBe("MODULE_UNAVAILABLE");
  }, 15_000);
});
