import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createToolDefinitions } from "./tools.js";
import type { McpContext, McpFlags, ToolDefinition, ToolResult } from "./tools.js";
import { discoverModuleContributedTools } from "./module-proxy.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { createDefaultPreflightEngine } from "../core/preflight.js";
import { connectToDaemonSession, type DaemonSession } from "../app/client/session.js";
import { detectProjectRoot } from "../core/project.js";

/**
 * Parse MCP flags out of `process.argv`. Kept argv-driven to avoid pulling
 * commander into the MCP server.
 *
 * Module-system flags (Phase 3a):
 *   --enable-module:<id>      enable a specific module (repeatable); when
 *                             this AND --disable-module are both empty,
 *                             every loaded module is enabled.
 *   --disable-module:<id>     disable a specific module (repeatable);
 *                             wins over --enable-module for the same id.
 *   --allow-destructive-tools  permit `destructiveHint: true` tools to run
 *                              without per-call confirmation (headless
 *                              consent). Phase 3b enforces at tools/call.
 *
 * Phase 9 retired the `--enable-devtools-mcp` / `--mcp-capture-bodies`
 * flags when the DevTools Network tools moved into the 3p
 * `@rn-dev-modules/devtools-network` module. Body pass-through is now
 * controlled by that module's `captureBodies` config.
 */
export function parseFlags(argv: readonly string[]): McpFlags {
  return {
    enabledModules: collectPrefixed(argv, "--enable-module:"),
    disabledModules: collectPrefixed(argv, "--disable-module:"),
    allowDestructiveTools: argv.includes("--allow-destructive-tools"),
  };
}

function collectPrefixed(
  argv: readonly string[],
  prefix: string,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      const id = arg.slice(prefix.length).trim();
      if (id) set.add(id);
    }
  }
  return set;
}

/**
 * Best-effort narrowing of a handler's return value into the MCP
 * `CallToolResult` shape. Handlers either return:
 *   (a) plain data — legacy path; wrapped as a single text block.
 *   (b) a ToolResult — new path; structuredContent + isError respected.
 */
function toCallToolResult(
  raw: unknown
): { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } {
  if (raw && typeof raw === "object") {
    const maybe = raw as ToolResult;
    const hasStructured = maybe.structuredContent !== undefined;
    const hasContent = Array.isArray(maybe.content);
    const hasIsError = typeof maybe.isError === "boolean";
    if (hasStructured || hasContent || hasIsError) {
      const content =
        maybe.content ??
        (maybe.structuredContent
          ? [
              {
                type: "text" as const,
                text: JSON.stringify(maybe.structuredContent, null, 2),
              },
            ]
          : [{ type: "text" as const, text: "" }]);
      return {
        content,
        ...(maybe.structuredContent !== undefined && {
          structuredContent: maybe.structuredContent,
        }),
        ...(maybe.isError !== undefined && { isError: maybe.isError }),
      };
    }
  }
  return {
    content: [{ type: "text", text: JSON.stringify(raw, null, 2) }],
  };
}

export async function startMcpServer(argv: readonly string[] = process.argv): Promise<void> {
  const flags = parseFlags(argv);

  const server = new Server(
    { name: "rn-dev-cli", version: "0.1.0" },
    // Phase 3d: declare `tools.listChanged` so connected clients know we may
    // emit `notifications/tools/list_changed` after module installs / crashes.
    { capabilities: { tools: { listChanged: true } } }
  );

  // Build context from the current working directory
  const projectRoot = detectProjectRoot(process.cwd()) ?? process.cwd();
  const rnDevDir = path.join(projectRoot, ".rn-dev");

  const profileStore = new ProfileStore(path.join(rnDevDir, "profiles"));
  // Resolve a profile for connectToDaemonSession: prefer the first
  // `isDefault === true` entry, then any entry, then null (degrade to
  // built-ins-only mode — same posture as the old IpcClient-null fallback).
  const profiles = profileStore.list();
  const profile = profiles.find((p) => p.isDefault) ?? profiles[0] ?? null;

  let session: DaemonSession | null = null;
  if (profile) {
    try {
      session = await connectToDaemonSession(projectRoot, profile, {
        // Bug 6 — broadened from `["modules/*"]` to also include
        // `session/*` so the daemon's `bootSessionServices` progress
        // (preflight, install, watchman setup, port-kill, simulator
        // boot) reaches the SessionClient adapter and can be surfaced
        // through the new `rn-dev/session-logs` tool. MCP still skips
        // the metro/builder/devtools firehose — those are interactive
        // surfaces that don't map to per-tool-call output.
        kinds: ["modules/*", "session/*"],
      });
    } catch {
      // Daemon unreachable at startup — degrade to built-ins-only mode
      // (mirrors the old IpcClient-null fallback).
      session = null;
    }
  }

  // Bug 6 — in-memory ring of recent `session/log` lines, populated by
  // the SessionClient adapter that `connectToDaemonSession` publishes.
  // The `rn-dev/session-logs` tool returns this ring's contents so an
  // agent that just called `start-session` can read what the daemon is
  // doing. Without this, the daemon's boot progress was invisible to
  // MCP callers — `routeEventToAdapters` dropped the events on the
  // floor in its default arm.
  const SESSION_LOG_RING_SIZE = 200;
  const sessionLogRing: McpContext["sessionLogRing"] = [];
  if (session) {
    // Backfill from the SessionClient's internal ring before live
    // subscribing — `connectToDaemonSession` runs the daemon's
    // `bootSessionServices` between the events/subscribe ACK and the
    // `session/status:running` edge that resolves the await, so by
    // the time we reach this line the boot-progress log lines have
    // already fired through the SessionClient. Without this backfill,
    // an MCP agent calling `session-logs` immediately after MCP
    // startup would see an empty array even though the daemon emitted
    // a flurry of boot progress.
    const ts = Date.now();
    for (const evt of session.session.recentLogs()) {
      sessionLogRing.push({
        level: evt.level,
        message: evt.message,
        // No per-event timestamp on the wire today — the SessionClient
        // ring captures order, not arrival time. Stamp them all with
        // the backfill instant; subsequent live events get their own.
        ts,
      });
      if (sessionLogRing.length > SESSION_LOG_RING_SIZE) {
        sessionLogRing.shift();
      }
    }
    session.session.on("log", (evt) => {
      sessionLogRing.push({
        level: evt.level,
        message: evt.message,
        ts: Date.now(),
      });
      if (sessionLogRing.length > SESSION_LOG_RING_SIZE) {
        sessionLogRing.shift();
      }
    });
  }

  const ctx: McpContext = {
    projectRoot,
    profileStore,
    artifactStore: new ArtifactStore(path.join(rnDevDir, "artifacts")),
    metro: null, // MCP server runs standalone, no metro manager
    preflightEngine: createDefaultPreflightEngine(projectRoot),
    session,
    sessionLogRing,
    flags,
  };

  const builtInTools = createToolDefinitions(ctx);
  // Phase 3b: snapshot module-contributed tools from the daemon at startup.
  // If the daemon is unreachable we degrade to built-ins only — mirroring
  // the devtools-network-* fallback.
  const initialModuleTools = await discoverModuleContributedTools(ctx, flags);
  // Phase 3d: the module tool set is mutable. `modules/subscribe` drives
  // refreshes; `tools/list` reads this array on every call.
  let moduleTools: ToolDefinition[] = initialModuleTools;

  // Register tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [...builtInTools, ...moduleTools];
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.outputSchema && { outputSchema: t.outputSchema }),
      })),
    };
  });

  // Register tools/call handler. Handlers may throw — that's an infrastructure
  // failure (e.g. tool lookup missed). Per-tool logical failures come back as
  // `{ isError: true, ... }` in the ToolResult shape.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tools = [...builtInTools, ...moduleTools];
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    try {
      const raw = await tool.handler(
        (request.params.arguments as Record<string, unknown>) ?? {}
      );
      return toCallToolResult(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: message }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Phase 13.6 PR-C: subscribe to the daemon's module-event stream via the
  // session's ModuleHostClient (which receives modules/* events from the
  // events/subscribe channel opened by connectToDaemonSession). When modules
  // change state we refresh the tool snapshot and notify connected clients.
  // Silent best-effort: if no session is running we stay on the startup
  // snapshot. Callers can always re-handshake.
  if (ctx.session) {
    ctx.session.modules.on("modules-event", async () => {
      try {
        const next = await discoverModuleContributedTools(ctx, flags);
        moduleTools = next;
      } catch {
        // If the refetch fails (daemon flaky), keep the old snapshot and
        // still notify — a re-handshake by the agent will retry.
      }
      try {
        await server.sendToolListChanged();
      } catch {
        // Transport may be closed (client already disconnected).
      }
    });
  }
}

