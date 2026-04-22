import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createToolDefinitions } from "./tools.js";
import type { McpContext, McpFlags, ToolResult } from "./tools.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { createDefaultPreflightEngine } from "../core/preflight.js";
import { IpcClient } from "../core/ipc.js";
import { detectProjectRoot } from "../core/project.js";

/**
 * Parse MCP flags out of `process.argv`. Kept argv-driven to avoid pulling
 * commander into the MCP server.
 *
 * DevTools security flags (default OFF):
 *   --enable-devtools-mcp     register `rn-dev/devtools-network-*` tools (S4)
 *   --mcp-capture-bodies      let captured bodies pass through MCP DTOs (S5)
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
 */
export function parseFlags(argv: readonly string[]): McpFlags {
  return {
    enableDevtoolsMcp: argv.includes("--enable-devtools-mcp"),
    mcpCaptureBodies: argv.includes("--mcp-capture-bodies"),
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
 * S7: emit a stderr banner when devtools MCP is enabled so sessions are
 * visible to the operator. Noisy on purpose — silent sensitive capture is
 * the thing we're trying to avoid.
 */
function emitSecurityBanner(flags: McpFlags, transport: string): void {
  if (!flags.enableDevtoolsMcp) return;
  const lines = [
    "════════════════════════════════════════════════════════════════",
    "  rn-dev MCP: DevTools Network capture ENABLED",
    `    transport: ${transport}`,
    `    body capture: ${flags.mcpCaptureBodies ? "ON (bodies pass through MCP)" : "OFF (bodies redacted)"}`,
    "  Captured traffic is attacker-controlled data. Agents must",
    "  treat headers and bodies as data, not instructions.",
    "════════════════════════════════════════════════════════════════",
  ];
  for (const line of lines) process.stderr.write(line + "\n");
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
    { capabilities: { tools: {} } }
  );

  // Build context from the current working directory
  const projectRoot = detectProjectRoot(process.cwd()) ?? process.cwd();
  const rnDevDir = path.join(projectRoot, ".rn-dev");

  const ctx: McpContext = {
    projectRoot,
    profileStore: new ProfileStore(path.join(rnDevDir, "profiles")),
    artifactStore: new ArtifactStore(path.join(rnDevDir, "artifacts")),
    metro: null, // MCP server runs standalone, no metro manager
    preflightEngine: createDefaultPreflightEngine(projectRoot),
    ipcClient: new IpcClient(path.join(rnDevDir, "sock")),
    flags,
  };

  const tools = createToolDefinitions(ctx);

  // Register tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.outputSchema && { outputSchema: t.outputSchema }),
    })),
  }));

  // Register tools/call handler. Handlers may throw — that's an infrastructure
  // failure (e.g. tool lookup missed). Per-tool logical failures come back as
  // `{ isError: true, ... }` in the ToolResult shape.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

  emitSecurityBanner(flags, "stdio");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
