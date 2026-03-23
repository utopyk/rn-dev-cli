import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { ProfileStore } from "../core/profile.js";
import type { ArtifactStore } from "../core/artifact.js";
import type { MetroManager } from "../core/metro.js";
import type { PreflightEngine } from "../core/preflight.js";
import type { IpcClient, IpcMessage } from "../core/ipc.js";
import type { Platform } from "../core/types.js";
import { listDevices, bootDevice } from "../core/device.js";
import { getWorktrees } from "../core/project.js";
import { CleanManager } from "../core/clean.js";

// ---------------------------------------------------------------------------
// McpContext
// ---------------------------------------------------------------------------

export interface McpContext {
  projectRoot: string;
  profileStore: ProfileStore;
  artifactStore: ArtifactStore;
  metro: MetroManager | null;
  preflightEngine: PreflightEngine;
  ipcClient: IpcClient | null;
}

// ---------------------------------------------------------------------------
// ToolDefinition
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Helper: send IPC command
// ---------------------------------------------------------------------------

function makeIpcMessage(action: string, payload?: unknown): IpcMessage {
  return {
    type: "command",
    action,
    payload,
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Helper: detect package manager
// ---------------------------------------------------------------------------

function detectPm(projectRoot: string): "npm" | "yarn" | "pnpm" {
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  return "npm";
}

// ---------------------------------------------------------------------------
// createToolDefinitions
// ---------------------------------------------------------------------------

export function createToolDefinitions(ctx: McpContext): ToolDefinition[] {
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
      handler: async (args) => {
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("start-session", args)
            );
            return resp.payload ?? { status: "started" };
          } catch {
            // fall through
          }
        }
        if (ctx.metro) {
          const worktreeKey =
            (args.worktree as string) ?? ctx.artifactStore.worktreeHash(null);
          const instance = ctx.metro.start({
            worktreeKey,
            projectRoot: ctx.projectRoot,
            port: undefined,
            resetCache: args.mode !== "dirty",
            env: {},
          });
          return {
            status: "started",
            port: instance.port,
            pid: instance.pid,
          };
        }
        return { error: "No running session" };
      },
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
      handler: async (args) => {
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("stop-session", args)
            );
            return resp.payload ?? { status: "stopped" };
          } catch {
            // fall through
          }
        }
        if (ctx.metro) {
          const worktreeKey =
            (args.worktree as string) ?? ctx.artifactStore.worktreeHash(null);
          const stopped = ctx.metro.stop(worktreeKey);
          return { status: stopped ? "stopped" : "not-found" };
        }
        return { error: "No running session" };
      },
    },
    {
      name: "rn-dev/list-sessions",
      description: "List all active development sessions",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("list-sessions")
            );
            return resp.payload ?? [];
          } catch {
            // fall through
          }
        }
        if (ctx.metro) {
          return ctx.metro.getAll().map((inst) => ({
            worktree: inst.worktree,
            port: inst.port,
            pid: inst.pid,
            status: inst.status,
            startedAt: inst.startedAt.toISOString(),
          }));
        }
        return { error: "No running session" };
      },
    },
    // Metro control
    {
      name: "rn-dev/reload",
      description: "Reload the running app",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("reload")
            );
            return resp.payload ?? { status: "reloaded" };
          } catch {
            // fall through
          }
        }
        // Try direct approach: adb for Android
        try {
          execSync("adb shell input keyevent 82", {
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { status: "reloaded", method: "adb" };
        } catch {
          // fall through
        }
        // Try HTTP to Metro
        if (ctx.metro) {
          const instances = ctx.metro.getAll();
          if (instances.length > 0) {
            try {
              execSync(
                `curl -s http://localhost:${instances[0].port}/reload`,
                { stdio: ["pipe", "pipe", "pipe"] }
              );
              return { status: "reloaded", method: "metro-http" };
            } catch {
              // fall through
            }
          }
        }
        return { error: "No running session" };
      },
    },
    {
      name: "rn-dev/dev-menu",
      description: "Open device developer menu",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("dev-menu")
            );
            return resp.payload ?? { status: "opened" };
          } catch {
            // fall through
          }
        }
        // Try direct adb command
        try {
          execSync("adb shell input keyevent 82", {
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { status: "opened", method: "adb" };
        } catch {
          // fall through
        }
        return { error: "No running session" };
      },
    },
    {
      name: "rn-dev/metro-status",
      description: "Get Metro bundler status",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (ctx.metro) {
          const instances = ctx.metro.getAll();
          if (instances.length > 0) {
            return instances.map((inst) => ({
              worktree: inst.worktree,
              port: inst.port,
              pid: inst.pid,
              status: inst.status,
              startedAt: inst.startedAt.toISOString(),
            }));
          }
        }
        if (ctx.ipcClient) {
          try {
            const resp = await ctx.ipcClient.send(
              makeIpcMessage("metro-status")
            );
            return resp.payload ?? { status: "unknown" };
          } catch {
            // fall through
          }
        }
        return { status: "not-running" };
      },
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
      handler: async (args) => {
        const numLines = (args.lines as number) ?? 50;
        const logsDir = join(ctx.projectRoot, ".rn-dev", "logs");

        if (!existsSync(logsDir)) {
          return { error: "No log directory found", lines: [] };
        }

        try {
          const files = readdirSync(logsDir)
            .filter((f) => f.startsWith("metro-") && f.endsWith(".log"))
            .sort()
            .reverse();

          if (files.length === 0) {
            return { lines: [], message: "No metro log files found" };
          }

          const content = readFileSync(join(logsDir, files[0]), "utf-8");
          const allLines = content.split("\n").filter((l) => l.trim());
          const recent = allLines.slice(-numLines);
          return { lines: recent, file: files[0] };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
            lines: [],
          };
        }
      },
    },
    // Build & Clean
    {
      name: "rn-dev/clean",
      description: "Run clean operations",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["dirty", "clean", "ultra-clean"] },
          platform: { type: "string", enum: ["ios", "android", "both"] },
        },
        required: ["mode"],
      },
      handler: async (args) => {
        const mode = args.mode as "dirty" | "clean" | "ultra-clean";
        const platform = (args.platform as Platform) ?? "both";
        const cleaner = new CleanManager(ctx.projectRoot);
        const results = await cleaner.execute(mode, platform);
        return { results };
      },
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
      handler: async (args) => {
        const platform = args.platform as string;
        const variant = (args.variant as string) ?? "debug";
        const cmd =
          platform === "ios"
            ? `npx react-native run-ios${variant === "release" ? " --configuration Release" : ""}`
            : `npx react-native run-android${variant === "release" ? " --variant=release" : ""}`;
        try {
          const output = execSync(cmd, {
            cwd: ctx.projectRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 600_000,
          });
          return { status: "success", output: output.slice(-2000) };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "failed", error: msg.slice(-2000) };
        }
      },
    },
    {
      name: "rn-dev/install-deps",
      description: "Reinstall node_modules and pods if needed",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const pm = detectPm(ctx.projectRoot);
        const installCmd =
          pm === "yarn"
            ? "yarn install"
            : pm === "pnpm"
              ? "pnpm install"
              : "npm install";
        const results: Array<{ step: string; success: boolean; output: string }> = [];

        try {
          const output = execSync(installCmd, {
            cwd: ctx.projectRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          results.push({ step: installCmd, success: true, output: output.slice(-1000) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ step: installCmd, success: false, output: msg.slice(-1000) });
        }

        // pod install if ios directory exists
        const iosDir = join(ctx.projectRoot, "ios");
        if (existsSync(iosDir)) {
          try {
            const output = execSync("pod install", {
              cwd: iosDir,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            });
            results.push({ step: "pod install", success: true, output: output.slice(-1000) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ step: "pod install", success: false, output: msg.slice(-1000) });
          }
        }

        return { results };
      },
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
      handler: async (args) => {
        const platform = (args.platform as "ios" | "android" | "both") ?? "both";
        const devices = listDevices(platform);
        return { devices };
      },
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
      handler: async (args) => {
        const deviceId = args.deviceId as string;
        // Find the device in all available devices
        const devices = listDevices("both");
        const device = devices.find((d) => d.id === deviceId);
        if (!device) {
          return { error: `Device not found: ${deviceId}` };
        }
        return { status: "selected", device };
      },
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
      handler: async (args) => {
        const deviceId = args.deviceId as string;
        const devices = listDevices("both");
        const device = devices.find((d) => d.id === deviceId);
        if (!device) {
          return { error: `Device not found: ${deviceId}` };
        }
        const success = bootDevice(device);
        return { status: success ? "booted" : "failed", device };
      },
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
      handler: async (args) => {
        const platform = (args.platform as Platform) ?? "both";
        const checks = ctx.preflightEngine.getChecksForPlatform(platform);
        const config = { checks: checks.map((c) => c.id), frequency: "always" as const };
        const results = await ctx.preflightEngine.runAll(platform, config);
        const output: Record<string, { passed: boolean; message: string; details?: string }> = {};
        for (const [id, result] of results) {
          output[id] = result;
        }
        return output;
      },
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
      handler: async (args) => {
        const checkId = args.check as string;
        const success = await ctx.preflightEngine.fix(checkId);
        return { check: checkId, fixed: success };
      },
    },
    // Worktree
    {
      name: "rn-dev/list-worktrees",
      description: "List git worktrees with session status",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const worktrees = getWorktrees(ctx.projectRoot);
        return { worktrees };
      },
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
      handler: async (args) => {
        const branch = args.branch as string;
        const name = (args.name as string) ?? branch;
        const worktreePath = join(ctx.projectRoot, "..", `worktree-${name}`);
        try {
          execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
            cwd: ctx.projectRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { status: "created", path: worktreePath, branch };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: msg };
        }
      },
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
      handler: async (args) => {
        const worktree = args.worktree as string;
        const worktrees = getWorktrees(ctx.projectRoot);
        const target = worktrees.find(
          (w) => w.path === worktree || w.branch === worktree
        );
        if (!target) {
          return { error: `Worktree not found: ${worktree}` };
        }
        return { status: "switched", worktree: target };
      },
    },
    // Profile
    {
      name: "rn-dev/list-profiles",
      description: "List saved profiles",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const profiles = ctx.profileStore.list();
        return { profiles };
      },
    },
    {
      name: "rn-dev/get-profile",
      description: "Get current active profile details",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const profile = ctx.profileStore.findDefault(null, "main");
        if (!profile) {
          return { error: "No default profile found" };
        }
        return { profile };
      },
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
      handler: async (args) => {
        const name = args.name as string;
        // Load existing profile or create a minimal one
        const existing = ctx.profileStore.findDefault(null, "main");
        const profile = existing
          ? { ...existing, name }
          : {
              name,
              isDefault: false,
              worktree: null,
              branch: "main",
              platform: "both" as const,
              mode: "clean" as const,
              metroPort: 8081,
              devices: {},
              buildVariant: "debug" as const,
              preflight: { checks: [], frequency: "once" as const },
              onSave: [],
              env: {},
              projectRoot: ctx.projectRoot,
            };
        ctx.profileStore.save(profile);
        return { status: "saved", name };
      },
    },
    // Tools
    {
      name: "rn-dev/run-lint",
      description: "Run project linter and return results",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        try {
          const output = execSync("npx eslint src/ --format json", {
            cwd: ctx.projectRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { status: "success", output: output.slice(-5000) };
        } catch (err) {
          // ESLint exits non-zero when there are lint errors
          const msg = err instanceof Error ? (err as { stdout?: string }).stdout ?? err.message : String(err);
          return { status: "lint-errors", output: String(msg).slice(-5000) };
        }
      },
    },
    {
      name: "rn-dev/run-typecheck",
      description: "Run TypeScript type checking",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        try {
          const output = execSync("npx tsc --noEmit", {
            cwd: ctx.projectRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { status: "success", output: output.slice(-5000) };
        } catch (err) {
          const msg = err instanceof Error ? (err as { stdout?: string }).stdout ?? err.message : String(err);
          return { status: "type-errors", output: String(msg).slice(-5000) };
        }
      },
    },
  ];
}
