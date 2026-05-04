// Phase H2j — `rn-dev/hooks-diagnose` MCP tool. Reads the audit log
// directly (the daemon doesn't expose a registered-hooks listing
// surface yet — that lands at H6) and surfaces hook failures so an
// agent can answer "did my build/pre fire? did it succeed?" without
// `tail -f ~/.rn-dev/audit.log`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHooksTools, readHookAuditTail } from "../tools-hooks.js";

let tmpRoot = "";
let auditLogPath = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "h2j-hooks-diagnose-"));
  auditLogPath = join(tmpRoot, "audit.log");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAudit(lines: Array<Record<string, unknown>>): void {
  writeFileSync(
    auditLogPath,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

describe("readHookAuditTail (H2j)", () => {
  it("returns empty when the audit log does not exist (no hooks ever fired)", () => {
    expect(
      readHookAuditTail({ limit: 20, auditLogPath: "/nonexistent/audit.log" }),
    ).toEqual([]);
  });

  it("filters down to kind:'hook' entries (skips install / host-call / panel-bridge)", () => {
    writeAudit([
      { kind: "install", moduleId: "x", outcome: "ok" },
      { kind: "hook", phase: "build/pre", source: "project", outcome: "exit-nonzero", exitCode: 7 },
      { kind: "host-call", method: "foo", outcome: "ok" },
      { kind: "hook", phase: "build/post", source: "project", outcome: "timeout" },
    ]);
    const out = readHookAuditTail({ limit: 20, auditLogPath });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.phase)).toEqual(["build/pre", "build/post"]);
  });

  it("narrows further when target is supplied", () => {
    writeAudit([
      { kind: "hook", phase: "build/pre", source: "project", outcome: "exit-nonzero" },
      { kind: "hook", phase: "build/post", source: "project", outcome: "timeout" },
      { kind: "hook", phase: "session/init", source: "project", outcome: "exit-nonzero" },
    ]);
    const out = readHookAuditTail({
      limit: 20,
      target: "build/pre",
      auditLogPath,
    });
    expect(out).toHaveLength(1);
    expect(out[0].phase).toBe("build/pre");
  });

  it("returns the most recent N entries in chronological order", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      kind: "hook",
      phase: "build/pre",
      source: "project",
      outcome: "exit-nonzero",
      seq: i,
    }));
    writeAudit(entries);
    const out = readHookAuditTail({ limit: 5, auditLogPath });
    expect(out).toHaveLength(5);
    // Most recent 5 in oldest-first order: seq 45..49.
    expect(out.map((e) => e.seq)).toEqual([45, 46, 47, 48, 49]);
  });

  it("skips malformed JSON lines without erroring", () => {
    writeFileSync(
      auditLogPath,
      [
        JSON.stringify({ kind: "hook", phase: "build/pre", source: "project" }),
        "not-json{",
        JSON.stringify({ kind: "hook", phase: "build/post", source: "project" }),
      ].join("\n"),
    );
    const out = readHookAuditTail({ limit: 20, auditLogPath });
    expect(out).toHaveLength(2);
  });
});

describe("buildHooksTools (H2j)", () => {
  it("registers exactly one tool: rn-dev/hooks-diagnose", () => {
    const tools = buildHooksTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("rn-dev/hooks-diagnose");
  });

  it("describes target + limit on the input schema", () => {
    const tool = buildHooksTools()[0];
    const props = (tool.inputSchema as { properties: Record<string, unknown> })
      .properties;
    expect(props.target).toBeDefined();
    expect(props.limit).toBeDefined();
  });

  it("hooks-diagnose handler returns advice text when no entries are found", async () => {
    const tool = buildHooksTools()[0];
    // The handler reads from ~/.rn-dev/audit.log by default; on a fresh
    // CI box this either doesn't exist or has no kind:'hook' entries.
    // Pass an explicit non-existent log path via the underlying reader
    // by mocking RN_DEV_HOOKS_DIAGNOSE_AUDIT_OVERRIDE — wait, no env
    // hook here. Instead, just call with a target the audit log
    // certainly doesn't have (random unique) and check for advice
    // text on the empty branch.
    const out = (await tool.handler({
      target: "nonexistent-module/never-fires-" + Math.random(),
      limit: 5,
    })) as {
      structuredContent: { entries: unknown[]; advice?: string };
    };
    expect(out.structuredContent.entries).toEqual([]);
    expect(out.structuredContent.advice).toMatch(/No audit entries/);
  });
});
