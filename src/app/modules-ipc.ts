/**
 * Modules IPC dispatcher — Phase 3a.
 *
 * Wires the module-lifecycle actions that `src/mcp/tools.ts` calls into the
 * running `ModuleHostManager` + `ModuleRegistry` on the daemon side. The MCP
 * server (separate process) talks to the host here via the unix-socket
 * `IpcServer` started by `start-flow.ts`.
 *
 * Action shapes — all three use `{ moduleId, scopeUnit? }` payloads:
 *
 *   modules/list           payload: {}
 *     reply: { modules: Array<RegisteredModuleRow> }
 *
 *   modules/status         payload: { moduleId: string, scopeUnit?: string }
 *     reply: RegisteredModuleRow | null
 *
 *   modules/restart        payload: { moduleId: string, scopeUnit?: string }
 *     reply: { status: "restarted", pid } | { error: string }
 *
 * Scope resolution: if `scopeUnit` is omitted, we look for any registered
 * manifest matching the moduleId regardless of scope and pick the first.
 *
 * Future Phase 3b surface (intentionally not here):
 *   - modules/enable + modules/disable (persistent toggle + MCP tools/listChanged)
 *   - module-contributed tool proxying (<moduleId>__<tool> routed via moduleHost)
 *   - destructiveHint runtime confirmation
 */

import type { IpcMessage, IpcServer, IpcMessageEvent } from "../core/ipc.js";
import type {
  ModuleHostManager,
} from "../core/module-host/manager.js";
import type {
  ModuleRegistry,
  RegisteredModule,
} from "../modules/registry.js";
import type { ModuleInstanceState } from "../core/module-host/instance.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ModulesIpcOptions {
  manager: ModuleHostManager;
  registry: ModuleRegistry;
}

export type ModulesIpcAction =
  | "modules/list"
  | "modules/status"
  | "modules/restart";

const MODULES_ACTIONS: ReadonlySet<string> = new Set<ModulesIpcAction>([
  "modules/list",
  "modules/status",
  "modules/restart",
]);

export interface RegisteredModuleRow {
  id: string;
  version: string;
  scope: RegisteredModule["manifest"]["scope"];
  scopeUnit: string;
  state: ModuleInstanceState | "inert";
  isBuiltIn: boolean;
  /** Only populated after the module has ever spawned. */
  lastCrashReason: string | null;
  /** Only populated when the instance is live. */
  pid: number | null;
}

// ---------------------------------------------------------------------------
// Dispatcher — exported for unit tests
// ---------------------------------------------------------------------------

export async function dispatchModulesAction(
  opts: ModulesIpcOptions,
  msg: IpcMessage,
): Promise<unknown> {
  switch (msg.action) {
    case "modules/list":
      return { modules: listRows(opts) };
    case "modules/status":
      return statusRow(opts, msg.payload as { moduleId: string; scopeUnit?: string });
    case "modules/restart":
      return restart(opts, msg.payload as { moduleId: string; scopeUnit?: string });
    default:
      throw new Error(
        `[modules-ipc] unreachable: action=${msg.action}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

export function registerModulesIpc(
  ipc: IpcServer,
  options: ModulesIpcOptions,
): { unregister: () => void } {
  const listener = (event: IpcMessageEvent): void => {
    if (!MODULES_ACTIONS.has(event.message.action)) return;
    void dispatchModulesAction(options, event.message)
      .then((payload) => {
        event.reply({
          type: "response",
          action: event.message.action,
          payload,
          id: event.message.id,
        });
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err);
        event.reply({
          type: "response",
          action: event.message.action,
          payload: { error: message },
          id: event.message.id,
        });
      });
  };
  ipc.on("message", listener);
  return {
    unregister: () => {
      ipc.off("message", listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function listRows(opts: ModulesIpcOptions): RegisteredModuleRow[] {
  return opts.registry.getAllManifests().map((reg) => rowFor(opts, reg));
}

function statusRow(
  opts: ModulesIpcOptions,
  payload: { moduleId: string; scopeUnit?: string },
): RegisteredModuleRow | null {
  if (!payload || typeof payload.moduleId !== "string") {
    return null;
  }
  const reg = resolveRegistered(opts, payload.moduleId, payload.scopeUnit);
  return reg ? rowFor(opts, reg) : null;
}

async function restart(
  opts: ModulesIpcOptions,
  payload: { moduleId: string; scopeUnit?: string },
): Promise<{ status: "restarted"; pid: number } | { error: string }> {
  if (!payload || typeof payload.moduleId !== "string") {
    return { error: "modules/restart requires { moduleId: string }" };
  }
  const reg = resolveRegistered(opts, payload.moduleId, payload.scopeUnit);
  if (!reg) {
    return {
      error: `unknown module "${payload.moduleId}"${payload.scopeUnit ? ` (scope "${payload.scopeUnit}")` : ""}`,
    };
  }

  try {
    await opts.manager.shutdown(reg.manifest.id, reg.scopeUnit);
    const consumerId = `modules-restart-${Date.now()}`;
    const managed = await opts.manager.acquire(reg, consumerId);
    // Release immediately — the restart API's contract is "module is up
    // again"; we don't hold a refcount on the caller's behalf.
    await opts.manager.release(reg.manifest.id, reg.scopeUnit, consumerId);
    return { status: "restarted", pid: managed.pid };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "restart failed",
    };
  }
}

function resolveRegistered(
  opts: ModulesIpcOptions,
  moduleId: string,
  scopeUnit: string | undefined,
): RegisteredModule | null {
  if (scopeUnit !== undefined) {
    return opts.registry.getManifest(moduleId, scopeUnit) ?? null;
  }
  // Match first by id regardless of scope — matches the ergonomic MCP
  // surface where agents rarely know the worktree key for a call.
  return (
    opts.registry
      .getAllManifests()
      .find((r) => r.manifest.id === moduleId) ?? null
  );
}

function rowFor(
  opts: ModulesIpcOptions,
  reg: RegisteredModule,
): RegisteredModuleRow {
  const live = opts.manager.inspect(reg.manifest.id, reg.scopeUnit);
  return {
    id: reg.manifest.id,
    version: reg.manifest.version,
    scope: reg.manifest.scope,
    scopeUnit: reg.scopeUnit,
    state: live?.state ?? "inert",
    isBuiltIn: reg.isBuiltIn,
    lastCrashReason: live?.lastCrashReason ?? null,
    pid: live?.pid ?? null,
  };
}
