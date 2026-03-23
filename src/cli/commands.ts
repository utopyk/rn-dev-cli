import { Command } from "commander";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rn-dev")
    .description("React Native developer CLI")
    .version("0.1.0");

  // Start command — the main entry point
  program
    .command("start")
    .description("Start development session")
    .option("-i, --interactive", "Force interactive wizard")
    .option("-p, --profile <name>", "Load specific profile")
    .option("--worktree <path>", "Specify worktree")
    .option("--platform <platform>", "ios, android, or both")
    .option("--mode <mode>", "dirty, clean, or ultra-clean")
    .option("--port <port>", "Metro port", parseInt)
    .option("--theme <name>", "Theme name")
    .action(async (_options) => {
      // Placeholder — wired in Task 18
    });

  // Profiles
  program
    .command("profiles")
    .description("List profiles")
    .action(async () => { /* placeholder */ });

  program
    .command("profiles:default <name>")
    .description("Set default profile for current worktree+branch")
    .action(async (_name) => { /* placeholder */ });

  // Devices
  program
    .command("devices")
    .description("List available devices")
    .option("--platform <platform>", "ios, android, or both", "both")
    .action(async (_options) => { /* placeholder */ });

  // Worktrees
  program
    .command("worktrees")
    .description("List git worktrees and their session status")
    .action(async () => { /* placeholder */ });

  // Clean
  program
    .command("clean")
    .description("Run clean operations")
    .option("--mode <mode>", "dirty, clean, or ultra-clean", "clean")
    .option("--platform <platform>", "ios, android, or both", "both")
    .action(async (_options) => { /* placeholder */ });

  // Preflight
  program
    .command("preflight")
    .description("Run preflight checks")
    .option("--fix", "Auto-fix fixable issues")
    .option("--platform <platform>", "ios, android, or both", "both")
    .action(async (_options) => { /* placeholder */ });

  // Metro control
  program
    .command("reload")
    .description("Reload the running app")
    .action(async () => { /* placeholder */ });

  program
    .command("dev-menu")
    .description("Open device dev menu")
    .action(async () => { /* placeholder */ });

  // Tools
  program
    .command("lint")
    .description("Run project linter")
    .action(async () => { /* placeholder */ });

  program
    .command("typecheck")
    .description("Run TypeScript type checking")
    .action(async () => { /* placeholder */ });

  // MCP server
  program
    .command("mcp")
    .description("Start MCP server (stdio transport)")
    .action(async () => { /* placeholder */ });

  return program;
}
