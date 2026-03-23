import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProfileStore } from "../profile.js";
import type { Profile } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "rn-dev-cli-profile-"));
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: "default-profile",
    isDefault: false,
    worktree: null,
    branch: "main",
    platform: "ios",
    mode: "dirty",
    metroPort: 8081,
    devices: {},
    buildVariant: "debug",
    preflight: { checks: [], frequency: "once" },
    onSave: [],
    env: {},
    projectRoot: "/project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ProfileStore
// ---------------------------------------------------------------------------

describe("ProfileStore", () => {
  let tmpDir: string;
  let profilesDir: string;
  let store: ProfileStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    profilesDir = join(tmpDir, "profiles");
    store = new ProfileStore(profilesDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates the profiles directory if it does not exist", () => {
      expect(existsSync(profilesDir)).toBe(true);
    });

    it("does not throw when directory already exists", () => {
      expect(() => new ProfileStore(profilesDir)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // save / load round-trip
  // -------------------------------------------------------------------------

  describe("save() / load()", () => {
    it("saves and loads a profile by name", () => {
      const profile = makeProfile({ name: "my-profile", metroPort: 9090 });
      store.save(profile);

      const loaded = store.load("my-profile");
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe("my-profile");
      expect(loaded!.metroPort).toBe(9090);
    });

    it("returns null when profile does not exist", () => {
      expect(store.load("nonexistent")).toBeNull();
    });

    it("overwrites an existing profile on save", () => {
      store.save(makeProfile({ name: "overwrite-me", metroPort: 8081 }));
      store.save(makeProfile({ name: "overwrite-me", metroPort: 9000 }));

      const loaded = store.load("overwrite-me");
      expect(loaded!.metroPort).toBe(9000);
    });

    it("preserves all profile fields through save/load", () => {
      const profile = makeProfile({
        name: "full-profile",
        isDefault: true,
        worktree: "/some/worktree",
        branch: "feature/x",
        platform: "both",
        mode: "clean",
        metroPort: 8088,
        devices: { ios: "iPhone 15", android: "Pixel 6" },
        buildVariant: "release",
        preflight: { checks: ["node", "pods"], frequency: "always" },
        onSave: [
          {
            name: "lint",
            enabled: true,
            haltOnFailure: false,
            command: "yarn lint",
            showOutput: "notification",
          },
        ],
        env: { NODE_ENV: "production" },
        projectRoot: "/my/project",
      });
      store.save(profile);

      const loaded = store.load("full-profile");
      expect(loaded).toEqual(profile);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list()", () => {
    it("returns an empty array when no profiles exist", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns all saved profiles", () => {
      store.save(makeProfile({ name: "alpha" }));
      store.save(makeProfile({ name: "beta" }));
      store.save(makeProfile({ name: "gamma" }));

      const profiles = store.list();
      expect(profiles).toHaveLength(3);
      const names = profiles.map((p) => p.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).toContain("gamma");
    });
  });

  // -------------------------------------------------------------------------
  // findDefault
  // -------------------------------------------------------------------------

  describe("findDefault()", () => {
    it("returns null when no profiles exist", () => {
      expect(store.findDefault(null, "main")).toBeNull();
    });

    it("returns the default profile for the given worktree+branch", () => {
      store.save(
        makeProfile({ name: "profile-a", isDefault: true, worktree: null, branch: "main" })
      );
      store.save(
        makeProfile({ name: "profile-b", isDefault: false, worktree: null, branch: "main" })
      );

      const result = store.findDefault(null, "main");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("profile-a");
    });

    it("returns null when no matching default exists for the worktree+branch", () => {
      store.save(
        makeProfile({ name: "other", isDefault: true, worktree: "/other", branch: "feature" })
      );
      expect(store.findDefault(null, "main")).toBeNull();
    });

    it("matches on both worktree and branch", () => {
      store.save(
        makeProfile({
          name: "wrong-branch",
          isDefault: true,
          worktree: null,
          branch: "develop",
        })
      );
      store.save(
        makeProfile({
          name: "right-one",
          isDefault: true,
          worktree: null,
          branch: "main",
        })
      );

      const result = store.findDefault(null, "main");
      expect(result!.name).toBe("right-one");
    });
  });

  // -------------------------------------------------------------------------
  // findForWorktreeBranch
  // -------------------------------------------------------------------------

  describe("findForWorktreeBranch()", () => {
    it("returns only profiles matching the given worktree and branch", () => {
      store.save(makeProfile({ name: "match-1", worktree: "/wt", branch: "feat" }));
      store.save(makeProfile({ name: "match-2", worktree: "/wt", branch: "feat" }));
      store.save(makeProfile({ name: "no-match", worktree: "/wt", branch: "main" }));

      const results = store.findForWorktreeBranch("/wt", "feat");
      expect(results).toHaveLength(2);
      const names = results.map((p) => p.name);
      expect(names).toContain("match-1");
      expect(names).toContain("match-2");
    });

    it("returns empty array when no profiles match", () => {
      store.save(makeProfile({ name: "p1", worktree: "/other", branch: "main" }));
      expect(store.findForWorktreeBranch("/wt", "feat")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // setDefault
  // -------------------------------------------------------------------------

  describe("setDefault()", () => {
    it("sets isDefault=true on the named profile", () => {
      store.save(makeProfile({ name: "target", isDefault: false, worktree: null, branch: "main" }));
      store.setDefault("target", null, "main");

      expect(store.load("target")!.isDefault).toBe(true);
    });

    it("unsets isDefault on the previous default for the same worktree+branch", () => {
      store.save(
        makeProfile({ name: "old-default", isDefault: true, worktree: null, branch: "main" })
      );
      store.save(
        makeProfile({ name: "new-default", isDefault: false, worktree: null, branch: "main" })
      );

      store.setDefault("new-default", null, "main");

      expect(store.load("old-default")!.isDefault).toBe(false);
      expect(store.load("new-default")!.isDefault).toBe(true);
    });

    it("does not unset defaults for a different worktree+branch", () => {
      store.save(
        makeProfile({
          name: "other-wt-default",
          isDefault: true,
          worktree: "/other",
          branch: "main",
        })
      );
      store.save(
        makeProfile({ name: "target", isDefault: false, worktree: null, branch: "main" })
      );

      store.setDefault("target", null, "main");

      // other worktree default should remain unchanged
      expect(store.load("other-wt-default")!.isDefault).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete()", () => {
    it("removes an existing profile and returns true", () => {
      store.save(makeProfile({ name: "to-delete" }));
      const result = store.delete("to-delete");

      expect(result).toBe(true);
      expect(store.load("to-delete")).toBeNull();
    });

    it("returns false when profile does not exist", () => {
      expect(store.delete("ghost")).toBe(false);
    });

    it("the deleted profile no longer appears in list()", () => {
      store.save(makeProfile({ name: "keep-me" }));
      store.save(makeProfile({ name: "delete-me" }));
      store.delete("delete-me");

      const names = store.list().map((p) => p.name);
      expect(names).toContain("keep-me");
      expect(names).not.toContain("delete-me");
    });
  });
});
