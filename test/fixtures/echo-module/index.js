#!/usr/bin/env node
// Minimal module subprocess used by integration tests. Speaks vscode-jsonrpc
// over stdio Content-Length framing. Registers:
//   - `initialize` → returns { moduleId: 'echo', toolCount, sdkVersion }
//   - `echo`       → returns whatever params were sent
//   - `crash-on-request` → exits with code 42 (tests supervisor crash path)
//   - `sleep` notification → noop (tests hold-open behavior)
//
// Kept as a standalone ESM script with no TS transpile so the host can
// spawn it with `node path/to/index.js` directly. The repo's package.json
// has "type": "module" so this file is interpreted as ESM.

import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from "vscode-jsonrpc/node.js";

const reader = new StreamMessageReader(process.stdin);
const writer = new StreamMessageWriter(process.stdout);
const connection = createMessageConnection(reader, writer);

connection.onRequest("initialize", (params) => {
  return {
    moduleId: "echo",
    toolCount: 1,
    sdkVersion: "0.1.0",
    echoedHostVersion: params?.hostVersion,
    echoedCapabilityCount: Array.isArray(params?.capabilities)
      ? params.capabilities.length
      : 0,
  };
});

connection.onRequest("echo", (params) => {
  return params;
});

// Phase 3b: `modules/call` IPC translates <id>__<tool> into `tool/<tool>`
// requests on the subprocess. The echo fixture declares `echo__ping` in its
// manifest, so the wire request is `tool/ping`.
connection.onRequest("tool/ping", (params) => {
  return { pong: true, echoed: params };
});

connection.onRequest("crash-on-request", () => {
  // Fail fast — the supervisor test verifies this becomes a `crashed`
  // transition on the host side.
  process.exit(42);
});

connection.onNotification("sleep", () => {
  // Intentionally no-op — used by hold-open / orphan-prevention tests.
});

connection.listen();

// Heartbeat: write a log-ish notification on startup so the host can
// observe we're alive without having to send a request.
setImmediate(() => {
  connection.sendNotification("log", {
    level: "info",
    message: "echo fixture ready",
  });
});
