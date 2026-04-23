// `rn-dev module {install, uninstall, list, enable, disable, restart}` CLI.
// Split from commands.ts so the sub-commands + their helpers stay in one
// file. Commands that operate on live state (list/enable/disable/restart)
// talk to a running daemon over the unix-socket `IpcClient`. Install/
// uninstall work standalone — the marketplace installer only needs file-
// system access + pacote/arborist — and best-effort notify any running
// daemon so its ModuleRegistry picks the new module up without a restart.

import { Command } from "commander";
import path from "node:path";
import { homedir } from "node:os";
import { detectProjectRoot } from "../core/project.js";
import { IpcClient, type IpcMessage } from "../core/ipc.js";
import { ModuleRegistry } from "../modules/registry.js";
import {
  installModule,
  uninstallModule,
  type InstallResult,
} from "../modules/marketplace/installer.js";
import { RegistryFetcher } from "../modules/marketplace/registry.js";

export function registerModuleCommands(program: Command): void {
  const module = program
    .command("module")
    .description("Manage rn-dev modules (install, uninstall, list, enable/disable, restart)");

  module
    .command("list")
    .description("List registered modules (requires a running rn-dev daemon)")
    .action(async () => {
      const client = await getDaemonClient();
      const reply = await client.request({
        type: "command",
        action: "modules/list",
        payload: {},
        id: newId(),
      });
      const rows = extract<{ modules: Array<Record<string, unknown>> }>(reply, "modules");
      if (!rows || rows.modules.length === 0) {
        console.log("No modules registered.");
        return;
      }
      console.log("\nModules:\n");
      for (const row of rows.modules) {
        const id = String(row["id"] ?? "?");
        const version = String(row["version"] ?? "?");
        const kind = String(row["kind"] ?? "?");
        const state = String(row["state"] ?? "?");
        const builtIn = row["isBuiltIn"] ? " [built-in]" : "";
        console.log(`  ${id}${builtIn}  v${version}  ${kind}  ${state}`);
      }
      console.log();
    });

  module
    .command("install <moduleId>")
    .description("Install a module from the curated registry")
    .option(
      "--permissions <list>",
      "Comma-separated permissions to accept (default: accept every declared permission)",
    )
    .option(
      "--registry-url <url>",
      "Override the registry URL (file://... or https://...)",
    )
    .option("--accept-registry-sha <sha>", "Accept a specific modules.json SHA-256")
    .option("--yes, -y", "Skip the confirmation prompt")
    .action(async (moduleId: string, opts: InstallCliOptions) => {
      const fetcher = new RegistryFetcher();
      const fetchOpts = {
        ...(opts.registryUrl !== undefined ? { url: opts.registryUrl } : {}),
        ...(opts.acceptRegistrySha !== undefined
          ? { expectedSha: opts.acceptRegistrySha }
          : {}),
      };
      const fetched = await fetcher.fetch(fetchOpts);
      if (fetched.kind === "error") {
        console.error(`registry fetch failed: ${fetched.code} — ${fetched.message}`);
        process.exit(1);
      }
      const entry = fetched.registry.modules.find((m) => m.id === moduleId);
      if (!entry) {
        console.error(`module "${moduleId}" is not in the curated registry`);
        process.exit(1);
      }

      const permissionsAccepted = opts.permissions
        ? opts.permissions.split(",").map((p) => p.trim()).filter(Boolean)
        : entry.permissions;
      const missing = entry.permissions.filter(
        (p) => !permissionsAccepted.includes(p),
      );
      if (missing.length > 0) {
        console.error(
          `missing permission acceptances: ${missing.join(", ")}. ` +
            `Pass --permissions=${entry.permissions.join(",")} or omit --permissions to accept all.`,
        );
        process.exit(1);
      }

      if (!opts.yes) {
        console.log("\nInstalling:");
        console.log(`  ${entry.id} v${entry.version} — ${entry.description}`);
        console.log(`  author:      ${entry.author}`);
        console.log(`  permissions: ${entry.permissions.join(", ") || "(none)"}`);
        console.log(`  sha256:      ${entry.tarballSha256}`);
        console.log("\nRe-run with --yes to confirm.");
        process.exit(1);
      }

      // Thread `thirdPartyAcknowledged: true` by default from the CLI —
      // an explicit --yes on a terminal is the acknowledgment moment
      // mirroring the GUI consent dialog's toggle.
      const registry = new ModuleRegistry();
      const result: InstallResult = await installModule({
        entry,
        permissionsAccepted,
        registry,
        hostVersion: "0.1.0",
        thirdPartyAcknowledged: true,
      });
      if (result.kind === "error") {
        console.error(`install failed (${result.code}): ${result.message}`);
        process.exit(1);
      }
      console.log(
        `installed ${result.module.manifest.id} v${result.module.manifest.version} at ${result.installPath}`,
      );

      // Best-effort notify a running daemon so the new module shows up
      // immediately. Refresh via the `modules/list` round-trip — the
      // daemon will have re-scanned `~/.rn-dev/modules/` on startup, but
      // a running session needs a manual nudge. For now we just print
      // a note; Phase 8 wires a `modules/rescan` action.
      const daemon = await tryDaemonClient();
      if (daemon) {
        console.log(
          "note: a daemon is running — restart it to pick up the new module (rescan is deferred).",
        );
      }
    });

  module
    .command("uninstall <moduleId>")
    .description("Uninstall a module and remove its files")
    .option("--keep-data", "Preserve ~/.rn-dev/modules/<id>/data/ (retention GC: Phase 8)")
    .action(async (moduleId: string, opts: { keepData?: boolean }) => {
      // Prefer the daemon's uninstall path — it tears down the live
      // subprocess in addition to removing the files. Fall back to the
      // standalone installer if no daemon is reachable.
      const daemon = await tryDaemonClient();
      if (daemon) {
        const reply = await daemon.request({
          type: "command",
          action: "modules/uninstall",
          payload: { moduleId, keepData: !!opts.keepData },
          id: newId(),
        });
        const payload = reply.payload as { kind?: string; code?: string; message?: string; removed?: string };
        if (payload?.kind === "ok") {
          console.log(`uninstalled ${moduleId} (removed ${payload.removed ?? ""})`);
          return;
        }
        console.error(
          `uninstall failed${payload?.code ? ` (${payload.code})` : ""}: ${payload?.message ?? "unknown"}`,
        );
        process.exit(1);
      }

      const registry = new ModuleRegistry();
      const result = await uninstallModule({
        moduleId,
        registry,
        ...(opts.keepData !== undefined ? { keepData: opts.keepData } : {}),
      });
      if (result.kind === "error") {
        console.error(`uninstall failed (${result.code}): ${result.message}`);
        process.exit(1);
      }
      console.log(`uninstalled ${moduleId} (removed ${result.removed})`);
    });

  module
    .command("enable <moduleId>")
    .description("Enable a previously disabled module")
    .action(async (moduleId: string) => {
      const client = await getDaemonClient();
      const reply = await client.request({
        type: "command",
        action: "modules/enable",
        payload: { moduleId },
        id: newId(),
      });
      const payload = reply.payload as { status?: string; error?: string };
      if (payload?.error) {
        console.error(payload.error);
        process.exit(1);
      }
      console.log(`enabled ${moduleId}`);
    });

  module
    .command("disable <moduleId>")
    .description("Disable a module — shuts down its subprocess + skips on reload")
    .action(async (moduleId: string) => {
      const client = await getDaemonClient();
      const reply = await client.request({
        type: "command",
        action: "modules/disable",
        payload: { moduleId },
        id: newId(),
      });
      const payload = reply.payload as { status?: string; error?: string };
      if (payload?.error) {
        console.error(payload.error);
        process.exit(1);
      }
      console.log(`disabled ${moduleId}`);
    });

  module
    .command("restart <moduleId>")
    .description("Restart a module's subprocess")
    .action(async (moduleId: string) => {
      const client = await getDaemonClient();
      const reply = await client.request({
        type: "command",
        action: "modules/restart",
        payload: { moduleId },
        id: newId(),
      });
      const payload = reply.payload as { status?: string; pid?: number; error?: string };
      if (payload?.error) {
        console.error(payload.error);
        process.exit(1);
      }
      console.log(`restarted ${moduleId}${payload?.pid ? ` (pid ${payload.pid})` : ""}`);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InstallCliOptions {
  permissions?: string;
  registryUrl?: string;
  acceptRegistrySha?: string;
  yes?: boolean;
}

function newId(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extract<T>(msg: IpcMessage, key: keyof T): T | null {
  if (
    msg &&
    typeof msg === "object" &&
    msg.payload &&
    typeof msg.payload === "object" &&
    key in (msg.payload as Record<string, unknown>)
  ) {
    return msg.payload as unknown as T;
  }
  return null;
}

/**
 * Resolve the daemon socket. In order of precedence:
 *   1. `RN_DEV_DAEMON_SOCK` env var — escape hatch for CI / tests.
 *   2. `<projectRoot>/.rn-dev/sock` if the current directory is inside
 *      an rn-dev project — matches the `reload` / `dev-menu` commands.
 *   3. `~/.rn-dev/sock` — user-global fallback. Not currently wired on
 *      the server side; reserved for a Phase 8 global daemon.
 */
function candidateSockets(): string[] {
  const out: string[] = [];
  const env = process.env["RN_DEV_DAEMON_SOCK"];
  if (env) out.push(env);
  const projectRoot = detectProjectRoot(process.cwd());
  if (projectRoot) out.push(path.join(projectRoot, ".rn-dev", "sock"));
  out.push(path.join(homedir(), ".rn-dev", "sock"));
  return out;
}

async function tryDaemonClient(): Promise<DaemonClient | null> {
  for (const socketPath of candidateSockets()) {
    const client = new IpcClient(socketPath);
    try {
      const running = await client.isServerRunning();
      if (running) return new DaemonClient(client);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function getDaemonClient(): Promise<DaemonClient> {
  const client = await tryDaemonClient();
  if (client) return client;
  console.error(
    "No running rn-dev daemon. Start one via `rn-dev start` (or set RN_DEV_DAEMON_SOCK to an existing socket).",
  );
  process.exit(1);
}

class DaemonClient {
  constructor(private client: IpcClient) {}

  async request(message: IpcMessage): Promise<IpcMessage> {
    const reply = await this.client.send(message);
    if (!reply) {
      throw new Error("daemon returned no reply");
    }
    return reply;
  }
}
