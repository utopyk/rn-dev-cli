// HMAC-chained append-only audit log for privileged host actions.
//
// Writes to `~/.rn-dev/audit.log` (NDJSON — one JSON entry per line).
// Each entry carries an HMAC-SHA256 chain: `hash = HMAC(key, canonical(entry
// without hash) + prevHash)`. Tampering any prior entry invalidates every
// entry after it.
//
// Threat model:
//   - **In scope:** post-hoc tamper detection. If an attacker (or a bug)
//     rewrites a middle line, `verify()` reports the first broken entry.
//   - **Out of scope:** preventing a local attacker with read access from
//     forging a fresh log. The HMAC key lives at `~/.rn-dev/audit.key`
//     (mode 600); a process running as the user can read it. That's
//     fine — this is a compliance/breadcrumb log, not a capabilities
//     boundary. The sandboxing story is curated registry + subprocess
//     isolation + consent UI (unchanged from Phase 6).
//
// Concurrency: `append()` serializes through an instance-scoped promise
// chain. Two concurrent appends on the same AuditLog instance land in
// deterministic sequence order. Cross-process concurrency is NOT handled
// — only the single daemon process writes. If the CLI or another process
// needs to audit, route through the daemon's IPC.
//
// Rotation: when the active log exceeds `rotateBytes` (default 10MB), the
// NEXT append rotates. `audit.log` → `audit.log.1` (overwriting any prior
// rotated file), then a fresh `audit.log` starts with a genesis entry
// whose `prevHash` is the rotated file's tail hash. The chain therefore
// continues across rotation boundaries — `verify()` can walk a pair of
// files by feeding the `audit.log.1` tail hash into the `audit.log` head
// verification.

import { createHmac, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type AuditOutcome = "ok" | "error" | "denied";

export interface AuditEntryInput {
  /**
   * Event kind. Namespaced by subsystem:
   *   - `"install"` / `"uninstall"` — Marketplace install flow
   *   - `"config-set"` — per-module config mutations
   *   - `"host-call"` — cross-module capability invocations
   *   - `"panel-bridge"` — WebContentsView register/unregister
   */
  kind: string;
  /** Module the event applies to. Empty string for host-level events. */
  moduleId: string;
  outcome: AuditOutcome;
  /** Error code for `outcome === "error"` — optional for success paths. */
  code?: string;
  /** Anything else. Must be JSON-clonable. */
  data?: Record<string, unknown>;
}

export interface AuditEntry extends AuditEntryInput {
  /** Epoch ms — `Date.now()` at append time. */
  ts: number;
  /** Monotonic sequence number within the active file. Reset on rotation. */
  seq: number;
  /** Previous entry's `hash`; `""` for the first entry of a fresh file. */
  prevHash: string;
  /** HMAC-SHA256(key, canonical(entry without hash) + prevHash). Hex. */
  hash: string;
}

export interface AuditLogOptions {
  /** Override the log file path. Defaults to `~/.rn-dev/audit.log`. */
  path?: string;
  /** Override the key file path. Defaults to `~/.rn-dev/audit.key`. */
  keyPath?: string;
  /**
   * Supply a key directly (tests). When omitted, read or generate a key
   * at `keyPath`. A provided key bypasses all filesystem key handling.
   */
  key?: Buffer;
  /** Size in bytes that triggers rotation. Defaults to 10 MiB. */
  rotateBytes?: number;
  /** Clock override (tests). Defaults to `Date.now`. */
  now?: () => number;
}

export class AuditLog extends EventEmitter {
  private readonly path: string;
  private readonly keyPath: string;
  private readonly rotateBytes: number;
  private readonly now: () => number;
  private key: Buffer | null = null;
  private seq = 0;
  private lastHash = "";
  /** Promise chain so concurrent `append()`s serialize. */
  private tail: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(opts: AuditLogOptions = {}) {
    super();
    this.path = opts.path ?? defaultLogPath();
    this.keyPath = opts.keyPath ?? defaultKeyPath();
    this.rotateBytes = opts.rotateBytes ?? 10 * 1024 * 1024;
    this.now = opts.now ?? (() => Date.now());
    if (opts.key) this.key = opts.key;
  }

  /**
   * Append an entry. Serializes with any in-flight append. Resolves
   * once the entry is flushed to disk. Emits `"appended"` with the full
   * entry (including `hash`) so listeners (e.g. the Electron service-log
   * mirror) can react without re-reading the file.
   */
  append(input: AuditEntryInput): Promise<AuditEntry> {
    const run = this.tail.then(async () => {
      this.ensureInitialized();
      // Rotate BEFORE building so the new entry's `seq` reflects the
      // fresh file (reset to 1) instead of continuing the pre-rotation
      // counter. The chain (prevHash) continues across rotation; seq
      // resets per-file so operators can locate entries within a single
      // log.
      this.rotateIfNeeded();
      const entry = this.buildEntry(input);
      appendFileSync(this.path, JSON.stringify(entry) + "\n", { mode: 0o600 });
      this.lastHash = entry.hash;
      this.seq = entry.seq;
      this.emit("appended", entry);
      return entry;
    });
    // Chain tail onto the promise, swallowing errors so one failure doesn't
    // poison every subsequent append (the caller still sees their error).
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Read the entire log and verify the HMAC chain. Returns `{ ok: true }`
   * if every entry verifies + the chain is unbroken, otherwise
   * `{ ok: false, failedAt: seq }`. Used by tests + post-mortem tools.
   *
   * Paired rotation files: call `verify({ tailHash })` on the fresh log
   * with the `tailHash` from the rotated file's verification to continue
   * the chain.
   */
  verify(options: { tailHash?: string } = {}): VerifyResult {
    this.ensureInitialized();
    if (!existsSync(this.path)) {
      return { ok: true, entriesRead: 0, tailHash: options.tailHash ?? "" };
    }
    const raw = readFileSync(this.path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    let prevHash = options.tailHash ?? "";
    let entriesRead = 0;
    for (const line of lines) {
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch {
        return { ok: false, failedAt: entriesRead, reason: "invalid JSON" };
      }
      if (entry.prevHash !== prevHash) {
        return {
          ok: false,
          failedAt: entry.seq,
          reason: `prevHash mismatch (expected "${prevHash}", got "${entry.prevHash}")`,
        };
      }
      // Canonicalize the entry WITHOUT its own `hash` field — otherwise
      // the HMAC includes its own output and verify can never match
      // append's computation. `Omit<AuditEntry, "hash">` is a type-level
      // hint, not a runtime strip; destructure explicitly.
      const { hash: _stored, ...withoutHash } = entry;
      const expectedHash = this.computeHash(withoutHash, entry.prevHash);
      if (entry.hash !== expectedHash) {
        return {
          ok: false,
          failedAt: entry.seq,
          reason: "hash mismatch — entry has been tampered",
        };
      }
      prevHash = entry.hash;
      entriesRead++;
    }
    return { ok: true, entriesRead, tailHash: prevHash };
  }

  /** Active file size. Public so callers can introspect rotation state. */
  currentBytes(): number {
    if (!existsSync(this.path)) return 0;
    return statSync(this.path).size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (this.initialized) return;
    if (!this.key) {
      this.key = loadOrGenerateKey(this.keyPath);
    }
    // Resume from existing log: read tail hash + seq so appends continue
    // the chain instead of restarting it.
    if (existsSync(this.path)) {
      const raw = readFileSync(this.path, "utf-8");
      const lines = raw.split("\n").filter((l) => l.length > 0);
      const last = lines[lines.length - 1];
      if (last) {
        try {
          const entry = JSON.parse(last) as AuditEntry;
          this.lastHash = entry.hash;
          this.seq = entry.seq;
        } catch {
          // Tail line is garbage; chain continues from empty — `verify()`
          // will flag the gap but append keeps working.
        }
      }
    }
    this.initialized = true;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size < this.rotateBytes) return;
    const rotated = this.path + ".1";
    renameSync(this.path, rotated);
    // Next append starts fresh — `lastHash` carries across so the chain
    // continues. Seq resets per-file so operators can locate entries
    // within the active log.
    this.seq = 0;
  }

  private buildEntry(input: AuditEntryInput): AuditEntry {
    const base: Omit<AuditEntry, "hash"> = {
      ts: this.now(),
      seq: this.seq + 1,
      kind: input.kind,
      moduleId: input.moduleId,
      outcome: input.outcome,
      prevHash: this.lastHash,
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    };
    const hash = this.computeHash(base, base.prevHash);
    return { ...base, hash };
  }

  private computeHash(entry: Omit<AuditEntry, "hash">, prevHash: string): string {
    if (!this.key) {
      throw new Error("AuditLog: key not initialized");
    }
    const canonical = canonicalize(entry);
    return createHmac("sha256", this.key)
      .update(canonical)
      .update(prevHash)
      .digest("hex");
  }
}

export interface VerifyResult {
  ok: boolean;
  /** Count of entries that verified successfully before any failure. */
  entriesRead?: number;
  /** On failure, the `seq` of the first bad entry. */
  failedAt?: number;
  /** Human-readable failure reason. */
  reason?: string;
  /** Last good entry's hash — feed into the paired file's `verify({tailHash})`. */
  tailHash?: string;
}

// ---------------------------------------------------------------------------
// Module-scoped default instance
// ---------------------------------------------------------------------------

let cachedDefault: AuditLog | null = null;

/**
 * Lazy-initialized default instance rooted at `~/.rn-dev/audit.log`.
 * Use this from Electron/daemon glue code. Tests construct their own
 * `AuditLog` with overridden paths + keys.
 */
export function getDefaultAuditLog(): AuditLog {
  if (!cachedDefault) cachedDefault = new AuditLog();
  return cachedDefault;
}

/** Reset the default instance (tests only). */
export function resetDefaultAuditLogForTests(): void {
  cachedDefault = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultLogPath(): string {
  return join(homedir(), ".rn-dev", "audit.log");
}

function defaultKeyPath(): string {
  return join(homedir(), ".rn-dev", "audit.key");
}

function loadOrGenerateKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const bytes = readFileSync(keyPath);
    if (bytes.length < 32) {
      // Too-short key — regenerate rather than accept a weak HMAC.
      return generateKey(keyPath);
    }
    return bytes;
  }
  return generateKey(keyPath);
}

function generateKey(keyPath: string): Buffer {
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(64);
  writeFileSync(keyPath, key, { mode: 0o600 });
  // writeFileSync's mode is advisory on some platforms (umask can widen).
  // chmod explicitly to be sure.
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* best-effort */
  }
  return key;
}

/**
 * Canonical JSON — keys sorted, no whitespace. Determinism matters: the
 * HMAC must be reproducible for `verify()` on a different process.
 * `JSON.stringify` preserves insertion order, which is unstable across
 * environments, so we sort keys explicitly.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalize(obj[k]),
  );
  return "{" + parts.join(",") + "}";
}
