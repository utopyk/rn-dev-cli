import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeTestWorktree,
  spawnTestDaemon,
  type TestDaemonHandle,
} from "../../../test/helpers/spawnTestDaemon.js";
import {
  spawnMcpServer,
  type McpHarnessHandle,
} from "../../../test/helpers/spawnMcpServer.js";

// Bug 6 — MCP-side e2e merge gate.
//
// Before this test landed, the entire Phase-13.6 + Phase-13.4 test grid
// covered MCP behavior only by:
//   - calling `connectToDaemonSession` from inside vitest (verifies wire
//     contract but not the actual MCP-server-process behavior), and
//   - asserting tools list / handler outputs against a mocked context
//     (verifies tool-handler logic but not the server boot path).
//
// Neither layer would catch a bug like "MCP server's `kinds` filter
// excludes `session/log` events from the daemon, so `bootSessionServices`
// progress never lands in any tool's output." This test boots the actual
// MCP server as a child process via stdio, drives it through the real
// SDK `Client`, and asserts that daemon-emitted `session/log` lines
// round-trip into the new `rn-dev/session-logs` tool's output.
//
// Pattern transfers to TUI: a future TUI harness will spawn the CLI via
// node-pty, drive screen interactions, and assert the same round-trip.
// Pattern is documented in feedback_test_strategy.md as the canonical
// answer to "how do you cover client-process behavior end-to-end."

describe("MCP session-logs e2e (Bug 6 merge gate)", () => {
  const liveDaemons: TestDaemonHandle[] = [];
  const liveMcp: McpHarnessHandle[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    // MCP first — closing the client cleanly closes the SDK transport,
    // which closes our subscribe socket and drops the daemon's refcount
    // entry for this connection. Closing in the other order leaves a
    // stale entry that delays the daemon's last-release teardown until
    // the socket eventually closes itself.
    for (const m of liveMcp.splice(0)) await m.stop();
    for (const d of liveDaemons.splice(0)) await d.stop();
    for (const c of cleanups.splice(0)) c();
  });

  function writeProfile(worktree: string): void {
    // Profile shape mirrors what `ProfileStore.save` writes; minimal
    // valid form so `findDefault(null, branch)` matches inside MCP's
    // server.ts. `worktree: null` matches the shape of every other
    // test profile in this codebase.
    const profilesDir = join(worktree, ".rn-dev", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, "default.json"),
      JSON.stringify({
        name: "default",
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
      }),
    );
  }

  it(
    "rn-dev/session-logs returns the daemon-emitted session/log lines from boot",
    async () => {
      // 1. Spawn the daemon (fake boot — no real Metro). Fake-boot now
      //    emits a few `session/log` lines via `opts.emit(...)` so the
      //    contract that production exercises (every `bootSessionServices`
      //    step calls `emit(line)`) is honored under fake mode too.
      const { path: worktree, cleanup } = makeTestWorktree();
      cleanups.push(cleanup);
      writeProfile(worktree);

      const daemon = await spawnTestDaemon(worktree, {
        env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
      });
      liveDaemons.push(daemon);

      // 2. Spawn the MCP server as a child process pointed at the same
      //    worktree. MCP's `detectProjectRoot` + `ProfileStore` find the
      //    profile we wrote; `connectToDaemonSession` finds the daemon's
      //    socket at `<worktree>/.rn-dev/sock` and joins the running
      //    session. The MCP server's SessionClient subscribe lands BEFORE
      //    the daemon's bootAsync finishes, so the fake-boot emit() lines
      //    flow back into the server's ring buffer.
      const mcp = await spawnMcpServer({ cwd: worktree });
      liveMcp.push(mcp);

      // 3. Give the daemon's bootAsync a beat to run + emit. Tests of
      //    this shape elsewhere (`client-rpcs.test.ts::bootRunningSession`)
      //    use `waitForEvent` against a subscribed events stream — we
      //    can't do that here because the MCP client doesn't expose the
      //    underlying events socket, so we poll `session-logs` instead.
      let response: { structuredContent?: { lines?: unknown[] } } | null = null;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const r = (await mcp.client.callTool({
          name: "rn-dev/session-logs",
          arguments: { limit: 50 },
        })) as { structuredContent?: { lines?: unknown[] } };
        const lines = r.structuredContent?.lines;
        if (Array.isArray(lines) && lines.length > 0) {
          response = r;
          break;
        }
        await new Promise((res) => setTimeout(res, 100));
      }

      expect(
        response,
        `session-logs should have collected at least one line within 5s.\nMCP stderr:\n${mcp.getStderr()}\nDaemon stderr:\n${daemon.getStderr()}`,
      ).not.toBeNull();
      const lines = response!.structuredContent!.lines as Array<{
        level: string;
        message: string;
        ts: number;
      }>;

      // 4. Assert the fake-boot-emitted lines round-tripped end-to-end:
      //    daemon supervisor → events/subscribe → SessionClient → MCP
      //    ring buffer → tool output. The Bug 6 regression sat at step
      //    3 (SessionClient never received because routeEventToAdapters
      //    dropped the events) AND at step 4 (MCP's kinds filter excluded
      //    session/* before the broaden).
      const messages = lines.map((l) => l.message);
      expect(messages).toContain("[fake-boot] session services starting");
      expect(messages).toContain("[fake-boot] session services ready");

      // Sanity: every line carries a level + numeric ts.
      for (const line of lines) {
        expect(typeof line.level).toBe("string");
        expect(typeof line.ts).toBe("number");
        expect(line.ts).toBeGreaterThan(0);
      }
    },
    20_000,
  );

  it(
    "rn-dev/session-logs respects the sinceTs cursor for polling agents",
    async () => {
      const { path: worktree, cleanup } = makeTestWorktree();
      cleanups.push(cleanup);
      writeProfile(worktree);

      const daemon = await spawnTestDaemon(worktree, {
        env: { RN_DEV_DAEMON_BOOT_MODE: "fake" },
      });
      liveDaemons.push(daemon);
      const mcp = await spawnMcpServer({ cwd: worktree });
      liveMcp.push(mcp);

      // Wait for some logs to arrive.
      let first: { structuredContent?: { lines?: unknown[]; latestTs?: number } } | null = null;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const r = (await mcp.client.callTool({
          name: "rn-dev/session-logs",
          arguments: {},
        })) as typeof first;
        const lines = r?.structuredContent?.lines;
        if (Array.isArray(lines) && lines.length > 0) {
          first = r;
          break;
        }
        await new Promise((res) => setTimeout(res, 100));
      }
      expect(first).not.toBeNull();
      const latestTs = first!.structuredContent!.latestTs as number;
      expect(latestTs).toBeGreaterThan(0);

      // Polling with sinceTs >= latestTs should return only lines whose
      // ts >= sinceTs. With sinceTs = latestTs + 1 we should get an
      // empty array (no new lines arrived yet).
      const polled = (await mcp.client.callTool({
        name: "rn-dev/session-logs",
        arguments: { sinceTs: latestTs + 1 },
      })) as { structuredContent?: { lines?: unknown[] } };
      expect(polled.structuredContent?.lines).toEqual([]);
    },
    20_000,
  );
});
