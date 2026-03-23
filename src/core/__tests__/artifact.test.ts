import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ArtifactStore, computeFileChecksum } from "../artifact.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "rn-dev-cli-artifact-"));
}

// ---------------------------------------------------------------------------
// ArtifactStore
// ---------------------------------------------------------------------------

describe("ArtifactStore", () => {
  let tmpDir: string;
  let artifactsDir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    artifactsDir = join(tmpDir, "artifacts");
    store = new ArtifactStore(artifactsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates the artifacts directory if it does not exist", () => {
      expect(existsSync(artifactsDir)).toBe(true);
    });

    it("does not throw when the directory already exists", () => {
      expect(() => new ArtifactStore(artifactsDir)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // worktreeHash
  // -------------------------------------------------------------------------

  describe("worktreeHash()", () => {
    it("returns 'root' when passed null", () => {
      expect(store.worktreeHash(null)).toBe("root");
    });

    it("returns a 12-character hex string for a given path", () => {
      const hash = store.worktreeHash("/some/worktree/path");
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("returns the same hash for the same path", () => {
      const path = "/some/worktree/path";
      expect(store.worktreeHash(path)).toBe(store.worktreeHash(path));
    });

    it("returns different hashes for different paths", () => {
      const hash1 = store.worktreeHash("/path/one");
      const hash2 = store.worktreeHash("/path/two");
      expect(hash1).not.toBe(hash2);
    });
  });

  // -------------------------------------------------------------------------
  // save / load round-trip
  // -------------------------------------------------------------------------

  describe("save() / load()", () => {
    it("saves and loads an artifact by key", () => {
      store.save("my-key", {
        worktree: "/some/path",
        worktreeHash: "abc123abc123",
        metroPort: 8081,
        checksums: { packageJson: "checksum1" },
      });

      const loaded = store.load("my-key");
      expect(loaded).not.toBeNull();
      expect(loaded!.worktree).toBe("/some/path");
      expect(loaded!.metroPort).toBe(8081);
      expect(loaded!.checksums.packageJson).toBe("checksum1");
    });

    it("returns null when key does not exist", () => {
      expect(store.load("nonexistent-key")).toBeNull();
    });

    it("merges partial data with existing artifact on successive saves", () => {
      store.save("merge-key", {
        worktree: "/path",
        worktreeHash: "aabbccddee11",
        metroPort: 8081,
        checksums: {},
      });
      store.save("merge-key", { metroPort: 9090 });

      const loaded = store.load("merge-key");
      expect(loaded!.metroPort).toBe(9090);
      expect(loaded!.worktree).toBe("/path");
    });

    it("stores the artifact as a JSON file named <key>.json", () => {
      store.save("file-key", {
        worktree: "/path",
        worktreeHash: "aabbccddee22",
        metroPort: null,
        checksums: {},
      });
      expect(existsSync(join(artifactsDir, "file-key.json"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // hasChecksumChanged
  // -------------------------------------------------------------------------

  describe("hasChecksumChanged()", () => {
    it("returns true when no artifact exists for the key", () => {
      expect(
        store.hasChecksumChanged("no-such-key", "packageJson", "abc")
      ).toBe(true);
    });

    it("returns false when the checksum matches the stored value", () => {
      store.save("checksum-key", {
        worktree: "/path",
        worktreeHash: "aabbccddee33",
        metroPort: null,
        checksums: { packageJson: "same-checksum" },
      });
      expect(
        store.hasChecksumChanged("checksum-key", "packageJson", "same-checksum")
      ).toBe(false);
    });

    it("returns true when the checksum differs from the stored value", () => {
      store.save("checksum-key2", {
        worktree: "/path",
        worktreeHash: "aabbccddee44",
        metroPort: null,
        checksums: { packageJson: "old-checksum" },
      });
      expect(
        store.hasChecksumChanged(
          "checksum-key2",
          "packageJson",
          "new-checksum"
        )
      ).toBe(true);
    });

    it("returns true when field is not present in stored checksums", () => {
      store.save("checksum-key3", {
        worktree: "/path",
        worktreeHash: "aabbccddee55",
        metroPort: null,
        checksums: {},
      });
      expect(
        store.hasChecksumChanged("checksum-key3", "lockfile", "some-checksum")
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list()", () => {
    it("returns an empty array when no artifacts have been saved", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns all saved artifact keys", () => {
      store.save("alpha", {
        worktree: "/a",
        worktreeHash: "aabbccddee66",
        metroPort: null,
        checksums: {},
      });
      store.save("beta", {
        worktree: "/b",
        worktreeHash: "aabbccddee77",
        metroPort: null,
        checksums: {},
      });

      const keys = store.list();
      expect(keys).toHaveLength(2);
      expect(keys).toContain("alpha");
      expect(keys).toContain("beta");
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe("remove()", () => {
    it("deletes an existing artifact file", () => {
      store.save("to-delete", {
        worktree: "/path",
        worktreeHash: "aabbccddee88",
        metroPort: null,
        checksums: {},
      });
      expect(store.load("to-delete")).not.toBeNull();

      store.remove("to-delete");

      expect(store.load("to-delete")).toBeNull();
      expect(existsSync(join(artifactsDir, "to-delete.json"))).toBe(false);
    });

    it("does not throw when removing a key that does not exist", () => {
      expect(() => store.remove("ghost-key")).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// computeFileChecksum
// ---------------------------------------------------------------------------

describe("computeFileChecksum", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a 16-character hex string for a real file", () => {
    const filePath = join(tmpDir, "test.txt");
    writeFileSync(filePath, "hello world");

    const checksum = computeFileChecksum(filePath);
    expect(checksum).not.toBeNull();
    expect(checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns null for a file that does not exist", () => {
    const result = computeFileChecksum(join(tmpDir, "nonexistent.txt"));
    expect(result).toBeNull();
  });

  it("returns the same checksum for identical file contents", () => {
    const fileA = join(tmpDir, "a.txt");
    const fileB = join(tmpDir, "b.txt");
    writeFileSync(fileA, "same content");
    writeFileSync(fileB, "same content");

    expect(computeFileChecksum(fileA)).toBe(computeFileChecksum(fileB));
  });

  it("returns different checksums for different file contents", () => {
    const fileA = join(tmpDir, "a.txt");
    const fileB = join(tmpDir, "b.txt");
    writeFileSync(fileA, "content one");
    writeFileSync(fileB, "content two");

    expect(computeFileChecksum(fileA)).not.toBe(computeFileChecksum(fileB));
  });
});
