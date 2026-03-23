export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createToolDefinitions(): ToolDefinition[] {
  return [
    // Session management
    {
      name: "rn-dev/start-session",
      description: "Start a development session with optional profile",
      inputSchema: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Profile name to load" },
          worktree: { type: "string", description: "Worktree path" },
          platform: { type: "string", enum: ["ios", "android", "both"] },
          mode: { type: "string", enum: ["dirty", "clean", "ultra-clean"] },
        },
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/stop-session",
      description: "Stop a running development session",
      inputSchema: {
        type: "object",
        properties: {
          worktree: {
            type: "string",
            description: "Worktree to stop (default: current)",
          },
        },
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/list-sessions",
      description: "List all active development sessions",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    // Metro control
    {
      name: "rn-dev/reload",
      description: "Reload the running app",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/dev-menu",
      description: "Open device developer menu",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/metro-status",
      description: "Get Metro bundler status",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/metro-logs",
      description: "Get recent Metro log output",
      inputSchema: {
        type: "object",
        properties: {
          lines: {
            type: "number",
            description: "Number of recent lines (default 50)",
          },
        },
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    // Build & Clean
    {
      name: "rn-dev/clean",
      description: "Run clean operations",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["dirty", "clean", "ultra-clean"] },
        },
        required: ["mode"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/build",
      description: "Build the app",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["ios", "android"] },
          variant: { type: "string", enum: ["debug", "release"] },
        },
        required: ["platform"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/install-deps",
      description: "Reinstall node_modules and pods if needed",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    // Device management
    {
      name: "rn-dev/list-devices",
      description: "List available iOS simulators and Android devices",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["ios", "android", "both"] },
        },
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/select-device",
      description: "Select a device for the current session",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: { type: "string" },
        },
        required: ["deviceId"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/boot-device",
      description: "Boot a simulator or start an emulator",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: { type: "string" },
        },
        required: ["deviceId"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    // Environment
    {
      name: "rn-dev/preflight",
      description: "Run preflight environment checks",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["ios", "android", "both"] },
        },
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/fix-preflight",
      description: "Auto-fix a specific failing preflight check",
      inputSchema: {
        type: "object",
        properties: {
          check: { type: "string", description: "Check ID to fix" },
        },
        required: ["check"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    // Worktree
    {
      name: "rn-dev/list-worktrees",
      description: "List git worktrees with session status",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/create-worktree",
      description: "Create a new git worktree",
      inputSchema: {
        type: "object",
        properties: {
          branch: { type: "string" },
          name: { type: "string" },
        },
        required: ["branch"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/switch-worktree",
      description: "Switch to a different worktree",
      inputSchema: {
        type: "object",
        properties: {
          worktree: { type: "string" },
          copyProfile: { type: "boolean" },
        },
        required: ["worktree"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    // Profile
    {
      name: "rn-dev/list-profiles",
      description: "List saved profiles",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/get-profile",
      description: "Get current active profile details",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/save-profile",
      description: "Save current session as profile",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
      handler: async (_args) => ({ status: "not-implemented" }),
    },
    // Tools
    {
      name: "rn-dev/run-lint",
      description: "Run project linter and return results",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
    {
      name: "rn-dev/run-typecheck",
      description: "Run TypeScript type checking",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ status: "not-implemented" }),
    },
  ];
}
