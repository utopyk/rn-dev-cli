/**
 * DTO layer for DevTools MCP tools — security control S5.
 *
 * The internal `NetworkEntry` type is rich and may evolve. MCP agents see a
 * stable DTO shape. This layer is also where MCP-specific redaction happens:
 * without `captureBodies: true`, request/response bodies are returned as
 * `{ kind: 'redacted', reason: 'mcp-default' }` regardless of what the capture
 * layer stored. Electron and Ink see the raw entries directly from the
 * manager — MCP is the only surface that redacts bodies by default.
 *
 * MCP tool registration (Phase 3) will use these types as the `outputSchema`
 * reference. JSON Schema objects are hand-rolled to match; a unit test
 * verifies alignment.
 */

import type {
  CapturedBody,
  CaptureListResult,
  CaptureMeta,
  Initiator,
  NetworkEntry,
} from "../core/devtools/types.js";

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

export interface NetworkEntryDto {
  requestId: string;
  sequence: number;
  terminalState: "pending" | "finished" | "failed";
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody: CapturedBody;
  responseBody?: CapturedBody;
  timings: { startedAt: number; completedAt?: number; durationMs?: number };
  initiator?: Initiator;
  redirectChain?: string[];
  failureReason?: string;
}

export interface DtoOptions {
  /** If false, bodies are replaced with `kind: 'redacted', reason: 'mcp-default'`. */
  captureBodies: boolean;
}

export interface DevToolsListDto {
  entries: NetworkEntryDto[];
  cursorDropped: boolean;
  meta: CaptureMeta;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const REDACTED_BODY: CapturedBody = {
  kind: "redacted",
  reason: "mcp-default",
};

function projectBody(body: CapturedBody, opts: DtoOptions): CapturedBody {
  if (opts.captureBodies) return body;
  // If internal already says redacted/absent, pass through — no info leaks.
  if (body.kind === "redacted" || body.kind === "absent") return body;
  return REDACTED_BODY;
}

export function toDto(entry: NetworkEntry, opts: DtoOptions): NetworkEntryDto {
  const base: NetworkEntryDto = {
    requestId: entry.requestId,
    sequence: entry.sequence,
    terminalState: entry.terminalState,
    method: entry.method,
    url: entry.url,
    requestHeaders: { ...entry.requestHeaders },
    requestBody: projectBody(entry.requestBody, opts),
    timings: { startedAt: entry.timings.startedAt },
    initiator: entry.initiator,
    redirectChain: entry.redirectChain ? [...entry.redirectChain] : undefined,
  };
  if (entry.terminalState === "finished") {
    return {
      ...base,
      status: entry.status,
      statusText: entry.statusText,
      mimeType: entry.mimeType,
      responseHeaders: { ...entry.responseHeaders },
      responseBody: projectBody(entry.responseBody, opts),
      timings: {
        startedAt: entry.timings.startedAt,
        completedAt: entry.timings.completedAt,
        durationMs: entry.timings.durationMs,
      },
    };
  }
  if (entry.terminalState === "failed") {
    return {
      ...base,
      status: entry.status,
      responseHeaders: entry.responseHeaders ? { ...entry.responseHeaders } : undefined,
      failureReason: entry.failureReason,
      timings: {
        startedAt: entry.timings.startedAt,
        completedAt: entry.timings.completedAt,
        durationMs: entry.timings.durationMs,
      },
    };
  }
  return base;
}

export function toListDto(
  result: CaptureListResult<NetworkEntry>,
  opts: DtoOptions
): DevToolsListDto {
  const meta = opts.captureBodies
    ? result.meta
    : { ...result.meta, bodyCapture: "mcp-redacted" as const };
  return {
    entries: result.entries.map((e) => toDto(e, opts)),
    cursorDropped: result.cursorDropped,
    meta,
  };
}

// ---------------------------------------------------------------------------
// JSON Schema (hand-rolled — verified against the TS interface by tests)
// ---------------------------------------------------------------------------

export const NETWORK_ENTRY_DTO_SCHEMA = {
  type: "object",
  required: [
    "requestId",
    "sequence",
    "terminalState",
    "method",
    "url",
    "requestHeaders",
    "requestBody",
    "timings",
  ],
  properties: {
    requestId: { type: "string" },
    sequence: { type: "number" },
    terminalState: { type: "string", enum: ["pending", "finished", "failed"] },
    method: { type: "string" },
    url: { type: "string" },
    status: { type: "number" },
    statusText: { type: "string" },
    mimeType: { type: "string" },
    requestHeaders: { type: "object", additionalProperties: { type: "string" } },
    responseHeaders: { type: "object", additionalProperties: { type: "string" } },
    requestBody: { $ref: "#/definitions/CapturedBody" },
    responseBody: { $ref: "#/definitions/CapturedBody" },
    timings: {
      type: "object",
      required: ["startedAt"],
      properties: {
        startedAt: { type: "number" },
        completedAt: { type: "number" },
        durationMs: { type: "number" },
      },
    },
    initiator: { type: "object" },
    redirectChain: { type: "array", items: { type: "string" } },
    failureReason: { type: "string" },
  },
} as const;

export const CAPTURED_BODY_SCHEMA = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "data", "truncated", "droppedBytes"],
      properties: {
        kind: { const: "text" },
        data: { type: "string" },
        truncated: { type: "boolean" },
        droppedBytes: { type: "number" },
      },
    },
    {
      type: "object",
      required: ["kind", "mimeType", "byteLength"],
      properties: {
        kind: { const: "binary" },
        mimeType: { type: "string" },
        byteLength: { type: "number" },
      },
    },
    {
      type: "object",
      required: ["kind", "reason"],
      properties: {
        kind: { const: "redacted" },
        reason: { type: "string", enum: ["mcp-default", "deny-list", "operator-disabled"] },
      },
    },
    {
      type: "object",
      required: ["kind", "reason"],
      properties: {
        kind: { const: "absent" },
        reason: { type: "string", enum: ["not-captured", "fetch-failed", "204-or-304"] },
      },
    },
  ],
} as const;
