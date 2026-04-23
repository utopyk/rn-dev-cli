// Smoke tests for the `rn-dev module {…}` CLI surface. We exercise
// argument parsing + wiring (registerModuleCommands attaches six
// sub-commands to the program and commander resolves them). End-to-end
// tests that spawn a daemon + the CLI process are covered by the manual
// Phase 7 smoke flow documented in the handoff.

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerModuleCommands } from "../module-commands.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerModuleCommands(program);
  return program;
}

describe("registerModuleCommands", () => {
  it("registers exactly the six Phase 7 sub-commands", () => {
    const program = buildProgram();
    const moduleCmd = program.commands.find((c) => c.name() === "module");
    expect(moduleCmd).toBeDefined();
    const names = moduleCmd!.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      "disable",
      "enable",
      "install",
      "list",
      "restart",
      "uninstall",
    ]);
  });

  it("install sub-command declares every Phase 7 flag", () => {
    const program = buildProgram();
    const install = program.commands
      .find((c) => c.name() === "module")!
      .commands.find((c) => c.name() === "install")!;
    const flags = install.options.map((o) => o.flags).sort();
    expect(flags).toContain("--permissions <list>");
    expect(flags).toContain("--registry-url <url>");
    expect(flags).toContain("--accept-registry-sha <sha>");
    // `--yes, -y` commander renders as "--yes, -y" — just assert the long form.
    expect(flags.some((f) => f.includes("--yes"))).toBe(true);
  });

  it("uninstall sub-command declares --keep-data", () => {
    const program = buildProgram();
    const uninstall = program.commands
      .find((c) => c.name() === "module")!
      .commands.find((c) => c.name() === "uninstall")!;
    const flags = uninstall.options.map((o) => o.flags);
    expect(flags).toContain("--keep-data");
  });

  it("list/enable/disable/restart commands take no flags (they dispatch over IPC)", () => {
    const program = buildProgram();
    const moduleCmd = program.commands.find((c) => c.name() === "module")!;
    for (const name of ["list", "enable", "disable", "restart"]) {
      const cmd = moduleCmd.commands.find((c) => c.name() === name)!;
      // Commander accepts 0 declared options for list; the others take a
      // required <moduleId> positional with no flags.
      expect(cmd.options).toEqual([]);
    }
  });
});
