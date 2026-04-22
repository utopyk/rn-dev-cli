/**
 * Devtools IPC dispatcher — Phase 3 Track A.
 *
 * Wires the five `devtools/*` actions that Track B's MCP tools call into
 * the running `DevToolsManager`. The MCP server (separate process) talks
 * to the host here via the unix-socket `IpcServer` started by start-flow.
 *
 * Action shapes match what `src/mcp/tools.ts` sends:
 *
 *   devtools/status          payload: { worktree?: string }
 *     reply payload:         DevToolsStatus
 *
 *   devtools/list            payload: { worktree?: string, urlRegex?, methods?, ... }
 *     reply payload:         CaptureListResult<NetworkEntry>
 *
 *   devtools/get             payload: { worktree?: string, requestId: string }
 *     reply payload:         NetworkEntry | null
 *
 *   devtools/select-target   payload: { worktree?: string, targetId: string }
 *     reply payload:         { status: 'switched', meta: CaptureMeta } | { error: string }
 *
 *   devtools/clear           payload: { worktree?: string }
 *     reply payload:         { status: 'cleared', meta: CaptureMeta }
 *
 * Worktree resolution: if `payload.worktree` is provided, it must match an
 * existing worktreeKey the manager knows about. Otherwise we fall back to
 * the default worktreeKey passed to `registerDevtoolsIpc`. Returning a
 * non-matching worktreeKey reply is acceptable — the manager's query APIs
 * return a clean `no-target` CaptureListResult for unknown worktrees.
 *
 * The dispatcher is scoped to devtools/* actions only; it does NOT
 * interfere with other IPC traffic (unknown actions simply pass through
 * without a reply, matching the pre-existing behavior where no other
 * dispatcher was wired at all).
 */

import type { DevToolsManager } from "../core/devtools.js";
import type { IpcMessage, IpcServer, IpcMessageEvent } from "../core/ipc.js";
import type { NetworkFilter } from "../core/devtools/types.js";

// ---------------------------------------------------------------------------
// Types — shared with tests
// ---------------------------------------------------------------------------

export interface DevtoolsIpcOptions {
  /** The running manager. Messages are dispatched against it. */
  manager: DevToolsManager;
  /** Worktree key to use when a payload omits `worktree`. */
  defaultWorktreeKey: string;
}

export type DevtoolsIpcAction =
  | "devtools/status"
  | "devtools/list"
  | "devtools/get"
  | "devtools/select-target"
  | "devtools/clear";

const DEVTOOLS_ACTIONS: ReadonlySet<string> = new Set<DevtoolsIpcAction>([
  "devtools/status",
  "devtools/list",
  "devtools/get",
  "devtools/select-target",
  "devtools/clear",
]);

// ---------------------------------------------------------------------------
// Dispatcher — pure function over (manager, msg) → response payload.
// Exported for unit testing without spinning up a real IpcServer.
// ---------------------------------------------------------------------------

export async function dispatchDevtoolsAction(
  opts: DevtoolsIpcOptions,
  msg: IpcMessage
): Promise<unknown> {
  const { manager, defaultWorktreeKey } = opts;
  const payload = (msg.payload as Record<string, unknown> | undefined) ?? {};
  const worktree =
    typeof payload.worktree === "string" && payload.worktree.length > 0
      ? payload.worktree
      : defaultWorktreeKey;

  switch (msg.action) {
    case "devtools/status":
      return manager.status(worktree);

    case "devtools/list": {
      const filter: NetworkFilter = {
        urlRegex: typeof payload.urlRegex === "string" ? payload.urlRegex : undefined,
        methods: Array.isArray(payload.methods)
          ? (payload.methods as unknown[]).filter((m): m is string => typeof m === "string")
          : undefined,
        statusRange: Array.isArray(payload.statusRange) && payload.statusRange.length === 2
          ? ([payload.statusRange[0], payload.statusRange[1]] as [number, number])
          : undefined,
        since: payload.since as NetworkFilter["since"],
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      };
      return manager.listNetwork(worktree, filter);
    }

    case "devtools/get": {
      const requestId =
        typeof payload.requestId === "string" ? payload.requestId : "";
      if (!requestId) return null;
      return manager.getNetwork(worktree, requestId);
    }

    case "devtools/select-target": {
      const targetId =
        typeof payload.targetId === "string" ? payload.targetId : "";
      if (!targetId) {
        return { error: "missing-targetId" };
      }
      try {
        await manager.selectTarget(worktree, targetId);
        return { status: "switched", meta: manager.status(worktree).meta };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "devtools/clear": {
      manager.clear(worktree);
      return { status: "cleared", meta: manager.status(worktree).meta };
    }

    default:
      return { error: "unknown-action", action: msg.action };
  }
}

// ---------------------------------------------------------------------------
// registerDevtoolsIpc — attach dispatcher to a live IpcServer
// ---------------------------------------------------------------------------

/**
 * Subscribes to the IpcServer's `message` event and routes devtools/*
 * actions. Returns an unsubscribe function for cleanup on Metro retry or
 * manager re-creation (stale closures over the old manager would be a
 * bug).
 */
export function registerDevtoolsIpc(
  ipc: IpcServer,
  opts: DevtoolsIpcOptions
): () => void {
  const handler = async (evt: IpcMessageEvent): Promise<void> => {
    const { message, reply } = evt;
    if (!DEVTOOLS_ACTIONS.has(message.action)) return; // not ours
    try {
      const payload = await dispatchDevtoolsAction(opts, message);
      reply({
        type: "response",
        action: message.action,
        id: message.id,
        payload,
      });
    } catch (err) {
      reply({
        type: "response",
        action: message.action,
        id: message.id,
        payload: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  ipc.on("message", handler);
  return () => {
    ipc.off("message", handler);
  };
}
