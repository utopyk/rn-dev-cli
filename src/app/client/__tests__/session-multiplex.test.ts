import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IpcServer } from "../../../core/ipc.js";
import type { IpcMessageEvent } from "../../../core/ipc.js";
import { connectToDaemonSession } from "../session.js";
import type { Profile } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Lightweight stub for verifying the events/subscribe wire payload.
//
// We do NOT need a full daemon here — only the subscribe handshake. The
// stub:
//   1. Accepts the events/subscribe command and records its payload.
//   2. Replies with the canonical subscribed-but-not-yet-running ack.
//   3. Pushes a session/status "running" event (with a worktreeKey) over
//      the same socket so connectToDaemonSession can resolve.
//   4. Handles a bare session/status RPC (not used on this path, but
//      cheap to support so the joiner short-circuit can't time-out).
//
// RN_DEV_DAEMON_SOCK is set to point at the stub so connectToDaemon
// (inside connectToDaemonSession) never attempts a real spawn.
// ---------------------------------------------------------------------------

const FAKE_WORKTREE_KEY = "stub-worktree-key";

function makeProfile(projectRoot: string): Profile {
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
    projectRoot,
  };
}

describe("connectToDaemonSession — events/subscribe wire payload", () => {
  let sockDir: string;
  let sockPath: string;
  let server: IpcServer;
  let capturedSubscribePayloads: unknown[];
  let prevSock: string | undefined;

  beforeEach(async () => {
    capturedSubscribePayloads = [];

    sockDir = mkdtempSync(join(tmpdir(), "rn-dev-multiplex-test-"));
    sockPath = join(sockDir, "sock");

    server = new IpcServer(sockPath);

    server.on("message", (evt: IpcMessageEvent) => {
      const { message, reply } = evt;

      if (message.action === "events/subscribe") {
        // Capture the payload for assertions.
        capturedSubscribePayloads.push(message.payload);

        // Reply: subscribed, session is "starting" (not yet running).
        // This puts connectToDaemonSession into the "wait for running event" path.
        reply({
          type: "response",
          action: "events/subscribe",
          id: message.id,
          payload: {
            subscribed: true,
            status: "starting",
            started: true,
            attached: 1,
          },
        });

        // Push a session/status "running" event after a microtask tick so
        // the subscribe confirmation has been processed by the client first.
        setImmediate(() => {
          reply({
            type: "event",
            action: "events/subscribe",
            id: message.id,
            payload: {
              kind: "session/status",
              worktreeKey: FAKE_WORKTREE_KEY,
              data: { status: "running" },
            },
          });
        });
        return;
      }

      if (message.action === "session/status") {
        // Joiner RPC (back-compat path — not exercised on the "starting" path
        // but guard it to avoid silent timeouts if the logic ever changes).
        reply({
          type: "response",
          action: "session/status",
          id: message.id,
          payload: { status: "running", worktreeKey: FAKE_WORKTREE_KEY },
        });
        return;
      }
    });

    await server.start();

    // Point connectToDaemon at our stub.
    prevSock = process.env.RN_DEV_DAEMON_SOCK;
    process.env.RN_DEV_DAEMON_SOCK = sockPath;
  });

  afterEach(async () => {
    if (prevSock === undefined) {
      delete process.env.RN_DEV_DAEMON_SOCK;
    } else {
      process.env.RN_DEV_DAEMON_SOCK = prevSock;
    }
    await server.stop();
    try {
      rmSync(sockDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("default path: subscribe payload always includes supportsBidirectionalRpc: true", async () => {
    const session = await connectToDaemonSession("/fake/root", makeProfile("/fake/root"), {
      sessionReadyTimeoutMs: 5_000,
    });
    session.disconnect();

    expect(capturedSubscribePayloads).toHaveLength(1);
    const payload = capturedSubscribePayloads[0] as Record<string, unknown>;
    expect(payload.supportsBidirectionalRpc).toBe(true);
    // kinds must be absent when not specified — do not send spurious fields
    // to daemons that don't understand them.
    expect(payload.kinds).toBeUndefined();
  }, 10_000);

  it("with kinds: subscribe payload includes both supportsBidirectionalRpc and kinds", async () => {
    const session = await connectToDaemonSession("/fake/root", makeProfile("/fake/root"), {
      sessionReadyTimeoutMs: 5_000,
      kinds: ["modules/*"],
    });
    session.disconnect();

    expect(capturedSubscribePayloads).toHaveLength(1);
    const payload = capturedSubscribePayloads[0] as Record<string, unknown>;
    expect(payload.supportsBidirectionalRpc).toBe(true);
    expect(payload.kinds).toEqual(["modules/*"]);
  }, 10_000);
});
