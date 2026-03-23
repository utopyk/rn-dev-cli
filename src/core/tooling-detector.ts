import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { OnSaveAction } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedTool {
  name: string;   // "lint", "type-check", "test-related", "biome-check"
  label: string;  // e.g. "eslint — .eslintrc.js found"
  configFile: string;
  command: string; // e.g. "npx eslint {files}"
}

// ---------------------------------------------------------------------------
// Config file lists
// ---------------------------------------------------------------------------

const ESLINT_CONFIGS = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
];

const JEST_CONFIGS = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
];

const BIOME_CONFIGS = ["biome.json", "biome.jsonc"];

// ---------------------------------------------------------------------------
// detectTooling
// ---------------------------------------------------------------------------

/**
 * Detects available dev tooling in a project by looking for well-known config
 * files and package.json entries.
 *
 * Returns one entry per tool category (lint, type-check, test-related,
 * biome-check), using the first matching config file found.
 */
export function detectTooling(projectRoot: string): DetectedTool[] {
  const tools: DetectedTool[] = [];

  // --- ESLint ---
  const eslintConfig = findFirstFile(projectRoot, ESLINT_CONFIGS);
  if (eslintConfig !== null) {
    tools.push({
      name: "lint",
      label: `eslint — ${eslintConfig} found`,
      configFile: eslintConfig,
      command: "npx eslint {files}",
    });
  }

  // --- TypeScript ---
  if (existsSync(join(projectRoot, "tsconfig.json"))) {
    tools.push({
      name: "type-check",
      label: "typescript — tsconfig.json found",
      configFile: "tsconfig.json",
      command: "npx tsc --noEmit",
    });
  }

  // --- Jest ---
  const jestTool = detectJest(projectRoot);
  if (jestTool !== null) {
    tools.push(jestTool);
  }

  // --- Biome ---
  const biomeConfig = findFirstFile(projectRoot, BIOME_CONFIGS);
  if (biomeConfig !== null) {
    tools.push({
      name: "biome-check",
      label: `biome — ${biomeConfig} found`,
      configFile: biomeConfig,
      command: "npx biome check {files}",
    });
  }

  return tools;
}

// ---------------------------------------------------------------------------
// toolToOnSaveAction
// ---------------------------------------------------------------------------

/**
 * Converts a DetectedTool to an OnSaveAction with sensible defaults and
 * a default glob of "src/**\/*.{ts,tsx,js,jsx}".
 */
export function toolToOnSaveAction(
  tool: DetectedTool,
  enabled = true,
): OnSaveAction {
  return {
    name: tool.name,
    enabled,
    haltOnFailure: false,
    command: tool.command,
    glob: "src/**/*.{ts,tsx,js,jsx}",
    showOutput: "tool-panel",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the first file from `names` that exists in `dir`, or null.
 */
function findFirstFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    if (existsSync(join(dir, name))) {
      return name;
    }
  }
  return null;
}

/**
 * Returns a DetectedTool for Jest if any Jest indicator is found in
 * `projectRoot`, or null otherwise.
 *
 * Priority: config file first, then package.json deps/devDeps, then
 * package.json `jest` key.
 */
function detectJest(projectRoot: string): DetectedTool | null {
  // 1. Config file
  const jestConfig = findFirstFile(projectRoot, JEST_CONFIGS);
  if (jestConfig !== null) {
    return {
      name: "test-related",
      label: `jest — ${jestConfig} found`,
      configFile: jestConfig,
      command: "npx jest --passWithNoTests {files}",
    };
  }

  // 2. package.json deps / devDeps / jest key
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      jest?: unknown;
    };

    const inDeps = pkg.dependencies?.["jest"] !== undefined;
    const inDevDeps = pkg.devDependencies?.["jest"] !== undefined;
    const hasJestKey = pkg.jest !== undefined;

    if (inDeps || inDevDeps || hasJestKey) {
      return {
        name: "test-related",
        label: "jest — found in package.json",
        configFile: "package.json",
        command: "npx jest --passWithNoTests {files}",
      };
    }
  } catch {
    // malformed package.json – ignore
  }

  return null;
}
