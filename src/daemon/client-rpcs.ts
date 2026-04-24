// Client-facing RPC handlers. Every message here requires a running
// session — the daemon holds exactly one supervisor per worktree, and
// the session's wired services back every call. RPCs that arrive while
// the session is stopped or starting respond with E_SESSION_NOT_RUNNING
// so clients can show a coherent "daemon up, session down" state rather
// than silently hanging.
//
// One daemon = one worktree, so no worktreeKey is accepted from the
// client — the supervisor supplies its own. Accepting a client-provided
// worktreeKey would let a compromised client address another worktree's
// services if we ever relax the 1:1 rule.

import type { IpcMessage, IpcMessageEvent } from "../core/ipc.js";
import type { DaemonSupervisor } from "./supervisor.js";
import type { SessionServices } from "../core/session/boot.js";
import type { BuildOptions } from "../core/builder.js";

const CLIENT_RPC_ACTIONS = new Set<string>([
  "metro/reload",
  "metro/devMenu",
  "metro/getInstance",
  "devtools/listNetwork",
  "devtools/status",
  "devtools/clear",
  "devtools/selectTarget",
  "builder/build",
  "watcher/start",
  "watcher/stop",
  "watcher/isRunning",
]);

export function isClientRpcAction(action: string): boolean {
  return CLIENT_RPC_ACTIONS.has(action);
}

export async function handleClientRpc(
  event: IpcMessageEvent,
  supervisor: DaemonSupervisor,
): Promise<void> {
  const { message, reply } = event;
  const services = supervisor.getServices();
  if (!services) {
    reply({
      type: "response",
      action: message.action,
      id: message.id,
      payload: {
        code: "E_SESSION_NOT_RUNNING",
        message:
          "no session is currently running — call session/start before issuing client RPCs",
      },
    });
    return;
  }

  try {
    const payload = await dispatch(message, services);
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
        code: "E_RPC_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function dispatch(
  message: IpcMessage,
  services: SessionServices,
): Promise<unknown> {
  switch (message.action) {
    case "metro/reload": {
      const ok = services.metro.reload(services.worktreeKey);
      return { ok };
    }
    case "metro/devMenu": {
      const ok = services.metro.devMenu(services.worktreeKey);
      return { ok };
    }
    case "metro/getInstance": {
      return { instance: services.metro.getInstance(services.worktreeKey) };
    }
    case "devtools/listNetwork": {
      const filter = readObjectField(message.payload, "filter");
      const list = services.devtools.listNetwork(
        services.worktreeKey,
        filter as Parameters<typeof services.devtools.listNetwork>[1],
      );
      return list;
    }
    case "devtools/status": {
      return services.devtools.status(services.worktreeKey);
    }
    case "devtools/clear": {
      services.devtools.clear(services.worktreeKey);
      return { ok: true };
    }
    case "devtools/selectTarget": {
      const targetId = readStringField(message.payload, "targetId");
      if (!targetId) {
        return {
          code: "E_RPC_INVALID_PAYLOAD",
          message: "devtools/selectTarget: targetId is required",
        };
      }
      await services.devtools.selectTarget(services.worktreeKey, targetId);
      return { ok: true };
    }
    case "builder/build": {
      const opts = readBuildOptions(message.payload);
      if (!opts) {
        return {
          code: "E_RPC_INVALID_PAYLOAD",
          message:
            "builder/build: payload must include { projectRoot, platform, port, variant }",
        };
      }
      services.builder.build(opts);
      return { ok: true };
    }
    case "watcher/start": {
      if (!services.watcher) {
        return { ok: false, reason: "E_NO_WATCHER_CONFIGURED" };
      }
      services.watcher.start();
      return { ok: true };
    }
    case "watcher/stop": {
      if (!services.watcher) {
        return { ok: false, reason: "E_NO_WATCHER_CONFIGURED" };
      }
      services.watcher.stop();
      return { ok: true };
    }
    case "watcher/isRunning": {
      return { running: services.watcher?.isRunning() ?? false };
    }
    default:
      throw new Error(`client-rpcs.dispatch: unknown action ${message.action}`);
  }
}

function readStringField(
  payload: unknown,
  key: string,
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function readObjectField(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as Record<string, unknown>)[key];
}

function readBuildOptions(payload: unknown): BuildOptions | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const projectRoot = typeof p.projectRoot === "string" ? p.projectRoot : null;
  const platform =
    p.platform === "ios" || p.platform === "android" ? p.platform : null;
  const port = typeof p.port === "number" ? p.port : null;
  const variant =
    p.variant === "debug" || p.variant === "release" ? p.variant : null;
  if (!projectRoot || !platform || port == null || !variant) return null;
  const deviceId = typeof p.deviceId === "string" ? p.deviceId : undefined;
  const env =
    p.env && typeof p.env === "object"
      ? (p.env as Record<string, string>)
      : undefined;
  return { projectRoot, platform, port, variant, deviceId, env };
}
