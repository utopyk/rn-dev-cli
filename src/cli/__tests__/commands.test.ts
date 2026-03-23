import { describe, it, expect } from "vitest";
import { createProgram } from "../commands.js";
import type { Command } from "commander";

describe("createProgram", () => {
  it("returns a Command instance", () => {
    const program = createProgram();
    expect(program).toBeDefined();
    expect(typeof program.parse).toBe("function");
  });

  it("has name rn-dev", () => {
    const program = createProgram();
    expect(program.name()).toBe("rn-dev");
  });

  it("has version 0.1.0", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.1.0");
  });

  describe("start command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start");
      expect(cmd).toBeDefined();
    });

    it("has --interactive option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--interactive");
      expect(opt).toBeDefined();
    });

    it("has --profile option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--profile");
      expect(opt).toBeDefined();
    });

    it("has --platform option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--platform");
      expect(opt).toBeDefined();
    });

    it("has --mode option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--mode");
      expect(opt).toBeDefined();
    });

    it("has --port option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--port");
      expect(opt).toBeDefined();
    });

    it("has --theme option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start")!;
      const opt = cmd.options.find((o) => o.long === "--theme");
      expect(opt).toBeDefined();
    });
  });

  describe("profiles command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "profiles");
      expect(cmd).toBeDefined();
    });
  });

  describe("devices command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "devices");
      expect(cmd).toBeDefined();
    });

    it("has --platform option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "devices")!;
      const opt = cmd.options.find((o) => o.long === "--platform");
      expect(opt).toBeDefined();
    });
  });

  describe("worktrees command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "worktrees");
      expect(cmd).toBeDefined();
    });
  });

  describe("clean command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "clean");
      expect(cmd).toBeDefined();
    });

    it("has --mode option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "clean")!;
      const opt = cmd.options.find((o) => o.long === "--mode");
      expect(opt).toBeDefined();
    });
  });

  describe("preflight command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "preflight");
      expect(cmd).toBeDefined();
    });

    it("has --fix option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "preflight")!;
      const opt = cmd.options.find((o) => o.long === "--fix");
      expect(opt).toBeDefined();
    });
  });

  describe("reload command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "reload");
      expect(cmd).toBeDefined();
    });
  });

  describe("dev-menu command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "dev-menu");
      expect(cmd).toBeDefined();
    });
  });

  describe("lint command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "lint");
      expect(cmd).toBeDefined();
    });
  });

  describe("typecheck command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "typecheck");
      expect(cmd).toBeDefined();
    });
  });

  describe("mcp command", () => {
    it("exists", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "mcp");
      expect(cmd).toBeDefined();
    });
  });
});
