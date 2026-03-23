import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createToolDefinitions } from "./tools.js";
import type { McpContext } from "./tools.js";
import { ProfileStore } from "../core/profile.js";
import { ArtifactStore } from "../core/artifact.js";
import { createDefaultPreflightEngine } from "../core/preflight.js";
import { IpcClient } from "../core/ipc.js";
import { detectProjectRoot } from "../core/project.js";

export async function startMcpServer(): Promise<void> {
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
  };

  const tools = createToolDefinitions(ctx);

  // Register tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Register tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const result = await tool.handler(
      (request.params.arguments as Record<string, unknown>) ?? {}
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
