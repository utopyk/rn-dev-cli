import { describe, it, expect, afterEach } from "vitest";
import {
  makeTestWorktree,
  spawnTestDaemon,
  type TestDaemonHandle,
} from "../../../test/helpers/spawnTestDaemon.js";
import { connectToDaemonSession } from "../../app/client/session.js";
import type { Profile } from "../../core/types.js";

// Phase 13.6 PR-C keystone integration test.
//
// Pins two complementary properties:
//
//   1. MCP-shaped client works under the new long-lived channel.
//      A client that attaches with `kinds: ["modules/*", "session/status"]`
//      (filtering out the metro/builder/devtools firehose while keeping
//      the status edges needed for the session-ready handshake) successfully:
//        - receives the events/subscribe response (refcount slot acquired)
//        - issues modules/bind-sender over the same socket → succeeds
//        - issues modules/host-call over the same socket → succeeds
//          (gate is default-ON per Task 4.1; binding identity is preserved
//          because bind-sender and host-call ride the same connectionId
//          via the multiplexed subscribe socket)
//        - releases cleanly via session.release()
//
//   2. Multi-client coexistence. An Electron-shaped client (no kinds filter)
//      and an MCP-shaped client can attach simultaneously to the same daemon,
//      each binds + host-calls independently with their own connectionId.
//      No cross-contamination.
//
// RN_DEV_HOSTCALL_BIND_GATE is intentionally NOT set — default-ON is the
// production path as of Task 4.1. The dev-space module's `log` capability
// (method "info") is the actual capability registered by fakeBootSessionServices;
// see src/daemon/__tests__/sender-bindings-integration.test.ts for the reference.
//
// Note on kinds filter design: the MCP-shaped kinds filter is
// `["modules/*", "session/status"]` rather than just `["modules/*"]`.
// `session/status` events are how connectToDaemonSession observes the
// starting→running transition to resolve the session-ready gate. A filter
// that drops session/status would hang forever waiting for the running edge.

describe("MCP as daemon client (Phase 13.6 PR-C keystone)", () => {
  const live: TestDaemonHandle[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const h of live.splice(0)) await h.stop();
    for (const c of cleanups.splice(0)) c();
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

  it(
    "MCP-shaped client (kinds=modules/*) attaches, binds, host-calls successfully",
    async () => {
      const { path: worktree, cleanup } = makeTestWorktree();
      cleanups.push(cleanup);
      const daemon = await spawnTestDaemon(worktree, {
        env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
      });
      live.push(daemon);

      // Simulate the MCP client's attach: kinds filter to skip the metro/
      // builder/devtools firehose while keeping session/status so the
      // session-ready handshake (starting→running edge) completes normally.
      const mcpSession = await connectToDaemonSession(
        worktree,
        fakeProfile(worktree),
        { kinds: ["modules/*", "session/status"] },
      );

      // Bind the dev-space module on this session.
      const bindResp = await mcpSession.client.send({
        type: "command",
        action: "modules/bind-sender",
        id: "bind-1",
        payload: { moduleId: "dev-space" },
      });
      expect((bindResp.payload as { code?: string }).code).toBeUndefined();

      // host-call against dev-space — gate is default-ON (Task 4.1);
      // this should NOT return MODULE_UNAVAILABLE because bind-sender
      // and host-call ride the same connectionId via the multiplexed
      // subscribe socket.
      //
      // dev-space registers a `log` capability (method "info") under
      // fakeBootSessionServices — confirmed in sender-bindings-integration.test.ts.
      const callResp = await mcpSession.client.send({
        type: "command",
        action: "modules/host-call",
        id: "call-1",
        payload: {
          moduleId: "dev-space",
          capabilityId: "log",
          method: "info",
          args: [],
        },
      });
      expect((callResp.payload as { code?: string }).code).not.toBe(
        "MODULE_UNAVAILABLE",
      );

      await mcpSession.release();
    },
    20_000,
  );

  it(
    "MCP attaches alongside Electron-shaped client; both ride distinct connectionIds",
    async () => {
      const { path: worktree, cleanup } = makeTestWorktree();
      cleanups.push(cleanup);
      const daemon = await spawnTestDaemon(worktree, {
        env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
      });
      live.push(daemon);

      // Electron-shaped: no kinds filter (full firehose).
      const electron = await connectToDaemonSession(
        worktree,
        fakeProfile(worktree),
      );
      // MCP-shaped: kinds filter includes session/status so the
      // session-ready handshake completes (starting→running edge needed).
      const mcp = await connectToDaemonSession(
        worktree,
        fakeProfile(worktree),
        { kinds: ["modules/*", "session/status"] },
      );

      // Both bind dev-space on their own sessions; both host-calls must
      // succeed (gate ON, binding identity preserved per-connectionId).
      for (const session of [electron, mcp]) {
        const bindResp = await session.client.send({
          type: "command",
          action: "modules/bind-sender",
          id: `bind-${Math.random()}`,
          payload: { moduleId: "dev-space" },
        });
        // bind-sender always returns { kind: "ok" } on a well-formed payload.
        expect((bindResp.payload as { kind?: string }).kind).toBe("ok");

        const callResp = await session.client.send({
          type: "command",
          action: "modules/host-call",
          id: `call-${Math.random()}`,
          payload: {
            moduleId: "dev-space",
            capabilityId: "log",
            method: "info",
            args: [],
          },
        });
        expect((callResp.payload as { code?: string }).code).not.toBe(
          "MODULE_UNAVAILABLE",
        );
      }

      await mcp.release();
      await electron.release();
    },
    20_000,
  );
});
