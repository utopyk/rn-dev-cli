import { describe, it, expect } from "vitest";
import { createToolDefinitions } from "../tools.js";

describe("createToolDefinitions()", () => {
  it("returns 23 tool definitions", () => {
    const tools = createToolDefinitions();
    expect(tools).toHaveLength(23);
  });

  it("each tool has name, description, inputSchema, and handler", () => {
    const tools = createToolDefinitions();
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe("object");
      expect(tool.inputSchema).not.toBeNull();
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("all tool names follow the 'rn-dev/' prefix convention", () => {
    const tools = createToolDefinitions();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^rn-dev\//);
    }
  });

  it("all handlers resolve successfully with a not-implemented status", async () => {
    const tools = createToolDefinitions();
    for (const tool of tools) {
      const result = await tool.handler({});
      expect(result).toEqual({ status: "not-implemented" });
    }
  });

  it("all tool names are unique", () => {
    const tools = createToolDefinitions();
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("rn-dev/clean requires 'mode' in inputSchema", () => {
    const tools = createToolDefinitions();
    const clean = tools.find((t) => t.name === "rn-dev/clean");
    expect(clean).toBeDefined();
    const required = (clean!.inputSchema as { required?: string[] }).required;
    expect(required).toContain("mode");
  });

  it("rn-dev/build requires 'platform' in inputSchema", () => {
    const tools = createToolDefinitions();
    const build = tools.find((t) => t.name === "rn-dev/build");
    expect(build).toBeDefined();
    const required = (build!.inputSchema as { required?: string[] }).required;
    expect(required).toContain("platform");
  });

  it("rn-dev/select-device requires 'deviceId' in inputSchema", () => {
    const tools = createToolDefinitions();
    const selectDevice = tools.find((t) => t.name === "rn-dev/select-device");
    expect(selectDevice).toBeDefined();
    const required = (
      selectDevice!.inputSchema as { required?: string[] }
    ).required;
    expect(required).toContain("deviceId");
  });

  it("rn-dev/fix-preflight requires 'check' in inputSchema", () => {
    const tools = createToolDefinitions();
    const fixPreflight = tools.find((t) => t.name === "rn-dev/fix-preflight");
    expect(fixPreflight).toBeDefined();
    const required = (
      fixPreflight!.inputSchema as { required?: string[] }
    ).required;
    expect(required).toContain("check");
  });

  it("rn-dev/save-profile requires 'name' in inputSchema", () => {
    const tools = createToolDefinitions();
    const saveProfile = tools.find((t) => t.name === "rn-dev/save-profile");
    expect(saveProfile).toBeDefined();
    const required = (
      saveProfile!.inputSchema as { required?: string[] }
    ).required;
    expect(required).toContain("name");
  });

  it("all inputSchemas are of type 'object'", () => {
    const tools = createToolDefinitions();
    for (const tool of tools) {
      const schema = tool.inputSchema as { type?: string };
      expect(schema.type).toBe("object");
    }
  });

  it("contains the expected set of tool names", () => {
    const tools = createToolDefinitions();
    const names = new Set(tools.map((t) => t.name));
    const expected = [
      "rn-dev/start-session",
      "rn-dev/stop-session",
      "rn-dev/list-sessions",
      "rn-dev/reload",
      "rn-dev/dev-menu",
      "rn-dev/metro-status",
      "rn-dev/metro-logs",
      "rn-dev/clean",
      "rn-dev/build",
      "rn-dev/install-deps",
      "rn-dev/list-devices",
      "rn-dev/select-device",
      "rn-dev/boot-device",
      "rn-dev/preflight",
      "rn-dev/fix-preflight",
      "rn-dev/list-worktrees",
      "rn-dev/create-worktree",
      "rn-dev/switch-worktree",
      "rn-dev/list-profiles",
      "rn-dev/get-profile",
      "rn-dev/save-profile",
      "rn-dev/run-lint",
      "rn-dev/run-typecheck",
    ];
    for (const name of expected) {
      expect(names.has(name), `missing tool: ${name}`).toBe(true);
    }
  });
});
