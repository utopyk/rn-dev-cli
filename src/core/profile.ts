import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "fs";
import { join } from "path";
import type { Profile } from "./types.js";

// ---------------------------------------------------------------------------
// ProfileStore
// ---------------------------------------------------------------------------

export class ProfileStore {
  private readonly dir: string;

  constructor(profilesDir: string) {
    this.dir = profilesDir;
    mkdirSync(this.dir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // save
  // -------------------------------------------------------------------------

  /** Write the profile to `<name>.json`. Overwrites any existing file. */
  save(profile: Profile): void {
    const safeName = this.sanitizeName(profile.name);
    writeFileSync(
      this.filePath(safeName),
      JSON.stringify(profile, null, 2),
      "utf-8"
    );
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** Read and return the profile by name, or null if not found. */
  load(name: string): Profile | null {
    const fp = this.filePath(this.sanitizeName(name));
    if (!existsSync(fp)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(fp, "utf-8")) as Profile;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  /** Return all profiles found in the profiles directory. */
  list(): Profile[] {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
      const profiles: Profile[] = [];
      for (const file of files) {
        try {
          const parsed = JSON.parse(
            readFileSync(join(this.dir, file), "utf-8")
          ) as Profile;
          profiles.push(parsed);
        } catch {
          // Skip malformed files
        }
      }
      return profiles;
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // findDefault
  // -------------------------------------------------------------------------

  /**
   * Find the default profile for the given worktree + branch combination.
   * Returns the first profile where `isDefault === true` and both `worktree`
   * and `branch` match.
   */
  findDefault(worktree: string | null, branch: string): Profile | null {
    const matches = this.list().filter(
      (p) =>
        p.isDefault &&
        p.worktree === worktree &&
        p.branch === branch
    );
    return matches[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // findForWorktreeBranch
  // -------------------------------------------------------------------------

  /**
   * Return all profiles (default or not) that match the given worktree and
   * branch.
   */
  findForWorktreeBranch(
    worktree: string | null,
    branch: string
  ): Profile[] {
    return this.list().filter(
      (p) => p.worktree === worktree && p.branch === branch
    );
  }

  // -------------------------------------------------------------------------
  // setDefault
  // -------------------------------------------------------------------------

  /**
   * Set `name` as the default for the given worktree + branch. Any existing
   * default for that worktree + branch is unset first.
   */
  setDefault(name: string, worktree: string | null, branch: string): void {
    // Unset any current default for this worktree+branch
    const current = this.findDefault(worktree, branch);
    if (current && current.name !== name) {
      this.save({ ...current, isDefault: false });
    }

    // Set the new default
    const target = this.load(name);
    if (target) {
      this.save({ ...target, isDefault: true });
    }
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  /**
   * Delete the profile file for `name`. Returns true if deleted, false if
   * the profile did not exist.
   */
  delete(name: string): boolean {
    const fp = this.filePath(name);
    if (!existsSync(fp)) {
      return false;
    }
    unlinkSync(fp);
    return true;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private sanitizeName(name: string): string {
    // Strip path separators and ".." sequences to prevent path traversal
    return name.replace(/[/\\]/g, "").replace(/\.\./g, "");
  }

  private filePath(name: string): string {
    return join(this.dir, `${name}.json`);
  }
}
