import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { Artifact } from "./types.js";

// ---------------------------------------------------------------------------
// computeFileChecksum
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 of a file's content and return the first 16 hex chars.
 * Returns null if the file cannot be read.
 */
export function computeFileChecksum(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ArtifactStore
// ---------------------------------------------------------------------------

export class ArtifactStore {
  private readonly dir: string;

  constructor(artifactsDir: string) {
    this.dir = artifactsDir;
    mkdirSync(this.dir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // worktreeHash
  // -------------------------------------------------------------------------

  /**
   * Returns "root" when worktreePath is null, otherwise the first 12 hex
   * characters of the SHA-256 of the path string.
   */
  worktreeHash(worktreePath: string | null): string {
    if (worktreePath === null) {
      return "root";
    }
    return createHash("sha256")
      .update(worktreePath)
      .digest("hex")
      .slice(0, 12);
  }

  // -------------------------------------------------------------------------
  // save
  // -------------------------------------------------------------------------

  /**
   * Merge `data` into the existing artifact (if any) and write to disk.
   */
  save(key: string, data: Partial<Artifact>): void {
    const existing = this.load(key) ?? ({} as Artifact);
    const merged: Artifact = { ...existing, ...data } as Artifact;
    // Deep-merge checksums so individual fields are preserved
    if (existing.checksums && data.checksums) {
      merged.checksums = { ...existing.checksums, ...data.checksums };
    }
    writeFileSync(this.filePath(key), JSON.stringify(merged, null, 2), "utf-8");
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** Read and parse the artifact for `key`, or return null if not found. */
  load(key: string): Artifact | null {
    const fp = this.filePath(key);
    if (!existsSync(fp)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(fp, "utf-8")) as Artifact;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // hasChecksumChanged
  // -------------------------------------------------------------------------

  /**
   * Returns true if the stored checksum for `field` differs from
   * `currentChecksum`, or if no artifact / no field is stored yet.
   */
  hasChecksumChanged(
    key: string,
    field: string,
    currentChecksum: string
  ): boolean {
    const artifact = this.load(key);
    if (!artifact) {
      return true;
    }
    const stored =
      (artifact.checksums as Record<string, string | undefined>)[field];
    return stored !== currentChecksum;
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  /** Return all artifact keys (file stems) in the artifacts directory. */
  list(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5)); // strip ".json"
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  /** Delete the artifact file for `key`. No-op if it does not exist. */
  remove(key: string): void {
    const fp = this.filePath(key);
    if (existsSync(fp)) {
      unlinkSync(fp);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private filePath(key: string): string {
    return join(this.dir, `${key}.json`);
  }
}
