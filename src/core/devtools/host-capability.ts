/**
 * Devtools host capability — Phase 9. Exposes the `DevToolsManager` query
 * surface to 3p module subprocesses via the module capability registry.
 *
 * Tunneled over vscode-jsonrpc `host/call`: inside a module subprocess,
 * `ctx.host.capability<DevtoolsHostCapability>("devtools")` round-trips
 * each method back to the daemon, where it resolves against the manager
 * instance registered at `startServicesAsync` time.
 *
 * The DTO layer (redaction, `captureBodies`) lives in the module
 * subprocess — this capability returns raw `NetworkEntry` / `CaptureMeta`
 * values. Trust boundary: the module is spawned by the host, so bodies
 * cross the vscode-jsonrpc pipe unredacted. The module is responsible
 * for applying MCP-facing redaction before emitting a DTO to its caller.
 */

import type { DevToolsManager } from "../devtools.js";
import type {
  CaptureListResult,
  CaptureMeta,
  DevToolsStatus,
  NetworkEntry,
  NetworkFilter,
} from "./types.js";

export const DEVTOOLS_CAPABILITY_ID = "devtools" as const;
export const DEVTOOLS_CAPABILITY_PERMISSION = "devtools:capture" as const;

export interface DevtoolsListArgs {
  worktreeKey?: string;
  filter?: NetworkFilter;
}

export interface DevtoolsGetArgs {
  worktreeKey?: string;
  requestId: string;
}

export interface DevtoolsSelectTargetArgs {
  worktreeKey?: string;
  targetId: string;
}

export interface DevtoolsClearArgs {
  worktreeKey?: string;
}

export interface DevtoolsHostCapability {
  status(worktreeKey?: string): Promise<DevToolsStatus>;
  list(args: DevtoolsListArgs): Promise<CaptureListResult<NetworkEntry>>;
  get(args: DevtoolsGetArgs): Promise<NetworkEntry | null>;
  selectTarget(
    args: DevtoolsSelectTargetArgs
  ): Promise<{ status: "switched"; meta: CaptureMeta }>;
  clear(
    args: DevtoolsClearArgs
  ): Promise<{ status: "cleared"; meta: CaptureMeta }>;
}

export function createDevtoolsHostCapability(
  manager: DevToolsManager,
  defaultWorktreeKey: string
): DevtoolsHostCapability {
  const resolve = (wk?: string): string =>
    typeof wk === "string" && wk.length > 0 ? wk : defaultWorktreeKey;

  return {
    async status(wk) {
      return manager.status(resolve(wk));
    },
    async list({ worktreeKey, filter }) {
      return manager.listNetwork(resolve(worktreeKey), filter);
    },
    async get({ worktreeKey, requestId }) {
      return manager.getNetwork(resolve(worktreeKey), requestId);
    },
    async selectTarget({ worktreeKey, targetId }) {
      const wk = resolve(worktreeKey);
      await manager.selectTarget(wk, targetId);
      return { status: "switched", meta: manager.status(wk).meta };
    },
    async clear({ worktreeKey }) {
      const wk = resolve(worktreeKey);
      manager.clear(wk);
      return { status: "cleared", meta: manager.status(wk).meta };
    },
  };
}
