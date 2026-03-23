import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import React from "react";
import { ModuleRegistry } from "../registry.js";
import type { RnDevModule } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModule(overrides: Partial<RnDevModule> = {}): RnDevModule {
  return {
    id: "test-module",
    name: "Test Module",
    icon: "T",
    order: 10,
    component: (() => null) as unknown as React.FC,
    shortcuts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ModuleRegistry
// ---------------------------------------------------------------------------

describe("ModuleRegistry", () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  // -------------------------------------------------------------------------
  // register / get
  // -------------------------------------------------------------------------

  it("registers and retrieves a module by id", () => {
    const mod = makeModule({ id: "alpha" });
    registry.register(mod);
    expect(registry.get("alpha")).toBe(mod);
  });

  it("returns undefined for an unregistered id", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const mod = makeModule({ id: "dup" });
    registry.register(mod);
    expect(() => registry.register(mod)).toThrow(/already registered/i);
  });

  it("throws on duplicate registration even with different object", () => {
    registry.register(makeModule({ id: "dup" }));
    expect(() => registry.register(makeModule({ id: "dup" }))).toThrow();
  });

  // -------------------------------------------------------------------------
  // unregister
  // -------------------------------------------------------------------------

  it("unregister removes the module and returns true", () => {
    registry.register(makeModule({ id: "rem" }));
    expect(registry.unregister("rem")).toBe(true);
    expect(registry.get("rem")).toBeUndefined();
  });

  it("unregister returns false for an unknown id", () => {
    expect(registry.unregister("ghost")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getAll (sorted by order)
  // -------------------------------------------------------------------------

  it("getAll returns all modules sorted by order ascending", () => {
    registry.register(makeModule({ id: "c", order: 30 }));
    registry.register(makeModule({ id: "a", order: 10 }));
    registry.register(makeModule({ id: "b", order: 20 }));

    const all = registry.getAll();
    expect(all.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("getAll returns empty array when no modules registered", () => {
    expect(registry.getAll()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // getShortcuts
  // -------------------------------------------------------------------------

  it("getShortcuts collects shortcuts from all modules", () => {
    const action = async () => {};
    registry.register(
      makeModule({
        id: "m1",
        shortcuts: [
          { key: "r", label: "Reload", action, showInPanel: true },
          { key: "d", label: "Dev Menu", action, showInPanel: false },
        ],
      })
    );
    registry.register(
      makeModule({
        id: "m2",
        shortcuts: [{ key: "s", label: "Save", action, showInPanel: true }],
      })
    );

    const shortcuts = registry.getShortcuts();
    expect(shortcuts).toHaveLength(3);
    expect(shortcuts.map((s) => s.key)).toEqual(["r", "d", "s"]);
    expect(shortcuts.every((s) => "moduleId" in s)).toBe(true);
  });

  it("getShortcuts returns empty array when no modules have shortcuts", () => {
    registry.register(makeModule({ id: "no-shortcuts", shortcuts: [] }));
    expect(registry.getShortcuts()).toEqual([]);
  });

  it("getShortcuts works when shortcuts field is undefined", () => {
    const mod: RnDevModule = {
      id: "no-shortcuts-field",
      name: "No Shortcuts",
      icon: "N",
      order: 5,
      component: (() => null) as unknown as React.FC,
    };
    registry.register(mod);
    expect(registry.getShortcuts()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // loadPlugins
  // -------------------------------------------------------------------------

  describe("loadPlugins", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "rn-dev-cli-registry-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("handles missing package.json gracefully", async () => {
      // No package.json in tmpDir — should not throw
      await expect(registry.loadPlugins(tmpDir)).resolves.toBeUndefined();
    });

    it("handles package.json with no rn-dev field gracefully", async () => {
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-project" })
      );
      await expect(registry.loadPlugins(tmpDir)).resolves.toBeUndefined();
    });

    it("handles package.json with empty plugins array gracefully", async () => {
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-project", "rn-dev": { plugins: [] } })
      );
      await expect(registry.loadPlugins(tmpDir)).resolves.toBeUndefined();
    });

    it("handles invalid plugin entries gracefully (does not throw)", async () => {
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "my-project",
          "rn-dev": { plugins: ["nonexistent-plugin-xyz-12345"] },
        })
      );
      // Should not throw even if the plugin can't be imported
      await expect(registry.loadPlugins(tmpDir)).resolves.toBeUndefined();
    });

    it("handles malformed package.json gracefully", async () => {
      writeFileSync(join(tmpDir, "package.json"), "{ invalid json");
      await expect(registry.loadPlugins(tmpDir)).resolves.toBeUndefined();
    });
  });
});
