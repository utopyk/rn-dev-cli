// MCP-side analog of tests/electron-real-e2e/probe-real-build.spec.ts.
//
// Spawns the real MCP server against the user's kimoby fixture, calls
// rn-dev/build, and polls rn-dev/build-status to observe progress
// — the exact agent flow we want to certify works for production
// agents driving the daemon via MCP.
//
// PROBE-gated, like the Electron probe. Set PROBE=1 to run; otherwise
// it skips. Mirrors the long-session pattern: 12 minutes of build
// observation, screenshots / DOM are replaced with periodic polls of
// the build-status tool.
//
// What this proves end-to-end:
//   1. MCP boots against a real RN profile + project.
//   2. connectToDaemonSession spawns the daemon and joins the running
//      session.
//   3. rn-dev/build over MCP → builder/build over daemon RPC → real
//      xcodebuild + react-native CLI run.
//   4. Builder events flow back through events/subscribe → BuilderClient
//      ring → rn-dev/build-status tool — agents can observe progress.
//   5. The build either succeeds (done.success === true) or surfaces
//      diagnostics in line events the agent can read.
//
// See docs/plans/2026-05-06-tui-mcp-real-process-test-parity.md (Phase
// M2a) for the broader plan.

import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  spawnMcpServer,
  type McpHarnessHandle,
} from "../../../test/helpers/spawnMcpServer.js";

const KIMOBY = process.env.PROBE_KIMOBY ?? "/Users/martincouso/Documents/GitHub/kimoby-mobile-app";
const ENABLED = process.env.PROBE === "1" || process.env.PROBE_KIMOBY === "1";

interface BuildStatusEvent {
  kind: "line" | "progress" | "done";
  ts: number;
  data: {
    text?: string;
    stream?: string;
    phase?: string;
    success?: boolean;
    errors?: unknown[];
    platform?: string;
  };
}

function parseToolJson<T>(result: unknown): T {
  const r = result as {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: T;
  };
  if (r.structuredContent) return r.structuredContent;
  const text = r.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`No usable content: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as T;
}

describe("Probe — real build via MCP against kimoby + iPhone", () => {
  const liveMcp: McpHarnessHandle[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const m of liveMcp.splice(0)) await m.stop();
    for (const c of cleanups.splice(0)) c();
  });

  it.skipIf(!ENABLED)(
    "rn-dev/build kicks a real iOS build and rn-dev/build-status surfaces progress",
    async () => {
      // Reuse the Electron probe's profile-write approach so the same
      // scheme/configuration/device pinning applies. A throwaway
      // profile name keeps this test from interfering with the user's
      // real default profile.
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: KIMOBY }).toString().trim();
      const profileDir = join(KIMOBY, ".rn-dev", "profiles");
      mkdirSync(profileDir, { recursive: true });
      const profileName = "rn-dev-probe-real-build-mcp";
      const profilePath = join(profileDir, `${profileName}.json`);
      writeFileSync(
        profilePath,
        JSON.stringify(
          {
            name: profileName,
            isDefault: true,
            worktree: null,
            branch,
            platform: "ios",
            mode: "dirty",
            metroPort: 8099,
            devices: { ios: "00008130-001A653A3E11001C", android: null },
            buildVariant: "debug",
            scheme: "Kimoby",
            configuration: "Debug",
            preflight: { checks: [], frequency: "once" },
            onSave: [],
            env: {},
            projectRoot: KIMOBY,
            packageManager: "pnpm",
          },
          null,
          2,
        ),
      );
      cleanups.push(() => {
        try {
          rmSync(profilePath, { force: true });
          rmSync(join(KIMOBY, ".rn-dev", "sock"), { force: true });
        } catch {
          // best-effort
        }
      });

      const mcp = await spawnMcpServer({ cwd: KIMOBY });
      liveMcp.push(mcp);

      // Quick sanity check that listTools succeeds before kicking the build.
      const tools = await mcp.client.listTools();
      expect(tools.tools.find((t) => t.name === "rn-dev/build")).toBeDefined();

      // Kick the build off — should return { ok: true } immediately.
      const buildResp = await mcp.client.callTool({
        name: "rn-dev/build",
        arguments: { platform: "ios" },
      });
      const buildPayload = parseToolJson<{ ok?: boolean; code?: string; message?: string }>(
        buildResp,
      );
      expect(
        buildPayload.ok,
        `rn-dev/build did not ack: ${JSON.stringify(buildPayload)}`,
      ).toBe(true);

      // Poll build-status every 10s for up to 12 minutes. Print a
      // sample of recent events so the test log shows ongoing progress
      // (matches the Electron probe's screenshot cadence).
      const deadline = Date.now() + 12 * 60_000;
      let lastSeenCount = 0;
      let done: BuildStatusEvent | undefined;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 10_000));
        const r = await mcp.client.callTool({
          name: "rn-dev/build-status",
          arguments: { limit: 500 },
        });
        const payload = parseToolJson<{ events?: BuildStatusEvent[] }>(r);
        const events = payload.events ?? [];
        if (events.length > lastSeenCount) {
          const recent = events.slice(lastSeenCount);
          for (const evt of recent.slice(-6)) {
            const kind = evt.kind;
            const summary =
              kind === "line"
                ? (evt.data.text ?? "").slice(0, 200)
                : kind === "progress"
                  ? `phase: ${evt.data.phase}`
                  : `success: ${evt.data.success}`;
            console.log(`  ${kind}: ${summary}`);
          }
          lastSeenCount = events.length;
        }
        done = events.find((e) => e.kind === "done");
        if (done) break;
      }

      const r = await mcp.client.callTool({
        name: "rn-dev/build-status",
        arguments: { limit: 500 },
      });
      const finalEvents = parseToolJson<{ events?: BuildStatusEvent[] }>(r).events ?? [];

      const kinds = finalEvents.map((e) => e.kind);
      console.log(
        `\nFINAL — line: ${kinds.filter((k) => k === "line").length}, ` +
          `progress: ${kinds.filter((k) => k === "progress").length}, ` +
          `done: ${kinds.filter((k) => k === "done").length}`,
      );

      // The point is OBSERVABILITY: agents must be able to see SOMETHING
      // happen. Whether xcodebuild succeeds depends on the cert chain,
      // which we don't gate here. Pre-refactor (synchronous execSync
      // build), the build-status tool didn't exist and there'd be zero
      // events to observe.
      expect(
        finalEvents.length,
        "rn-dev/build-status returned zero events — builder/* is not flowing through MCP.",
      ).toBeGreaterThan(0);

      // If the build actually finished, surface the result. Don't
      // hard-fail on success===false — diagnostics are the point of the
      // probe, and a cert-related failure is informative.
      if (done) {
        console.log(
          `Build done — success: ${done.data.success}, errors: ${(done.data.errors ?? []).length}`,
        );
      } else {
        console.log("Build did not complete within 12m — observation cap reached.");
      }
    },
    20 * 60_000,
  );
});

