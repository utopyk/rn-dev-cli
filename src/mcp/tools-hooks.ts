// Phase H2j — `rn-dev/hooks-diagnose` MCP tool. Hoisted from H6
// because agent-driven debugging during the e2e milestone needs a
// way to ask "did my build/pre fire? if so, did it succeed?" without
// `tail -f ~/.rn-dev/audit.log`.
//
// Reads the audit log directly. Doesn't reach into the daemon RPC
// surface — the daemon doesn't currently expose a registered-hooks
// listing tool, and inspecting failures from disk is the only thing
// the e2e milestone needs. The richer "list providers + registrations
// + recent fires" surface lands at H6 alongside `hooks/run`.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "./tools.js";

interface HookAuditEntry {
  kind: "hook";
  phase: string;
  source: string;
  scriptOrSymbol?: string;
  durationMs?: number;
  exitCode?: number;
  outcome?: string;
  ts?: number;
  seq?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function defaultAuditLogPath(): string {
  return join(homedir(), ".rn-dev", "audit.log");
}

/**
 * Tail the audit log file, parse JSON-line entries, filter to
 * `kind: "hook"` (optionally narrowed to a `target` phase), and
 * return the last `limit` matching entries in chronological order
 * (oldest → newest).
 *
 * Returns an empty array if the audit log does not exist (no hooks
 * have ever fired on this machine) — that's a normal state, not an
 * error.
 */
export function readHookAuditTail(opts: {
  limit: number;
  target?: string;
  auditLogPath?: string;
}): HookAuditEntry[] {
  const path = opts.auditLogPath ?? defaultAuditLogPath();
  if (!existsSync(path)) return [];

  // The audit log can grow large (kimoby env shows ~280 KB after a
  // few sessions). Reading the entire file is acceptable for H2j —
  // 280 KB streamed parse is sub-millisecond, and the agent caller
  // has already paid the round-trip cost. Smarter tail-from-end
  // streaming lands at H6 if we need it.
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n");
  const matches: HookAuditEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { kind?: unknown }).kind !== "hook"
    ) {
      continue;
    }
    const hookEntry = entry as HookAuditEntry;
    if (opts.target && hookEntry.phase !== opts.target) continue;
    matches.push(hookEntry);
    if (matches.length >= opts.limit) break;
  }
  return matches.reverse();
}

export function buildHooksTools(): ToolDefinition[] {
  return [
    {
      name: "rn-dev/hooks-diagnose",
      description:
        "Inspect recent hook fires from the audit log. Use after a build/pre or build/post hook fails to see what the runner recorded — the daemon writes a `kind: \"hook\"` audit entry on every failure (success path is silent by design). Optionally narrow by `target` (e.g. \"build/pre\") to focus on one slot.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "Optional. Hook target phase to filter by (e.g. \"build/pre\", \"session/init\"). When omitted, returns recent failures across all targets.",
          },
          limit: {
            type: "number",
            description: `Maximum number of entries to return. Default: ${DEFAULT_LIMIT}. Max: ${MAX_LIMIT}.`,
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          auditLogPath: { type: "string" },
          matchedCount: { type: "number" },
          entries: { type: "array" },
          advice: { type: "string" },
        },
      },
      handler: async (args) => {
        const target = typeof args.target === "string" ? args.target : undefined;
        const limit =
          typeof args.limit === "number" && args.limit > 0
            ? Math.min(Math.floor(args.limit), MAX_LIMIT)
            : DEFAULT_LIMIT;
        const auditLogPath = defaultAuditLogPath();
        const entries = readHookAuditTail({ limit, target, auditLogPath });

        let advice: string | undefined;
        if (entries.length === 0) {
          advice = target
            ? `No audit entries for ${target}. Audit only writes on failure; if the hook ran successfully, there will be no entry. Check the source rn-dev.config.* registers a script or fn against this slot.`
            : "No hook failure entries in the audit log. If you expected one, check the daemon is running and rn-dev.config.* is being walked at boot (look for a 'Registered N project hooks' line in session/log).";
        } else {
          const last = entries[entries.length - 1];
          advice = `Most recent ${target ?? "hook"} failure: outcome=${last.outcome ?? "unknown"}${last.exitCode !== undefined ? `, exitCode=${last.exitCode}` : ""}. Check the script source for clues; replicate by re-firing through the daemon RPC.`;
        }

        return {
          structuredContent: {
            auditLogPath,
            matchedCount: entries.length,
            entries,
            ...(advice ? { advice } : {}),
          },
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { auditLogPath, matchedCount: entries.length, entries, advice },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
  ];
}
