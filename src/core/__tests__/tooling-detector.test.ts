import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectTooling, toolToOnSaveAction } from "../tooling-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "rn-dev-cli-tooling-"));
}

function writeFile(dir: string, name: string, content: string = "{}"): void {
  writeFileSync(join(dir, name), content);
}

function writePackageJson(dir: string, content: object): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify(content, null, 2));
}

// ---------------------------------------------------------------------------
// detectTooling
// ---------------------------------------------------------------------------

describe("detectTooling", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty array when no tooling config is present", () => {
    const result = detectTooling(root);
    expect(result).toEqual([]);
  });

  it("detects eslint via .eslintrc.js", () => {
    writeFile(root, ".eslintrc.js", "module.exports = {};");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
    expect(result[0].label).toContain(".eslintrc.js");
    expect(result[0].configFile).toBe(".eslintrc.js");
    expect(result[0].command).toContain("eslint");
  });

  it("detects eslint via .eslintrc.json", () => {
    writeFile(root, ".eslintrc.json", "{}");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
    expect(result[0].configFile).toBe(".eslintrc.json");
  });

  it("detects eslint via .eslintrc (no extension)", () => {
    writeFile(root, ".eslintrc", "{}");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
    expect(result[0].configFile).toBe(".eslintrc");
  });

  it("detects eslint via eslint.config.js", () => {
    writeFile(root, "eslint.config.js", "export default [];");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
    expect(result[0].configFile).toBe("eslint.config.js");
  });

  it("detects eslint via eslint.config.mjs", () => {
    writeFile(root, "eslint.config.mjs", "export default [];");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("lint");
  });

  it("detects TypeScript via tsconfig.json", () => {
    writeFile(root, "tsconfig.json", "{}");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("type-check");
    expect(result[0].label).toContain("tsconfig.json");
    expect(result[0].configFile).toBe("tsconfig.json");
    expect(result[0].command).toContain("tsc");
  });

  it("detects Jest via jest.config.js", () => {
    writeFile(root, "jest.config.js", "module.exports = {};");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-related");
    expect(result[0].label).toContain("jest.config.js");
    expect(result[0].configFile).toBe("jest.config.js");
    expect(result[0].command).toContain("jest");
  });

  it("detects Jest via jest.config.ts", () => {
    writeFile(root, "jest.config.ts", "export default {};");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-related");
    expect(result[0].configFile).toBe("jest.config.ts");
  });

  it("detects Jest via jest in package.json dependencies", () => {
    writePackageJson(root, {
      name: "my-app",
      dependencies: { jest: "^29.0.0" },
    });
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-related");
    expect(result[0].configFile).toBe("package.json");
  });

  it("detects Jest via jest in package.json devDependencies", () => {
    writePackageJson(root, {
      name: "my-app",
      devDependencies: { jest: "^29.0.0" },
    });
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-related");
  });

  it("detects Jest via jest key in package.json", () => {
    writePackageJson(root, {
      name: "my-app",
      jest: { testMatch: ["**/*.test.ts"] },
    });
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-related");
  });

  it("detects Biome via biome.json", () => {
    writeFile(root, "biome.json", "{}");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("biome-check");
    expect(result[0].label).toContain("biome.json");
    expect(result[0].configFile).toBe("biome.json");
    expect(result[0].command).toContain("biome");
  });

  it("detects Biome via biome.jsonc", () => {
    writeFile(root, "biome.jsonc", "{}");
    const result = detectTooling(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("biome-check");
    expect(result[0].configFile).toBe("biome.jsonc");
  });

  it("detects multiple tools simultaneously", () => {
    writeFile(root, ".eslintrc.js", "module.exports = {};");
    writeFile(root, "tsconfig.json", "{}");
    writeFile(root, "jest.config.js", "module.exports = {};");
    const result = detectTooling(root);
    expect(result).toHaveLength(3);
    const names = result.map((t) => t.name);
    expect(names).toContain("lint");
    expect(names).toContain("type-check");
    expect(names).toContain("test-related");
  });

  it("does not return duplicate tools when multiple eslint configs exist", () => {
    writeFile(root, ".eslintrc.js", "module.exports = {};");
    writeFile(root, ".eslintrc.json", "{}");
    const result = detectTooling(root);
    const lintTools = result.filter((t) => t.name === "lint");
    expect(lintTools).toHaveLength(1);
  });

  it("does not return duplicate jest when config file and package.json both found", () => {
    writeFile(root, "jest.config.js", "module.exports = {};");
    writePackageJson(root, {
      name: "my-app",
      devDependencies: { jest: "^29.0.0" },
    });
    const result = detectTooling(root);
    const jestTools = result.filter((t) => t.name === "test-related");
    expect(jestTools).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// toolToOnSaveAction
// ---------------------------------------------------------------------------

describe("toolToOnSaveAction", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("converts a detected eslint tool to an OnSaveAction with defaults", () => {
    writeFileSync(join(root, ".eslintrc.js"), "module.exports = {};");
    const [tool] = detectTooling(root);
    const action = toolToOnSaveAction(tool);

    expect(action.name).toBe(tool.name);
    expect(action.enabled).toBe(true);
    expect(action.haltOnFailure).toBe(false);
    expect(action.command).toBe(tool.command);
    expect(action.glob).toBe("src/**/*.{ts,tsx,js,jsx}");
    expect(action.showOutput).toBe("tool-panel");
  });

  it("respects the enabled parameter when false", () => {
    writeFileSync(join(root, ".eslintrc.js"), "module.exports = {};");
    const [tool] = detectTooling(root);
    const action = toolToOnSaveAction(tool, false);

    expect(action.enabled).toBe(false);
  });

  it("defaults enabled to true when not provided", () => {
    writeFileSync(join(root, ".eslintrc.js"), "module.exports = {};");
    const [tool] = detectTooling(root);
    const action = toolToOnSaveAction(tool);

    expect(action.enabled).toBe(true);
  });
});
