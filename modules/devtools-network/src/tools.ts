/**
 * MCP tool handlers for `@rn-dev-modules/devtools-network`. Each handler
 * fans out to the `devtools` host capability, applies S5 body redaction
 * via the module's `captureBodies` config, and returns a stable DTO.
 */

import type { ModuleToolContext } from "@rn-dev/module-sdk";
import {
  DEVTOOLS_CAPABILITY_ID,
  type DevtoolsHostCapability,
} from "./host-capability.js";
import {
  toDto,
  toListDto,
  type DevToolsListDto,
  type NetworkEntryDto,
} from "./dto.js";
import type { NetworkFilter } from "./types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveCapability(ctx: ModuleToolContext): DevtoolsHostCapability {
  const cap = ctx.host.capability<DevtoolsHostCapability>(DEVTOOLS_CAPABILITY_ID);
  if (!cap) {
    throw new Error(
      `Host capability "${DEVTOOLS_CAPABILITY_ID}" unavailable — the daemon did not register one, or this module lacks the "devtools:capture" permission.`
    );
  }
  return cap;
}

function readCaptureBodies(ctx: ModuleToolContext): boolean {
  return ctx.config.captureBodies === true;
}

function extractFilter(args: ListArgs): NetworkFilter | undefined {
  const filter: NetworkFilter = {};
  if (typeof args.urlRegex === "string") filter.urlRegex = args.urlRegex;
  if (Array.isArray(args.methods)) {
    filter.methods = args.methods.filter(
      (m): m is string => typeof m === "string"
    );
  }
  if (
    Array.isArray(args.statusRange) &&
    args.statusRange.length === 2 &&
    typeof args.statusRange[0] === "number" &&
    typeof args.statusRange[1] === "number"
  ) {
    filter.statusRange = [args.statusRange[0], args.statusRange[1]];
  }
  if (args.since && typeof args.since === "object") {
    filter.since = args.since as NetworkFilter["since"];
  }
  if (typeof args.limit === "number") filter.limit = args.limit;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface StatusArgs {
  worktree?: string;
}

export interface ListArgs {
  worktree?: string;
  urlRegex?: string;
  methods?: unknown[];
  statusRange?: unknown[];
  since?: unknown;
  limit?: number;
}

export interface GetArgs {
  worktree?: string;
  requestId: string;
}

export interface SelectTargetArgs {
  worktree?: string;
  targetId: string;
}

export interface ClearArgs {
  worktree?: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function status(args: StatusArgs, ctx: ModuleToolContext) {
  const cap = resolveCapability(ctx);
  const st = await cap.status(args.worktree);
  return {
    meta: st.meta,
    targets: st.targets,
    rnVersion: st.rnVersion,
    proxyPort: st.proxyPort,
    sessionNonce: st.sessionNonce,
    bodyCaptureEnabled: readCaptureBodies(ctx),
  };
}

export async function list(
  args: ListArgs,
  ctx: ModuleToolContext
): Promise<DevToolsListDto> {
  const cap = resolveCapability(ctx);
  const result = await cap.list({
    worktreeKey: args.worktree,
    filter: extractFilter(args),
  });
  return toListDto(result, { captureBodies: readCaptureBodies(ctx) });
}

export async function get(
  args: GetArgs,
  ctx: ModuleToolContext
): Promise<NetworkEntryDto | { error: "not-found"; requestId: string }> {
  const cap = resolveCapability(ctx);
  const entry = await cap.get({
    worktreeKey: args.worktree,
    requestId: args.requestId,
  });
  if (!entry) return { error: "not-found", requestId: args.requestId };
  return toDto(entry, { captureBodies: readCaptureBodies(ctx) });
}

export async function selectTarget(
  args: SelectTargetArgs,
  ctx: ModuleToolContext
): Promise<{ status: "switched"; meta: unknown }> {
  const cap = resolveCapability(ctx);
  return cap.selectTarget({
    worktreeKey: args.worktree,
    targetId: args.targetId,
  });
}

export async function clear(
  args: ClearArgs,
  ctx: ModuleToolContext
): Promise<{ status: "cleared"; meta: unknown }> {
  const cap = resolveCapability(ctx);
  return cap.clear({ worktreeKey: args.worktree });
}
