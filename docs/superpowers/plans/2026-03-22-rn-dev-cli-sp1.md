# rn-dev-cli Sub-project 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native developer CLI with a TUI shell, profile system, metro manager, preflight engine, build error extraction, file watcher, theming, and dual MCP/CLI interface.

**Architecture:** TypeScript + Ink (React for CLIs). Core logic in `src/core/` (pure functions, no UI), UI in `src/ui/` (Ink components), thin CLI/MCP wrappers. Single esbuild bundle for distribution.

**Tech Stack:** TypeScript, Ink 5, React 18, commander, chokidar, fuse.js, @modelcontextprotocol/sdk, esbuild, vitest

**Spec:** `docs/superpowers/specs/2026-03-22-rn-dev-cli-design.md`

---

## File Structure

### Core Logic (`src/core/`)

| File | Responsibility |
|---|---|
| `src/core/project.ts` | Detect RN project root, read RN version, detect git repo/worktrees |
| `src/core/profile.ts` | Profile CRUD, resolution, default management, first-run setup |
| `src/core/artifact.ts` | Per-worktree artifact tracking: checksums, ports, preflight results |
| `src/core/metro.ts` | Metro process spawn/kill, port allocation, crash handling, multi-instance |
| `src/core/device.ts` | Device discovery via `adb devices` and `xcrun simctl list`, boot, usage tracking |
| `src/core/preflight.ts` | 21 environment checks, auto-fix actions, platform filtering |
| `src/core/build-parser.ts` | xcodebuild + gradle output parsing, error extraction, suggestion mapping |
| `src/core/watcher.ts` | File watcher, debounce, on-save pipeline execution, cancellation |
| `src/core/clean.ts` | Dirty/clean/ultra-clean mode operations, self-preservation, Xcode kill check |
| `src/core/tooling-detector.ts` | Detect eslint, tsc, jest, biome in project for on-save wizard step |
| `src/core/ipc.ts` | JSON-RPC 2.0 server/client over Unix socket |
| `src/core/logger.ts` | Diagnostic logging to `~/.rn-dev/logs/rn-dev.log` |
| `src/core/types.ts` | Shared TypeScript interfaces (Profile, MetroInstance, BuildError, etc.) |

### UI (`src/ui/`)

| File | Responsibility |
|---|---|
| `src/ui/theme-provider.tsx` | React context for theme colors, load built-in/custom themes |
| `src/ui/layout/shell.tsx` | Root layout: sidebar + main content area |
| `src/ui/layout/dev-space.tsx` | Default 4-panel stacked view |
| `src/ui/layout/panel.tsx` | Reusable scrollable panel wrapper with title + border |
| `src/ui/panels/profile-banner.tsx` | Collapsible profile display |
| `src/ui/panels/shortcuts.tsx` | Keyboard shortcut list |
| `src/ui/panels/interactive.tsx` | Preflights, build progress, build errors |
| `src/ui/panels/tool-output.tsx` | Lint/test results viewer |
| `src/ui/panels/metro-log.tsx` | Metro log stream |
| `src/ui/components/search-input.tsx` | Fuzzy search/autocomplete (ink-text-input + fuse.js) |
| `src/ui/components/selectable-list.tsx` | Wrapper around ink-select-input with search |
| `src/ui/components/log-viewer.tsx` | Scrollable ANSI log renderer |
| `src/ui/components/multi-select.tsx` | Checkbox multi-select for preflight/on-save config |
| `src/ui/wizard/wizard.tsx` | Step-by-step wizard orchestrator |
| `src/ui/wizard/worktree-step.tsx` | Worktree selection |
| `src/ui/wizard/branch-step.tsx` | Branch confirmation |
| `src/ui/wizard/platform-step.tsx` | iOS/Android/both selection |
| `src/ui/wizard/mode-step.tsx` | Dirty/clean/ultra-clean selection |
| `src/ui/wizard/device-step.tsx` | Device picker |
| `src/ui/wizard/preflight-step.tsx` | Preflight check selection + frequency |
| `src/ui/wizard/onsave-step.tsx` | On-save pipeline configuration |

### Modules, MCP, CLI

| File | Responsibility |
|---|---|
| `src/modules/registry.ts` | Module registration, ordering, shortcut conflict detection |
| `src/modules/base-module.ts` | RnDevModule interface definition |
| `src/modules/built-in/dev-space.ts` | Dev Space module (wraps dev-space.tsx) |
| `src/modules/built-in/lint-test.ts` | Lint/Test module (full-screen tool output) |
| `src/modules/built-in/metro-full.ts` | Metro Logs module (full-screen metro) |
| `src/modules/built-in/settings.ts` | Settings module (profile manager, theme picker) |
| `src/mcp/server.ts` | MCP server setup, stdio transport, proxy mode |
| `src/mcp/tools.ts` | MCP tool definitions mapping to core functions |
| `src/cli/commands.ts` | Commander subcommand definitions |
| `src/index.tsx` | Entry point: parse args, route to TUI/CLI/MCP |
| `src/app.tsx` | Root Ink `<App>` component |

### Themes

| File | Responsibility |
|---|---|
| `src/themes/midnight.json` | Tokyo Night colors |
| `src/themes/ember.json` | Gruvbox colors |
| `src/themes/arctic.json` | Nord colors |
| `src/themes/neon-drive.json` | Synthwave colors |

### Config

| File | Responsibility |
|---|---|
| `package.json` | Project manifest, dependencies, bin entry |
| `tsconfig.json` | TypeScript config |
| `esbuild.config.ts` | Single-file build config |
| `vitest.config.ts` | Test config |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.config.ts`, `src/core/types.ts`, `src/index.tsx`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Volumes/external-disk/Projects/rn-dev-cli
npm init -y
```

Edit `package.json`:

```json
{
  "name": "rn-dev-cli",
  "version": "0.1.0",
  "description": "React Native developer CLI with TUI, profile system, and metro manager",
  "type": "module",
  "bin": {
    "rn-dev": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.tsx",
    "build": "node esbuild.config.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Install core dependencies**

```bash
npm install ink react ink-text-input ink-select-input ink-multi-select @inkjs/ui ink-scroll-view fullscreen-ink commander chokidar fuse.js chalk @modelcontextprotocol/sdk
npm install -D typescript @types/react @types/node vitest tsx esbuild
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 5: Create esbuild.config.ts**

```typescript
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  banner: { js: "#!/usr/bin/env node" },
  external: [],
  minify: false,
  sourcemap: true,
});
```

- [ ] **Step 6: Create src/core/types.ts with all shared interfaces**

```typescript
export interface Profile {
  name: string;
  isDefault: boolean;
  worktree: string | null;
  branch: string;
  platform: "ios" | "android" | "both";
  mode: "dirty" | "clean" | "ultra-clean";
  metroPort: number;
  devices: DeviceSelection;
  buildVariant: "debug" | "release";
  preflight: PreflightConfig;
  onSave: OnSaveAction[];
  env: Record<string, string>;
  projectRoot: string;
}

export interface PreflightConfig {
  checks: string[];
  frequency: "once" | "always";
}

export interface DeviceSelection {
  ios?: string | null;
  android?: string | null;
}

export interface OnSaveAction {
  name: string;
  enabled: boolean;
  haltOnFailure: boolean;
  command?: string;
  glob?: string;
  showOutput: "tool-panel" | "notification" | "silent";
}

export interface MetroInstance {
  worktree: string;
  port: number;
  pid: number;
  status: "starting" | "running" | "error" | "stopped";
  startedAt: Date;
  projectRoot: string;
}

export interface BuildError {
  source: "xcodebuild" | "gradle";
  summary: string;
  file?: string;
  line?: number;
  reason?: string;
  rawOutput: string;
  suggestion?: string;
}

export interface Artifact {
  worktree: string;
  worktreeHash: string;
  metroPort: number | null;
  checksums: {
    packageJson?: string;
    lockfile?: string;
    podfileLock?: string;
  };
  preflightPassed?: boolean;
  lastBuildPort?: number;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
}

export interface ThemeColors {
  bg: string;
  fg: string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  highlight: string;
  selection: string;
}

export type Platform = "ios" | "android" | "both";
export type RunMode = "dirty" | "clean" | "ultra-clean";

export interface PreflightCheck {
  id: string;
  name: string;
  severity: "error" | "warning";
  platform: "ios" | "android" | "all";
  check: () => Promise<PreflightResult>;
  fix?: () => Promise<boolean>;
}

export interface PreflightResult {
  passed: boolean;
  message: string;
  details?: string;
}

export interface RnDevModule {
  id: string;
  name: string;
  icon: string;
  order: number;
  component: React.FC;
  shortcuts?: Shortcut[];
}

export interface Shortcut {
  key: string;
  label: string;
  action: () => Promise<void>;
  showInPanel: boolean;
}
```

- [ ] **Step 7: Create minimal src/index.tsx entry point**

```tsx
#!/usr/bin/env node
import { render } from "ink";
import React from "react";

function App() {
  return <></>;
}

render(<App />);
```

- [ ] **Step 8: Verify build works**

Run: `npx tsx src/index.tsx`
Expected: Exits cleanly with no output (empty app).

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Add .gitignore and commit**

```gitignore
node_modules/
dist/
.rn-dev/
.superpowers/
```

```bash
git add -A
git commit -m "feat: scaffold project with TypeScript, Ink, and core type definitions"
```

---

## Task 2: Logger + Project Detection

**Files:**
- Create: `src/core/logger.ts`, `src/core/project.ts`
- Test: `src/core/__tests__/project.test.ts`, `src/core/__tests__/logger.test.ts`

- [ ] **Step 1: Write failing tests for logger**

```typescript
// src/core/__tests__/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Logger } from "../logger.js";

describe("Logger", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-logs");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes log messages to file", () => {
    const logFile = path.join(tmpDir, "test.log");
    const logger = new Logger(logFile);
    logger.info("hello world");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("hello world");
    expect(content).toContain("INFO");
  });

  it("logs errors with stack traces", () => {
    const logFile = path.join(tmpDir, "test.log");
    const logger = new Logger(logFile);
    logger.error("something broke", new Error("test error"));
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("something broke");
    expect(content).toContain("test error");
  });

  it("respects verbose flag", () => {
    const logFile = path.join(tmpDir, "test.log");
    const logger = new Logger(logFile, false);
    logger.debug("debug msg");
    const content = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf-8")
      : "";
    expect(content).not.toContain("debug msg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Logger**

```typescript
// src/core/logger.ts
import fs from "node:fs";
import path from "node:path";

export class Logger {
  private logFile: string;
  private verbose: boolean;

  constructor(logFile: string, verbose = true) {
    this.logFile = logFile;
    this.verbose = verbose;
    const dir = path.dirname(logFile);
    fs.mkdirSync(dir, { recursive: true });
  }

  private write(level: string, message: string, error?: Error): void {
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] ${level}: ${message}\n`;
    if (error?.stack) {
      line += `  ${error.stack}\n`;
    }
    fs.appendFileSync(this.logFile, line);
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string, error?: Error): void {
    this.write("ERROR", message, error);
  }

  debug(message: string): void {
    if (this.verbose) {
      this.write("DEBUG", message);
    }
  }
}
```

- [ ] **Step 4: Run logger tests**

Run: `npx vitest run src/core/__tests__/logger.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Write failing tests for project detection**

```typescript
// src/core/__tests__/project.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectProjectRoot, isGitRepo, getWorktrees, getCurrentBranch } from "../project.js";

describe("detectProjectRoot", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-project");
  const projectDir = path.join(tmpDir, "my-app");
  const nestedDir = path.join(projectDir, "src", "components");

  beforeEach(() => {
    fs.mkdirSync(nestedDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds project root from nested directory", () => {
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        dependencies: { "react-native": "0.76.0" },
      })
    );
    const result = detectProjectRoot(nestedDir);
    expect(result).toBe(projectDir);
  });

  it("returns null when no RN project found", () => {
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "not-rn", dependencies: {} })
    );
    const result = detectProjectRoot(nestedDir);
    expect(result).toBeNull();
  });

  it("detects react-native in devDependencies", () => {
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        devDependencies: { "react-native": "0.76.0" },
      })
    );
    const result = detectProjectRoot(nestedDir);
    expect(result).toBe(projectDir);
  });
});

describe("isGitRepo", () => {
  it("returns false for non-git directory", () => {
    const tmpDir = path.join(os.tmpdir(), "rn-dev-not-git");
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(isGitRepo(tmpDir)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/project.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement project detection**

```typescript
// src/core/project.ts
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export function detectProjectRoot(fromDir: string): string | null {
  let current = path.resolve(fromDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ("react-native" in deps) {
          return current;
        }
      } catch {
        // malformed package.json, skip
      }
    }
    current = path.dirname(current);
  }
  return null;
}

export function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranch(dir: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

export function getWorktrees(dir: string): Array<{ path: string; branch: string; isMain: boolean }> {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    });

    const worktrees: Array<{ path: string; branch: string; isMain: boolean }> = [];
    let current: Partial<{ path: string; branch: string }> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch refs/heads/".length);
      } else if (line === "") {
        if (current.path && current.branch) {
          worktrees.push({
            path: current.path,
            branch: current.branch,
            isMain: worktrees.length === 0,
          });
        }
        current = {};
      }
    }
    return worktrees;
  } catch {
    return [];
  }
}

export function getRnVersion(projectRoot: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")
    );
    return pkg.dependencies?.["react-native"] ?? pkg.devDependencies?.["react-native"] ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Run project tests**

Run: `npx vitest run src/core/__tests__/project.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/logger.ts src/core/project.ts src/core/__tests__/
git commit -m "feat: add logger and project root detection"
```

---

## Task 3: Artifact + Profile Core

**Files:**
- Create: `src/core/artifact.ts`, `src/core/profile.ts`
- Test: `src/core/__tests__/artifact.test.ts`, `src/core/__tests__/profile.test.ts`

- [ ] **Step 1: Write failing tests for artifact**

```typescript
// src/core/__tests__/artifact.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ArtifactStore } from "../artifact.js";

describe("ArtifactStore", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-artifacts");

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("computes worktree hash from path", () => {
    const store = new ArtifactStore(tmpDir);
    const hash = store.worktreeHash("/Users/dev/project");
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("returns 'root' for root worktree hash", () => {
    const store = new ArtifactStore(tmpDir);
    const hash = store.worktreeHash(null);
    expect(hash).toBe("root");
  });

  it("saves and loads artifact", () => {
    const store = new ArtifactStore(tmpDir);
    store.save("root", { metroPort: 8081, checksums: { packageJson: "abc123" } });
    const loaded = store.load("root");
    expect(loaded?.metroPort).toBe(8081);
    expect(loaded?.checksums.packageJson).toBe("abc123");
  });

  it("detects checksum changes", () => {
    const store = new ArtifactStore(tmpDir);
    store.save("root", { metroPort: 8081, checksums: { packageJson: "abc123" } });
    expect(store.hasChecksumChanged("root", "packageJson", "abc123")).toBe(false);
    expect(store.hasChecksumChanged("root", "packageJson", "def456")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/artifact.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement ArtifactStore**

```typescript
// src/core/artifact.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Artifact } from "./types.js";

export class ArtifactStore {
  private dir: string;

  constructor(artifactsDir: string) {
    this.dir = artifactsDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  worktreeHash(worktreePath: string | null): string {
    if (worktreePath === null) return "root";
    return crypto
      .createHash("sha256")
      .update(worktreePath)
      .digest("hex")
      .slice(0, 12);
  }

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  save(key: string, data: Partial<Artifact>): void {
    const existing = this.load(key) ?? {};
    const merged = { ...existing, ...data };
    fs.writeFileSync(this.filePath(key), JSON.stringify(merged, null, 2));
  }

  load(key: string): Artifact | null {
    const fp = this.filePath(key);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }

  hasChecksumChanged(key: string, field: string, currentChecksum: string): boolean {
    const artifact = this.load(key);
    if (!artifact?.checksums) return true;
    const stored = (artifact.checksums as Record<string, string>)[field];
    return stored !== currentChecksum;
  }

  list(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  }

  remove(key: string): void {
    const fp = this.filePath(key);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

export function computeFileChecksum(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run artifact tests**

Run: `npx vitest run src/core/__tests__/artifact.test.ts`
Expected: All PASS.

- [ ] **Step 5: Write failing tests for profile**

```typescript
// src/core/__tests__/profile.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProfileStore } from "../profile.js";

describe("ProfileStore", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-profiles");

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("saves and loads a profile", () => {
    const store = new ProfileStore(tmpDir);
    const profile = {
      name: "dev-ios",
      isDefault: true,
      worktree: null,
      branch: "main",
      platform: "ios" as const,
      mode: "dirty" as const,
      metroPort: 8081,
      devices: { ios: null },
      buildVariant: "debug" as const,
      preflight: { checks: ["node-version"], frequency: "once" as const },
      onSave: [],
      env: {},
      projectRoot: "/tmp/project",
    };
    store.save(profile);
    const loaded = store.load("dev-ios");
    expect(loaded?.name).toBe("dev-ios");
    expect(loaded?.platform).toBe("ios");
  });

  it("finds default profile for worktree+branch", () => {
    const store = new ProfileStore(tmpDir);
    store.save({
      name: "p1", isDefault: false, worktree: null, branch: "main",
      platform: "ios", mode: "dirty", metroPort: 8081, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    store.save({
      name: "p2", isDefault: true, worktree: null, branch: "main",
      platform: "android", mode: "clean", metroPort: 8082, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    const defaultProfile = store.findDefault(null, "main");
    expect(defaultProfile?.name).toBe("p2");
  });

  it("lists all profiles", () => {
    const store = new ProfileStore(tmpDir);
    store.save({
      name: "a", isDefault: true, worktree: null, branch: "main",
      platform: "ios", mode: "dirty", metroPort: 8081, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    store.save({
      name: "b", isDefault: false, worktree: null, branch: "dev",
      platform: "android", mode: "clean", metroPort: 8082, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    expect(store.list()).toHaveLength(2);
  });

  it("sets a new default, unsetting the previous", () => {
    const store = new ProfileStore(tmpDir);
    store.save({
      name: "old-default", isDefault: true, worktree: null, branch: "main",
      platform: "ios", mode: "dirty", metroPort: 8081, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    store.save({
      name: "new-default", isDefault: false, worktree: null, branch: "main",
      platform: "ios", mode: "clean", metroPort: 8082, devices: {},
      buildVariant: "debug", preflight: { checks: [], frequency: "once" },
      onSave: [], env: {}, projectRoot: "/tmp",
    });
    store.setDefault("new-default", null, "main");
    expect(store.load("old-default")?.isDefault).toBe(false);
    expect(store.load("new-default")?.isDefault).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/profile.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement ProfileStore**

```typescript
// src/core/profile.ts
import fs from "node:fs";
import path from "node:path";
import type { Profile } from "./types.js";

export class ProfileStore {
  private dir: string;

  constructor(profilesDir: string) {
    this.dir = profilesDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }

  save(profile: Profile): void {
    fs.writeFileSync(this.filePath(profile.name), JSON.stringify(profile, null, 2));
  }

  load(name: string): Profile | null {
    const fp = this.filePath(name);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }

  list(): Profile[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.load(f.replace(".json", "")))
      .filter((p): p is Profile => p !== null);
  }

  findDefault(worktree: string | null, branch: string): Profile | null {
    return (
      this.list().find(
        (p) => p.worktree === worktree && p.branch === branch && p.isDefault
      ) ?? null
    );
  }

  findForWorktreeBranch(worktree: string | null, branch: string): Profile[] {
    return this.list().filter(
      (p) => p.worktree === worktree && p.branch === branch
    );
  }

  setDefault(name: string, worktree: string | null, branch: string): void {
    const profiles = this.findForWorktreeBranch(worktree, branch);
    for (const p of profiles) {
      if (p.isDefault && p.name !== name) {
        p.isDefault = false;
        this.save(p);
      }
    }
    const target = this.load(name);
    if (target) {
      target.isDefault = true;
      this.save(target);
    }
  }

  delete(name: string): boolean {
    const fp = this.filePath(name);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 8: Run profile tests**

Run: `npx vitest run src/core/__tests__/profile.test.ts`
Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/artifact.ts src/core/profile.ts src/core/__tests__/
git commit -m "feat: add artifact store and profile management"
```

---

## Task 4: Themes

**Files:**
- Create: `src/themes/midnight.json`, `src/themes/ember.json`, `src/themes/arctic.json`, `src/themes/neon-drive.json`, `src/ui/theme-provider.tsx`
- Test: `src/ui/__tests__/theme-provider.test.tsx`

- [ ] **Step 1: Create the 4 theme JSON files**

`src/themes/midnight.json`:
```json
{
  "name": "Midnight",
  "colors": {
    "bg": "#1a1b26", "fg": "#c0caf5", "border": "#565f89", "accent": "#7aa2f7",
    "success": "#9ece6a", "warning": "#e0af68", "error": "#f7768e",
    "muted": "#565f89", "highlight": "#bb9af7", "selection": "#283457"
  }
}
```

`src/themes/ember.json`:
```json
{
  "name": "Ember",
  "colors": {
    "bg": "#1d2021", "fg": "#d4be98", "border": "#504945", "accent": "#e78a4e",
    "success": "#a9b665", "warning": "#d8a657", "error": "#ea6962",
    "muted": "#504945", "highlight": "#d3869b", "selection": "#3c3836"
  }
}
```

`src/themes/arctic.json`:
```json
{
  "name": "Arctic",
  "colors": {
    "bg": "#2e3440", "fg": "#d8dee9", "border": "#4c566a", "accent": "#88c0d0",
    "success": "#a3be8c", "warning": "#ebcb8b", "error": "#bf616a",
    "muted": "#4c566a", "highlight": "#b48ead", "selection": "#3b4252"
  }
}
```

`src/themes/neon-drive.json`:
```json
{
  "name": "Neon Drive",
  "colors": {
    "bg": "#170b26", "fg": "#f0e4fc", "border": "#585273", "accent": "#ff6ac1",
    "success": "#72f1b8", "warning": "#fede5d", "error": "#fe4450",
    "muted": "#585273", "highlight": "#b893ff", "selection": "#2b1f3e"
  }
}
```

- [ ] **Step 2: Write failing test for theme provider**

```typescript
// src/ui/__tests__/theme-provider.test.tsx
import { describe, it, expect } from "vitest";
import { loadBuiltInTheme, loadTheme, listThemes } from "../theme-provider.js";

describe("loadBuiltInTheme", () => {
  it("loads midnight theme", () => {
    const theme = loadBuiltInTheme("midnight");
    expect(theme.name).toBe("Midnight");
    expect(theme.colors.accent).toBe("#7aa2f7");
  });

  it("loads all 4 built-in themes", () => {
    const names = ["midnight", "ember", "arctic", "neon-drive"];
    for (const name of names) {
      const theme = loadBuiltInTheme(name);
      expect(theme.name).toBeTruthy();
      expect(theme.colors.bg).toBeTruthy();
    }
  });

  it("throws for unknown theme", () => {
    expect(() => loadBuiltInTheme("nonexistent")).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/ui/__tests__/theme-provider.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement theme provider**

```tsx
// src/ui/theme-provider.tsx
import React, { createContext, useContext } from "react";
import type { Theme, ThemeColors } from "../core/types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import midnightTheme from "../themes/midnight.json" assert { type: "json" };
import emberTheme from "../themes/ember.json" assert { type: "json" };
import arcticTheme from "../themes/arctic.json" assert { type: "json" };
import neonDriveTheme from "../themes/neon-drive.json" assert { type: "json" };

const BUILT_IN_THEMES: Record<string, Theme> = {
  midnight: midnightTheme as Theme,
  ember: emberTheme as Theme,
  arctic: arcticTheme as Theme,
  "neon-drive": neonDriveTheme as Theme,
};

export function loadBuiltInTheme(name: string): Theme {
  const theme = BUILT_IN_THEMES[name];
  if (!theme) {
    throw new Error(`Unknown built-in theme: ${name}. Available: ${Object.keys(BUILT_IN_THEMES).join(", ")}`);
  }
  return theme;
}

export function loadTheme(name: string, customThemesDir?: string): Theme {
  // Try built-in first
  if (name in BUILT_IN_THEMES) return BUILT_IN_THEMES[name];

  // Try custom theme dir
  if (customThemesDir) {
    const customPath = path.join(customThemesDir, `${name}.json`);
    if (fs.existsSync(customPath)) {
      return JSON.parse(fs.readFileSync(customPath, "utf-8"));
    }
  }

  throw new Error(`Theme not found: ${name}`);
}

export function listThemes(customThemesDir?: string): string[] {
  const themes = Object.keys(BUILT_IN_THEMES);
  if (customThemesDir && fs.existsSync(customThemesDir)) {
    const custom = fs.readdirSync(customThemesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
    themes.push(...custom);
  }
  return themes;
}

const ThemeContext = createContext<ThemeColors>(midnightTheme.colors as ThemeColors);

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme.colors}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}
```

- [ ] **Step 5: Run theme tests**

Run: `npx vitest run src/ui/__tests__/theme-provider.test.tsx`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/themes/ src/ui/theme-provider.tsx src/ui/__tests__/
git commit -m "feat: add 4 built-in themes and theme provider"
```

---

## Task 5: Device Discovery

**Files:**
- Create: `src/core/device.ts`
- Test: `src/core/__tests__/device.test.ts`

- [ ] **Step 1: Write failing tests for device parsing**

```typescript
// src/core/__tests__/device.test.ts
import { describe, it, expect } from "vitest";
import { parseAdbDevices, parseSimctlDevices } from "../device.js";

describe("parseAdbDevices", () => {
  it("parses adb devices output", () => {
    const output = `List of devices attached
emulator-5554\tdevice
R5CR1234567\tdevice
unauthorized-device\tunauthorized
`;
    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual({ id: "emulator-5554", name: "emulator-5554", type: "android", status: "available" });
    expect(devices[2].status).toBe("unauthorized");
  });

  it("handles empty output", () => {
    expect(parseAdbDevices("List of devices attached\n")).toEqual([]);
  });
});

describe("parseSimctlDevices", () => {
  it("parses simctl JSON output", () => {
    const json = {
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "ABC-123", name: "iPhone 15 Pro", state: "Booted", isAvailable: true },
          { udid: "DEF-456", name: "iPad Air", state: "Shutdown", isAvailable: true },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
          { udid: "GHI-789", name: "iPhone 14", state: "Shutdown", isAvailable: false },
        ],
      },
    };
    const devices = parseSimctlDevices(JSON.stringify(json));
    expect(devices).toHaveLength(2); // only available
    expect(devices[0]).toEqual({
      id: "ABC-123", name: "iPhone 15 Pro", type: "ios",
      status: "booted", runtime: "iOS-17-2",
    });
    expect(devices[1].status).toBe("shutdown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/device.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement device discovery**

```typescript
// src/core/device.ts
import { execSync } from "node:child_process";

export interface Device {
  id: string;
  name: string;
  type: "ios" | "android";
  status: "available" | "booted" | "shutdown" | "unauthorized";
  runtime?: string;
}

export function parseAdbDevices(output: string): Device[] {
  const lines = output.split("\n").filter((l) => l.includes("\t"));
  return lines.map((line) => {
    const [id, state] = line.split("\t");
    return {
      id: id.trim(),
      name: id.trim(),
      type: "android" as const,
      status: state.trim() === "device" ? "available" as const : "unauthorized" as const,
    };
  });
}

export function parseSimctlDevices(jsonOutput: string): Device[] {
  const data = JSON.parse(jsonOutput);
  const devices: Device[] = [];
  for (const [runtime, sims] of Object.entries(data.devices)) {
    const runtimeShort = runtime.replace("com.apple.CoreSimulator.SimRuntime.", "");
    for (const sim of sims as any[]) {
      if (!sim.isAvailable) continue;
      devices.push({
        id: sim.udid,
        name: sim.name,
        type: "ios",
        status: sim.state === "Booted" ? "booted" : "shutdown",
        runtime: runtimeShort,
      });
    }
  }
  return devices;
}

export function listDevices(platform: "ios" | "android" | "both"): Device[] {
  const devices: Device[] = [];

  if (platform === "ios" || platform === "both") {
    try {
      const output = execSync("xcrun simctl list devices --json", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      devices.push(...parseSimctlDevices(output));
    } catch {
      // xcrun not available
    }
  }

  if (platform === "android" || platform === "both") {
    try {
      const output = execSync("adb devices", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      devices.push(...parseAdbDevices(output));
    } catch {
      // adb not available
    }
  }

  return devices;
}

export function bootDevice(device: Device): boolean {
  try {
    if (device.type === "ios") {
      execSync(`xcrun simctl boot ${device.id}`, { stdio: "pipe" });
    }
    // Android emulators: typically need `emulator -avd <name>` which is async
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run device tests**

Run: `npx vitest run src/core/__tests__/device.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/device.ts src/core/__tests__/device.test.ts
git commit -m "feat: add device discovery for iOS simulators and Android devices"
```

---

## Task 6: Tooling Detector + Build Parser

**Files:**
- Create: `src/core/tooling-detector.ts`, `src/core/build-parser.ts`
- Test: `src/core/__tests__/tooling-detector.test.ts`, `src/core/__tests__/build-parser.test.ts`

- [ ] **Step 1: Write failing tests for tooling detector**

```typescript
// src/core/__tests__/tooling-detector.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectTooling } from "../tooling-detector.js";

describe("detectTooling", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-tooling");

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("detects eslint config", () => {
    fs.writeFileSync(path.join(tmpDir, ".eslintrc.js"), "module.exports = {};");
    const result = detectTooling(tmpDir);
    expect(result.find((t) => t.name === "lint")).toBeTruthy();
  });

  it("detects tsconfig", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    const result = detectTooling(tmpDir);
    expect(result.find((t) => t.name === "type-check")).toBeTruthy();
  });

  it("detects jest in package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { jest: "^29" } })
    );
    const result = detectTooling(tmpDir);
    expect(result.find((t) => t.name === "test-related")).toBeTruthy();
  });

  it("returns empty for project with no tooling", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({}));
    const result = detectTooling(tmpDir);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/tooling-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement tooling detector**

```typescript
// src/core/tooling-detector.ts
import fs from "node:fs";
import path from "node:path";
import type { OnSaveAction } from "./types.js";

interface DetectedTool {
  name: string;
  label: string;
  configFile: string;
  command: string;
}

const ESLINT_CONFIGS = [
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml",
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
];

const JEST_CONFIGS = ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"];

const BIOME_CONFIGS = ["biome.json", "biome.jsonc"];

export function detectTooling(projectRoot: string): DetectedTool[] {
  const tools: DetectedTool[] = [];

  // ESLint
  for (const config of ESLINT_CONFIGS) {
    if (fs.existsSync(path.join(projectRoot, config))) {
      tools.push({ name: "lint", label: `eslint — ${config} found`, configFile: config, command: "npx eslint {files}" });
      break;
    }
  }

  // TypeScript
  if (fs.existsSync(path.join(projectRoot, "tsconfig.json"))) {
    tools.push({ name: "type-check", label: "tsc — tsconfig.json found", configFile: "tsconfig.json", command: "npx tsc --noEmit" });
  }

  // Jest
  let jestFound = false;
  for (const config of JEST_CONFIGS) {
    if (fs.existsSync(path.join(projectRoot, config))) {
      jestFound = true;
      tools.push({ name: "test-related", label: `jest — ${config} found`, configFile: config, command: "npx jest --bail --findRelatedTests {file}" });
      break;
    }
  }
  if (!jestFound) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
      if (pkg.devDependencies?.jest || pkg.dependencies?.jest || pkg.jest) {
        tools.push({ name: "test-related", label: "jest — package.json config", configFile: "package.json", command: "npx jest --bail --findRelatedTests {file}" });
      }
    } catch { /* no package.json */ }
  }

  // Biome
  for (const config of BIOME_CONFIGS) {
    if (fs.existsSync(path.join(projectRoot, config))) {
      tools.push({ name: "biome-check", label: `biome — ${config} found`, configFile: config, command: "npx biome check {files}" });
      break;
    }
  }

  return tools;
}

export function toolToOnSaveAction(tool: DetectedTool, enabled = true): OnSaveAction {
  return {
    name: tool.name,
    enabled,
    haltOnFailure: false,
    command: tool.command,
    glob: "src/**/*.{ts,tsx,js,jsx}",
    showOutput: "tool-panel",
  };
}
```

- [ ] **Step 4: Run tooling detector tests**

Run: `npx vitest run src/core/__tests__/tooling-detector.test.ts`
Expected: All PASS.

- [ ] **Step 5: Write failing tests for build parser**

```typescript
// src/core/__tests__/build-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseXcodebuildErrors, parseGradleErrors } from "../build-parser.js";

describe("parseXcodebuildErrors", () => {
  it("extracts error: lines", () => {
    const output = `
CompileSwift normal arm64 AppDelegate.swift
/path/to/AppDelegate.swift:3:8: error: no such module 'RNReanimated'
import RNReanimated
`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].summary).toContain("no such module 'RNReanimated'");
    expect(errors[0].file).toBe("/path/to/AppDelegate.swift");
    expect(errors[0].line).toBe(3);
    expect(errors[0].suggestion).toContain("pod install");
  });

  it("extracts linker errors", () => {
    const output = `ld: duplicate symbol '_OBJC_CLASS_$_Something' in:
  /path/to/libA.a
  /path/to/libB.a
`;
    const errors = parseXcodebuildErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].summary).toContain("duplicate symbol");
  });

  it("returns empty for clean build", () => {
    expect(parseXcodebuildErrors("** BUILD SUCCEEDED **")).toEqual([]);
  });
});

describe("parseGradleErrors", () => {
  it("extracts FAILURE block", () => {
    const output = `
> Task :app:compileDebugKotlin FAILED
FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task ':app:compileDebugKotlin'.
> Compilation error. See log for more details.
`;
    const errors = parseGradleErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].summary).toContain("compileDebugKotlin");
  });

  it("extracts Caused by chains", () => {
    const output = `
FAILURE: Build failed with an exception.
Caused by: java.lang.RuntimeException: SDK location not found
`;
    const errors = parseGradleErrors(output);
    expect(errors.some((e) => e.reason?.includes("SDK location not found"))).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/build-parser.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement build parser**

```typescript
// src/core/build-parser.ts
import type { BuildError } from "./types.js";

const XCODE_SUGGESTIONS: Record<string, string> = {
  "no such module": "Try: pod install, or clean build (press 'c')",
  "signing requires": "Set DEVELOPMENT_TEAM in Xcode or .xcconfig",
  "duplicate symbol": "Check for conflicting pod versions",
  "framework not found": "Try: pod deintegrate && pod install",
  "sandbox: rsync denied": "Xcode 15+ issue: disable ENABLE_USER_SCRIPT_SANDBOXING",
  "sdk does not contain": "Update Xcode or change IPHONEOS_DEPLOYMENT_TARGET",
};

const GRADLE_SUGGESTIONS: Record<string, string> = {
  "could not resolve dependencies": "Check gradle repositories and dependency versions",
  "dex merge": "Enable multidex or resolve duplicate dependencies",
  "java_home is not set": "Run preflight fix (press 'f')",
  "sdk location not found": "Set ANDROID_HOME environment variable",
};

export function parseXcodebuildErrors(output: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // error: pattern — /path/to/file.swift:3:8: error: message
    const errorMatch = line.match(/^(.+?):(\d+):\d+:\s*error:\s*(.+)/);
    if (errorMatch) {
      const [, file, lineNum, message] = errorMatch;
      errors.push({
        source: "xcodebuild",
        summary: message.trim(),
        file: file.trim(),
        line: parseInt(lineNum, 10),
        reason: findReason(lines, i),
        rawOutput: extractContext(lines, i),
        suggestion: matchSuggestion(message, XCODE_SUGGESTIONS),
      });
      continue;
    }

    // ld: errors
    if (line.startsWith("ld: ")) {
      errors.push({
        source: "xcodebuild",
        summary: line.slice(4).trim(),
        rawOutput: extractContext(lines, i),
        suggestion: matchSuggestion(line, XCODE_SUGGESTIONS),
      });
      continue;
    }

    // fatal error
    const fatalMatch = line.match(/fatal error:\s*(.+)/);
    if (fatalMatch) {
      errors.push({
        source: "xcodebuild",
        summary: fatalMatch[1].trim(),
        rawOutput: extractContext(lines, i),
        suggestion: matchSuggestion(line, XCODE_SUGGESTIONS),
      });
    }
  }

  return errors;
}

export function parseGradleErrors(output: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = output.split("\n");

  // Find FAILURE block
  const failureIndex = lines.findIndex((l) => l.startsWith("FAILURE:"));
  if (failureIndex >= 0) {
    // Look for "What went wrong"
    let summary = "Build failed";
    const whatWrongIdx = lines.findIndex((l, i) => i > failureIndex && l.includes("What went wrong"));
    if (whatWrongIdx >= 0 && whatWrongIdx + 1 < lines.length) {
      summary = lines[whatWrongIdx + 1].trim().replace(/^>\s*/, "");
    }

    // Find Caused by chains
    const causedByLines = lines
      .filter((l) => l.trim().startsWith("Caused by:"))
      .map((l) => l.trim().replace("Caused by: ", ""));
    const reason = causedByLines.length > 0 ? causedByLines[causedByLines.length - 1] : undefined;

    // Also find FAILED tasks
    const failedTask = lines.find((l) => l.includes("FAILED"));
    if (failedTask) {
      const taskMatch = failedTask.match(/Task\s+:(\S+)\s+FAILED/);
      if (taskMatch) {
        summary = `Task ${taskMatch[1]} failed: ${summary}`;
      }
    }

    errors.push({
      source: "gradle",
      summary,
      reason,
      rawOutput: lines.slice(Math.max(0, failureIndex - 5), failureIndex + 15).join("\n"),
      suggestion: matchSuggestion(summary + (reason ?? ""), GRADLE_SUGGESTIONS),
    });
  }

  return errors;
}

function findReason(lines: string[], fromIndex: number): string | undefined {
  for (let i = fromIndex; i < Math.min(fromIndex + 10, lines.length); i++) {
    const line = lines[i].toLowerCase();
    if (line.includes("reason:") || line.includes("caused by") || line.includes("underlying error")) {
      return lines[i].trim();
    }
  }
  return undefined;
}

function extractContext(lines: string[], index: number, radius = 3): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join("\n");
}

function matchSuggestion(text: string, suggestions: Record<string, string>): string | undefined {
  const lower = text.toLowerCase();
  for (const [pattern, suggestion] of Object.entries(suggestions)) {
    if (lower.includes(pattern)) return suggestion;
  }
  return undefined;
}
```

- [ ] **Step 8: Run build parser tests**

Run: `npx vitest run src/core/__tests__/build-parser.test.ts`
Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/tooling-detector.ts src/core/build-parser.ts src/core/__tests__/
git commit -m "feat: add tooling detector and build error parser"
```

---

## Task 7: Metro Manager

**Files:**
- Create: `src/core/metro.ts`
- Test: `src/core/__tests__/metro.test.ts`

- [ ] **Step 1: Write failing tests for port allocation**

```typescript
// src/core/__tests__/metro.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MetroManager } from "../metro.js";
import { ArtifactStore } from "../artifact.js";

describe("MetroManager", () => {
  const tmpDir = path.join(os.tmpdir(), "rn-dev-test-metro");
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    artifactStore = new ArtifactStore(path.join(tmpDir, "artifacts"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allocates first available port", () => {
    const mgr = new MetroManager(artifactStore, 8081, 8099);
    const port = mgr.allocatePort("root");
    expect(port).toBe(8081);
  });

  it("reuses persisted port for same worktree", () => {
    artifactStore.save("root", { metroPort: 8085, checksums: {} } as any);
    const mgr = new MetroManager(artifactStore, 8081, 8099);
    const port = mgr.allocatePort("root");
    expect(port).toBe(8085);
  });

  it("skips ports already allocated to other worktrees", () => {
    const mgr = new MetroManager(artifactStore, 8081, 8099);
    mgr.allocatePort("root"); // takes 8081
    mgr.markPortInUse(8081, "root");
    const port2 = mgr.allocatePort("abc123");
    expect(port2).toBe(8082);
  });

  it("throws when port pool exhausted", () => {
    const mgr = new MetroManager(artifactStore, 8081, 8082); // only 2 ports
    mgr.allocatePort("root");
    mgr.markPortInUse(8081, "root");
    mgr.allocatePort("aaa");
    mgr.markPortInUse(8082, "aaa");
    expect(() => mgr.allocatePort("bbb")).toThrow("No available ports");
  });

  it("detects port mismatch for dirty mode", () => {
    artifactStore.save("root", { metroPort: 8081, lastBuildPort: 8082, checksums: {} } as any);
    const mgr = new MetroManager(artifactStore, 8081, 8099);
    expect(mgr.hasPortMismatch("root")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/metro.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement MetroManager**

```typescript
// src/core/metro.ts
import { ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import type { MetroInstance } from "./types.js";
import type { ArtifactStore } from "./artifact.js";

export class MetroManager {
  private artifactStore: ArtifactStore;
  private portMin: number;
  private portMax: number;
  private portsInUse: Map<number, string> = new Map(); // port -> worktreeKey
  private instances: Map<string, MetroInstance & { process?: ChildProcess }> = new Map();
  private crashCounts: Map<string, { count: number; firstCrash: number }> = new Map();

  constructor(artifactStore: ArtifactStore, portMin = 8081, portMax = 8099) {
    this.artifactStore = artifactStore;
    this.portMin = portMin;
    this.portMax = portMax;
  }

  allocatePort(worktreeKey: string): number {
    // Check if worktree already has a persisted port
    const artifact = this.artifactStore.load(worktreeKey);
    if (artifact?.metroPort && !this.portsInUse.has(artifact.metroPort)) {
      return artifact.metroPort;
    }

    // Find first available port
    for (let port = this.portMin; port <= this.portMax; port++) {
      if (!this.portsInUse.has(port)) {
        return port;
      }
    }
    throw new Error(`No available ports in range ${this.portMin}-${this.portMax}`);
  }

  markPortInUse(port: number, worktreeKey: string): void {
    this.portsInUse.set(port, worktreeKey);
  }

  releasePort(port: number): void {
    this.portsInUse.delete(port);
  }

  hasPortMismatch(worktreeKey: string): boolean {
    const artifact = this.artifactStore.load(worktreeKey);
    if (!artifact) return false;
    return (
      artifact.lastBuildPort !== undefined &&
      artifact.metroPort !== undefined &&
      artifact.lastBuildPort !== artifact.metroPort
    );
  }

  async start(
    worktreeKey: string,
    projectRoot: string,
    port: number,
    options: { resetCache?: boolean; verbose?: boolean } = {}
  ): Promise<MetroInstance> {
    const args = ["start", "--port", String(port)];
    if (options.resetCache) args.push("--reset-cache");
    if (options.verbose) args.push("--verbose");

    const child = spawn("npx", ["react-native", ...args], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        REACT_NATIVE_PACKAGER_HOSTNAME: "localhost",
      },
    });

    const instance: MetroInstance & { process?: ChildProcess } = {
      worktree: worktreeKey,
      port,
      pid: child.pid ?? 0,
      status: "starting",
      startedAt: new Date(),
      projectRoot,
      process: child,
    };

    this.instances.set(worktreeKey, instance);
    this.markPortInUse(port, worktreeKey);
    this.artifactStore.save(worktreeKey, { metroPort: port } as any);

    return instance;
  }

  async stop(worktreeKey: string): Promise<void> {
    const instance = this.instances.get(worktreeKey);
    if (instance?.process) {
      instance.process.kill("SIGTERM");
      instance.status = "stopped";
      this.releasePort(instance.port);
      this.instances.delete(worktreeKey);
    }
  }

  getInstance(worktreeKey: string): MetroInstance | undefined {
    return this.instances.get(worktreeKey);
  }

  getAllInstances(): MetroInstance[] {
    return Array.from(this.instances.values());
  }

  recordCrash(worktreeKey: string): { shouldRetry: boolean; backoffMs: number; crashCount: number } {
    const now = Date.now();
    const record = this.crashCounts.get(worktreeKey) ?? { count: 0, firstCrash: now };

    // Reset if last crash was more than 60s ago
    if (now - record.firstCrash > 60_000) {
      record.count = 0;
      record.firstCrash = now;
    }

    record.count++;
    this.crashCounts.set(worktreeKey, record);

    if (record.count >= 3) {
      return { shouldRetry: false, backoffMs: 0, crashCount: record.count };
    }

    const backoffMs = Math.min(1000 * Math.pow(2, record.count - 1), 30_000);
    return { shouldRetry: true, backoffMs, crashCount: record.count };
  }
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}
```

- [ ] **Step 4: Run metro tests**

Run: `npx vitest run src/core/__tests__/metro.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/metro.ts src/core/__tests__/metro.test.ts
git commit -m "feat: add metro manager with port allocation and crash handling"
```

---

## Task 8: Clean Operations + Xcode Kill Check

**Files:**
- Create: `src/core/clean.ts`
- Test: `src/core/__tests__/clean.test.ts`

- [ ] **Step 1: Write failing tests for clean operations**

```typescript
// src/core/__tests__/clean.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildCleanSteps, isXcodeRunning, isRunningViaNodeModules } from "../clean.js";

describe("buildCleanSteps", () => {
  it("returns no dependency steps for dirty mode", () => {
    const steps = buildCleanSteps("dirty", "ios", "/project");
    expect(steps.filter((s) => s.type === "install-deps")).toHaveLength(0);
  });

  it("returns install steps for clean mode", () => {
    const steps = buildCleanSteps("clean", "ios", "/project");
    expect(steps.some((s) => s.id === "install-node-modules")).toBe(true);
    expect(steps.some((s) => s.id === "pod-install")).toBe(true);
  });

  it("skips pod steps for android-only", () => {
    const steps = buildCleanSteps("clean", "android", "/project");
    expect(steps.some((s) => s.id === "pod-install")).toBe(false);
  });

  it("includes all cleanup steps for ultra-clean", () => {
    const steps = buildCleanSteps("ultra-clean", "both", "/project");
    expect(steps.some((s) => s.id === "kill-metro")).toBe(true);
    expect(steps.some((s) => s.id === "remove-node-modules")).toBe(true);
    expect(steps.some((s) => s.id === "pod-deintegrate")).toBe(true);
    expect(steps.some((s) => s.id === "gradle-stop")).toBe(true);
    expect(steps.some((s) => s.id === "install-node-modules")).toBe(true);
  });
});

describe("isRunningViaNodeModules", () => {
  it("detects when running from node_modules", () => {
    expect(isRunningViaNodeModules("/project/node_modules/.bin/rn-dev", "/project")).toBe(true);
  });

  it("returns false for global install", () => {
    expect(isRunningViaNodeModules("/usr/local/bin/rn-dev", "/project")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/clean.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement clean operations**

```typescript
// src/core/clean.ts
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RunMode, Platform } from "./types.js";

export interface CleanStep {
  id: string;
  label: string;
  type: "cleanup" | "install-deps" | "xcode-check";
  platform: "ios" | "android" | "all";
  execute: () => Promise<void>;
}

export function buildCleanSteps(mode: RunMode, platform: Platform, projectRoot: string): CleanStep[] {
  if (mode === "dirty") return [];

  const steps: CleanStep[] = [];
  const isIos = platform === "ios" || platform === "both";
  const isAndroid = platform === "android" || platform === "both";

  if (mode === "ultra-clean") {
    steps.push({
      id: "kill-metro", label: "Kill Metro + Watchman", type: "cleanup", platform: "all",
      execute: async () => {
        try { execSync("watchman watch-del-all", { stdio: "pipe" }); } catch {}
      },
    });

    steps.push({
      id: "remove-node-modules", label: "Remove node_modules", type: "cleanup", platform: "all",
      execute: async () => {
        fs.rmSync(path.join(projectRoot, "node_modules"), { recursive: true, force: true });
      },
    });

    steps.push({
      id: "clean-metro-cache", label: "Clean Metro cache", type: "cleanup", platform: "all",
      execute: async () => {
        const tmpdir = os.tmpdir();
        for (const entry of fs.readdirSync(tmpdir)) {
          if (entry.startsWith("metro-") || entry.startsWith("haste-map-")) {
            fs.rmSync(path.join(tmpdir, entry), { recursive: true, force: true });
          }
        }
      },
    });

    if (isIos) {
      steps.push({
        id: "pod-deintegrate", label: "Pod deintegrate + clean", type: "cleanup", platform: "ios",
        execute: async () => {
          const iosDir = path.join(projectRoot, "ios");
          try { execSync("pod deintegrate", { cwd: iosDir, stdio: "pipe" }); } catch {}
          fs.rmSync(path.join(iosDir, "Pods"), { recursive: true, force: true });
          fs.rmSync(path.join(iosDir, "build"), { recursive: true, force: true });
        },
      });
    }

    if (isAndroid) {
      steps.push({
        id: "gradle-stop", label: "Stop Gradle daemon + clean", type: "cleanup", platform: "android",
        execute: async () => {
          const androidDir = path.join(projectRoot, "android");
          try { execSync("./gradlew --stop", { cwd: androidDir, stdio: "pipe" }); } catch {}
          fs.rmSync(path.join(androidDir, ".gradle"), { recursive: true, force: true });
          fs.rmSync(path.join(androidDir, "app", "build"), { recursive: true, force: true });
        },
      });
    }

    if (isAndroid) {
      steps.push({
        id: "uninstall-android", label: "Uninstall Android app", type: "cleanup", platform: "android",
        execute: async () => {
          // bundleId detection from build.gradle deferred to runtime
        },
      });
    }

    if (isIos) {
      steps.push({
        id: "uninstall-ios", label: "Uninstall iOS app", type: "cleanup", platform: "ios",
        execute: async () => {
          // deviceId + bundleId needed at runtime
        },
      });
    }
  }

  // Install steps (both clean and ultra-clean)
  steps.push({
    id: "install-node-modules", label: "Install node_modules", type: "install-deps", platform: "all",
    execute: async () => {
      const cmd = detectPackageManager(projectRoot);
      execSync(cmd, { cwd: projectRoot, stdio: "pipe" });
    },
  });

  if (isIos) {
    steps.push({
      id: "xcode-check", label: "Check if Xcode is running", type: "xcode-check", platform: "ios",
      execute: async () => { /* handled by UI layer */ },
    });
    steps.push({
      id: "pod-install", label: "Pod install", type: "install-deps", platform: "ios",
      execute: async () => {
        execSync("pod install", { cwd: path.join(projectRoot, "ios"), stdio: "pipe" });
      },
    });
  }

  return steps;
}

export function isXcodeRunning(): boolean {
  try {
    execSync("pgrep -x Xcode", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function killXcode(): void {
  try {
    execSync("killall Xcode", { stdio: "pipe" });
    // Wait a moment for Xcode to fully exit
    execSync("sleep 2", { stdio: "pipe" });
  } catch {}
}

export function isRunningViaNodeModules(argv1: string, projectRoot: string): boolean {
  const resolved = path.resolve(argv1);
  const nodeModulesPath = path.join(path.resolve(projectRoot), "node_modules");
  return resolved.startsWith(nodeModulesPath);
}

function detectPackageManager(projectRoot: string): string {
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn install";
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm install";
  if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) return "bun install";
  return "npm install";
}
```

- [ ] **Step 4: Run clean tests**

Run: `npx vitest run src/core/__tests__/clean.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/clean.ts src/core/__tests__/clean.test.ts
git commit -m "feat: add clean operations with Xcode kill check and self-preservation detection"
```

---

## Task 9: File Watcher

**Files:**
- Create: `src/core/watcher.ts`
- Test: `src/core/__tests__/watcher.test.ts`

- [ ] **Step 1: Write failing tests for watcher pipeline**

```typescript
// src/core/__tests__/watcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildPipeline, matchesGlob } from "../watcher.js";
import type { OnSaveAction } from "../types.js";

describe("buildPipeline", () => {
  it("filters disabled actions", () => {
    const actions: OnSaveAction[] = [
      { name: "lint", enabled: true, haltOnFailure: false, showOutput: "tool-panel" },
      { name: "type-check", enabled: false, haltOnFailure: false, showOutput: "tool-panel" },
    ];
    const pipeline = buildPipeline(actions);
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].name).toBe("lint");
  });

  it("replaces {file} placeholder", () => {
    const actions: OnSaveAction[] = [
      { name: "test", enabled: true, haltOnFailure: false, command: "jest --findRelatedTests {file}", showOutput: "tool-panel" },
    ];
    const pipeline = buildPipeline(actions);
    const cmd = pipeline[0].resolveCommand(["src/App.tsx", "src/utils.ts"]);
    expect(cmd).toBe("jest --findRelatedTests src/App.tsx");
  });

  it("replaces {files} placeholder", () => {
    const actions: OnSaveAction[] = [
      { name: "lint", enabled: true, haltOnFailure: false, command: "eslint {files}", showOutput: "tool-panel" },
    ];
    const pipeline = buildPipeline(actions);
    const cmd = pipeline[0].resolveCommand(["src/App.tsx", "src/utils.ts"]);
    expect(cmd).toBe("eslint src/App.tsx src/utils.ts");
  });
});

describe("matchesGlob", () => {
  it("matches glob pattern", () => {
    expect(matchesGlob("src/App.tsx", "src/**/*.tsx")).toBe(true);
  });

  it("rejects non-matching path", () => {
    expect(matchesGlob("tests/App.test.ts", "src/**/*.tsx")).toBe(false);
  });

  it("matches everything when no glob specified", () => {
    expect(matchesGlob("anything.ts", undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/watcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement watcher**

```typescript
// src/core/watcher.ts
import { watch, type FSWatcher } from "chokidar";
import { execSync } from "node:child_process";
import path from "node:path";
import type { OnSaveAction } from "./types.js";

export interface PipelineAction {
  name: string;
  haltOnFailure: boolean;
  showOutput: "tool-panel" | "notification" | "silent";
  glob?: string;
  resolveCommand: (files: string[]) => string;
}

export function buildPipeline(actions: OnSaveAction[]): PipelineAction[] {
  return actions
    .filter((a) => a.enabled)
    .map((a) => ({
      name: a.name,
      haltOnFailure: a.haltOnFailure,
      showOutput: a.showOutput,
      glob: a.glob,
      resolveCommand: (files: string[]) => {
        let cmd = a.command ?? a.name;
        cmd = cmd.replace("{file}", files[0] ?? "");
        cmd = cmd.replace("{files}", files.join(" "));
        return cmd;
      },
    }));
}

export function matchesGlob(filePath: string, glob: string | undefined): boolean {
  if (!glob) return true;
  // Simple glob matching using minimatch-style logic
  const pattern = glob
    .replace(/\*\*/g, "DOUBLESTAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DOUBLESTAR/g, ".*")
    .replace(/\./g, "\\.");
  return new RegExp(`^${pattern}$`).test(filePath);
}

export type PipelineResult = {
  action: string;
  success: boolean;
  output: string;
  durationMs: number;
};

export type OnPipelineEvent = (event: "start" | "action-complete" | "done", data?: PipelineResult) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingFiles: Set<string> = new Set();
  private pipelineRunning = false;
  private abortController: AbortController | null = null;
  private pipeline: PipelineAction[];
  private debounceMs: number;
  private projectRoot: string;
  private onEvent: OnPipelineEvent;

  constructor(
    projectRoot: string,
    actions: OnSaveAction[],
    debounceMs = 300,
    onEvent: OnPipelineEvent = () => {},
  ) {
    this.projectRoot = projectRoot;
    this.pipeline = buildPipeline(actions);
    this.debounceMs = debounceMs;
    this.onEvent = onEvent;
  }

  start(ignorePatterns: string[] = ["node_modules", ".git", "ios/build", "android/build"]): void {
    this.watcher = watch(this.projectRoot, {
      ignored: ignorePatterns.map((p) => path.join(this.projectRoot, p)),
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", (filePath) => {
      const relative = path.relative(this.projectRoot, filePath);
      this.pendingFiles.add(relative);
      this.scheduleRun();
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.abortController?.abort();
  }

  private scheduleRun(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.runPipeline(), this.debounceMs);
  }

  private async runPipeline(): Promise<void> {
    // Cancel any running pipeline
    if (this.pipelineRunning) {
      this.abortController?.abort();
    }

    this.abortController = new AbortController();
    this.pipelineRunning = true;
    const files = Array.from(this.pendingFiles);
    this.pendingFiles.clear();
    this.onEvent("start");

    for (const action of this.pipeline) {
      if (this.abortController.signal.aborted) break;

      // Check if any file matches this action's glob
      const matchingFiles = files.filter((f) => matchesGlob(f, action.glob));
      if (matchingFiles.length === 0) continue;

      const cmd = action.resolveCommand(matchingFiles);
      const startTime = Date.now();

      try {
        const output = execSync(cmd, {
          cwd: this.projectRoot,
          encoding: "utf-8",
          stdio: "pipe",
        });
        this.onEvent("action-complete", {
          action: action.name, success: true, output,
          durationMs: Date.now() - startTime,
        });
      } catch (err: any) {
        const result: PipelineResult = {
          action: action.name, success: false,
          output: err.stdout ?? err.message ?? "",
          durationMs: Date.now() - startTime,
        };
        this.onEvent("action-complete", result);
        if (action.haltOnFailure) break;
      }
    }

    this.pipelineRunning = false;
    this.onEvent("done");
  }
}
```

- [ ] **Step 4: Run watcher tests**

Run: `npx vitest run src/core/__tests__/watcher.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/watcher.ts src/core/__tests__/watcher.test.ts
git commit -m "feat: add file watcher with debounced on-save pipeline"
```

---

## Task 10: Preflight Engine

**Files:**
- Create: `src/core/preflight.ts`
- Test: `src/core/__tests__/preflight.test.ts`

- [ ] **Step 1: Write failing tests for preflight checks**

```typescript
// src/core/__tests__/preflight.test.ts
import { describe, it, expect } from "vitest";
import { filterChecksByPlatform, PREFLIGHT_CHECKS } from "../preflight.js";

describe("PREFLIGHT_CHECKS", () => {
  it("has all required check IDs", () => {
    const ids = PREFLIGHT_CHECKS.map((c) => c.id);
    expect(ids).toContain("node-version");
    expect(ids).toContain("metro-port");
    expect(ids).toContain("node-modules-checksum");
  });

  it("has at least 15 checks defined", () => {
    expect(PREFLIGHT_CHECKS.length).toBeGreaterThanOrEqual(15);
  });
});

describe("filterChecksByPlatform", () => {
  it("filters iOS checks for android platform", () => {
    const filtered = filterChecksByPlatform("android");
    expect(filtered.every((c) => c.platform !== "ios")).toBe(true);
  });

  it("includes all checks for 'both' platform", () => {
    const filtered = filterChecksByPlatform("both");
    expect(filtered.length).toBe(PREFLIGHT_CHECKS.length);
  });

  it("filters by enabled check IDs", () => {
    const filtered = filterChecksByPlatform("ios", ["node-version", "metro-port"]);
    expect(filtered).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/preflight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement preflight engine**

Create `src/core/preflight.ts` implementing all 21 preflight checks from the spec. Each check is a `PreflightCheck` object with `id`, `name`, `severity`, `platform`, `check()` function, and optional `fix()` function. The check functions use `execSync` to probe the environment (e.g., `node --version`, `xcode-select -p`, `pod --version`).

The `filterChecksByPlatform()` function filters checks by platform and optionally by enabled check IDs from the profile.

The `runPreflights()` function runs all enabled checks and returns results.

This is a large file (~300 lines) with repetitive structure. Each check follows the pattern:

```typescript
{
  id: "node-version",
  name: "Node version matches project config",
  severity: "error",
  platform: "all",
  check: async () => {
    // read .nvmrc or .node-version or engines from package.json
    // compare with process.version
    // return { passed, message }
  },
  fix: async () => {
    // attempt nvm use or inform user
    return success;
  },
}
```

- [ ] **Step 4: Run preflight tests**

Run: `npx vitest run src/core/__tests__/preflight.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/preflight.ts src/core/__tests__/preflight.test.ts
git commit -m "feat: add preflight engine with 21 environment checks"
```

---

## Task 11: TUI Components (Panel, LogViewer, SearchInput, MultiSelect)

**Files:**
- Create: `src/ui/layout/panel.tsx`, `src/ui/components/log-viewer.tsx`, `src/ui/components/search-input.tsx`, `src/ui/components/multi-select.tsx`, `src/ui/components/selectable-list.tsx`

- [ ] **Step 1: Implement Panel component**

Reusable bordered panel with title, scrollable content, focus indicator using Ink's `Box` and `Text`. Uses theme colors for borders and title.

- [ ] **Step 2: Implement LogViewer component**

Scrollable log display using `ink-scroll-view`. Renders ANSI-colored log lines, supports keyboard scrolling (up/down/page-up/page-down), and search filtering.

- [ ] **Step 3: Implement SearchInput component**

Text input with fuzzy matching via `fuse.js`. Shows filtered results in a selectable list below the input. Supports Enter to select, Esc to cancel.

- [ ] **Step 4: Implement MultiSelect component**

Checkbox list using `ink-multi-select` or custom implementation. Supports select-all (`a`), deselect-all (`n`), and space to toggle individual items. Used by preflight config and on-save config wizard steps.

- [ ] **Step 5: Implement SelectableList component**

Wrapper around `ink-select-input` with search integration. Used for worktree selection, device selection, profile selection.

- [ ] **Step 6: Verify all components render without errors**

Run: `npx tsx src/index.tsx` with a test harness that renders each component.

- [ ] **Step 7: Commit**

```bash
git add src/ui/layout/panel.tsx src/ui/components/
git commit -m "feat: add TUI base components (panel, log-viewer, search, multi-select)"
```

---

## Task 12: Wizard Steps

**Files:**
- Create: `src/ui/wizard/wizard.tsx`, `src/ui/wizard/worktree-step.tsx`, `src/ui/wizard/branch-step.tsx`, `src/ui/wizard/platform-step.tsx`, `src/ui/wizard/mode-step.tsx`, `src/ui/wizard/device-step.tsx`, `src/ui/wizard/preflight-step.tsx`, `src/ui/wizard/onsave-step.tsx`

- [ ] **Step 1: Implement Wizard orchestrator**

State machine that progresses through steps: worktree → branch → platform → mode → device → preflight → onsave. Each step renders a component and collects a value. On completion, produces a `Profile` object.

- [ ] **Step 2: Implement WorktreeStep**

Uses `selectable-list` to show available git worktrees from `getWorktrees()`. Shows "Default (root)" option. For non-git repos, auto-skips.

- [ ] **Step 3: Implement BranchStep**

Shows current branch of selected worktree for confirmation. Display-only with "Confirm" / "Change worktree" options.

- [ ] **Step 4: Implement PlatformStep**

Three radio options: iOS, Android, Both.

- [ ] **Step 5: Implement ModeStep**

Three radio options: Dirty, Clean, Ultra-Clean. Shows brief description of each.

- [ ] **Step 6: Implement DeviceStep**

Uses `selectable-list` filtered by platform. Shows device name, type, status. For platform "both", shows two pickers (one iOS, one Android). Filters out devices in use by other worktree Metro instances.

- [ ] **Step 7: Implement PreflightStep**

Uses `multi-select` to show available checks filtered by platform. Then radio for frequency ("once" / "always").

- [ ] **Step 8: Implement OnSaveStep**

Calls `detectTooling()` to discover available tools. Uses `multi-select` to let user enable/disable. Offers "+ Add custom command" text input. Offers "Skip on-save entirely".

- [ ] **Step 9: Test wizard end-to-end in dev mode**

Run: `npx tsx src/index.tsx start -i` (render wizard in terminal, verify each step renders and collects input).

- [ ] **Step 10: Commit**

```bash
git add src/ui/wizard/
git commit -m "feat: add interactive wizard with 7 configuration steps"
```

---

## Task 13: TUI Layout (Shell, DevSpace, Panels)

**Files:**
- Create: `src/ui/layout/shell.tsx`, `src/ui/layout/dev-space.tsx`, `src/ui/panels/profile-banner.tsx`, `src/ui/panels/shortcuts.tsx`, `src/ui/panels/interactive.tsx`, `src/ui/panels/tool-output.tsx`, `src/ui/panels/metro-log.tsx`

- [ ] **Step 1: Implement Shell (sidebar + main area)**

Full-screen layout using `fullscreen-ink`. Left sidebar shows module icons with focus highlight. Main area renders the active module's component. Tab navigation between sidebar and main.

- [ ] **Step 2: Implement ProfileBanner**

Collapsible panel at top showing all profile fields. Toggle collapse with arrow key or shortcut.

- [ ] **Step 3: Implement ShortcutsPanel**

Renders keyboard shortcuts list. Registers global `useInput` handlers for each shortcut key.

- [ ] **Step 4: Implement InteractivePanel**

Multipurpose panel: shows preflight results (check/warning/error icons), build progress bars (`@inkjs/ui ProgressBar`), and build error summaries from `build-parser.ts`.

- [ ] **Step 5: Implement ToolOutputPanel**

Scrollable panel using `log-viewer` component. Receives lint/test output and displays with syntax highlighting.

- [ ] **Step 6: Implement MetroLogPanel**

Scrollable panel using `log-viewer`. Subscribes to Metro stdout/stderr stream. Supports search within logs.

- [ ] **Step 7: Implement DevSpace (4-panel stacked layout)**

Composes profile-banner + shortcuts/interactive (side-by-side) + tool-output + metro-log using Ink Flexbox.

- [ ] **Step 8: Test the full TUI layout renders**

Run: `npx tsx src/index.tsx` — verify the full shell with sidebar and dev-space renders. Test keyboard navigation between panels.

- [ ] **Step 9: Commit**

```bash
git add src/ui/layout/ src/ui/panels/
git commit -m "feat: add TUI shell layout with sidebar and 5-panel dev space"
```

---

## Task 14: Module Registry + Built-in Modules

**Files:**
- Create: `src/modules/registry.ts`, `src/modules/base-module.ts`, `src/modules/built-in/dev-space.ts`, `src/modules/built-in/lint-test.ts`, `src/modules/built-in/metro-full.ts`, `src/modules/built-in/settings.ts`

- [ ] **Step 1: Implement RnDevModule interface and registry**

Registry class that holds registered modules, sorted by `order`. Detects shortcut conflicts and warns.

- [ ] **Step 2: Implement Dev Space module (order=0)**

Wraps the DevSpace layout component.

- [ ] **Step 3: Implement Lint/Test module (order=10)**

Full-screen tool output with scrollback and search.

- [ ] **Step 4: Implement Metro Logs module (order=20)**

Full-screen metro output with scrollback and search.

- [ ] **Step 5: Implement Settings module (order=90)**

Profile manager (list, set default, delete), theme picker, on-save configuration editor.

- [ ] **Step 6: Register all 4 modules in registry**

- [ ] **Step 7: Commit**

```bash
git add src/modules/
git commit -m "feat: add module registry and 4 built-in sidebar modules"
```

---

## Task 15: CLI Commands (commander)

**Files:**
- Create: `src/cli/commands.ts`
- Modify: `src/index.tsx`

- [ ] **Step 1: Set up commander program**

Define top-level program with `start`, `reload`, `dev-menu`, `clean`, `devices`, `worktrees`, `profiles`, `lint`, `typecheck`, `preflight`, `config`, `mcp`, `logs`, `artifacts` commands.

- [ ] **Step 2: Implement `start` command**

Handles `--interactive`, `--profile <name>`, `--root <path>`. Follows the start flow from the spec: check for default profile → load or run wizard.

- [ ] **Step 3: Implement utility commands**

`reload`, `dev-menu`, `clean --mode`, `devices`, `worktrees`, `profiles`, `profiles default`, `profiles list --all`, `lint`, `typecheck`, `preflight`, `preflight --fix`, `config theme`, `logs`, `artifacts cleanup`.

Each command calls the corresponding `core/` function and formats output for the terminal.

- [ ] **Step 4: Wire commander into index.tsx**

Index.tsx detects whether to launch TUI (for `start`) or run a one-shot CLI command.

- [ ] **Step 5: Test CLI commands**

Run: `npx tsx src/index.tsx profiles` — verify it outputs profile list.
Run: `npx tsx src/index.tsx preflight` — verify it runs checks.
Run: `npx tsx src/index.tsx --help` — verify help text.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands.ts src/index.tsx
git commit -m "feat: add CLI commands via commander"
```

---

## Task 16: IPC (Unix Socket)

**Files:**
- Create: `src/core/ipc.ts`
- Test: `src/core/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing tests for IPC**

```typescript
// src/core/__tests__/ipc.test.ts
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { IpcServer, IpcClient } from "../ipc.js";

describe("IPC", () => {
  const sockPath = path.join(os.tmpdir(), `rn-dev-test-${Date.now()}.sock`);
  let server: IpcServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it("client sends request and receives response", async () => {
    server = new IpcServer(sockPath);
    server.handle("echo", async (params) => params);
    await server.start();

    const client = new IpcClient(sockPath);
    const result = await client.call("echo", { message: "hello" });
    expect(result).toEqual({ message: "hello" });
    client.close();
  });

  it("returns error for unknown method", async () => {
    server = new IpcServer(sockPath);
    await server.start();

    const client = new IpcClient(sockPath);
    await expect(client.call("nonexistent", {})).rejects.toThrow();
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/ipc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement IPC server and client**

JSON-RPC 2.0 over Unix domain socket. Server registers method handlers. Client sends requests and awaits responses. Stale socket detection (attempt connect, ECONNREFUSED → delete and report).

- [ ] **Step 4: Run IPC tests**

Run: `npx vitest run src/core/__tests__/ipc.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ipc.ts src/core/__tests__/ipc.test.ts
git commit -m "feat: add JSON-RPC 2.0 IPC over Unix socket"
```

---

## Task 17: MCP Server

**Files:**
- Create: `src/mcp/server.ts`, `src/mcp/tools.ts`

- [ ] **Step 1: Implement MCP tool definitions**

Define all MCP tools from the spec: `rn-dev/start-session`, `rn-dev/reload`, `rn-dev/dev-menu`, `rn-dev/metro-status`, `rn-dev/clean`, `rn-dev/list-devices`, `rn-dev/preflight`, `rn-dev/list-worktrees`, `rn-dev/list-profiles`, `rn-dev/run-lint`, `rn-dev/run-typecheck`, etc.

Each tool maps to the corresponding `core/` function.

- [ ] **Step 2: Implement MCP server**

Uses `@modelcontextprotocol/sdk` with stdio transport. Supports two modes:
- Standalone (no TUI running): calls core functions directly
- Proxy (TUI running): forwards requests to TUI via Unix socket IPC

Detects mode by checking for `.rn-dev/sock` existence.

- [ ] **Step 3: Wire `rn-dev mcp` command to start the server**

- [ ] **Step 4: Test MCP server with stdio**

Run: `echo '{"method": "rn-dev/list-profiles", "params": {}}' | npx tsx src/index.tsx mcp`
Expected: JSON response with profile list.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/
git commit -m "feat: add MCP server with stdio transport and proxy mode"
```

---

## Task 18: App Wiring + First-Run Setup

**Files:**
- Modify: `src/app.tsx`, `src/index.tsx`
- Create: `src/core/first-run.ts`

- [ ] **Step 1: Implement first-run setup**

On first launch in a project: check `.gitignore` for `.rn-dev/`, offer to add it. Check for `.nvmrc`/`.node-version`, offer to create. Check for `.env.example`, offer to copy to `.env`.

- [ ] **Step 2: Wire App component**

Root `<App>` component:
- Wraps everything in `<ThemeProvider>`
- Loads profile (or launches wizard if none)
- Runs preflights based on profile config
- Starts Metro
- Starts file watcher if on-save configured
- Renders `<Shell>` with module registry
- Starts IPC server for CLI/MCP communication

- [ ] **Step 3: Wire index.tsx routing**

Parse args with commander. Route:
- `start` / `start -i` / `start --profile` → render `<App>` with Ink
- `mcp` → start MCP server (headless)
- Other commands → run one-shot CLI action, exit

- [ ] **Step 4: End-to-end test**

Run `npx tsx src/index.tsx start -i` in a React Native project directory. Verify:
1. First-run setup prompts appear (if first time)
2. Wizard renders all 7 steps
3. Profile is saved
4. TUI renders with all panels
5. Metro starts
6. Keyboard shortcuts work

- [ ] **Step 5: Commit**

```bash
git add src/app.tsx src/index.tsx src/core/first-run.ts
git commit -m "feat: wire app with profile loading, preflights, metro, and TUI"
```

---

## Task 19: esbuild Bundle + Global Install

**Files:**
- Modify: `esbuild.config.ts`, `package.json`

- [ ] **Step 1: Configure esbuild for production bundle**

Ensure all dependencies are bundled (no externals). Output a single `dist/index.js` with shebang. Test that the bundle runs standalone without `node_modules`.

- [ ] **Step 2: Add npm publish config**

Update `package.json` with `files: ["dist"]`, `bin` pointing to `dist/index.js`, and metadata (repository, license, keywords).

- [ ] **Step 3: Test global install locally**

```bash
npm run build
npm link
rn-dev --help
rn-dev --version
```

- [ ] **Step 4: Test self-preservation**

Verify that `isRunningViaNodeModules()` returns correct values for global vs npx installs.

- [ ] **Step 5: Commit**

```bash
git add esbuild.config.ts package.json
git commit -m "feat: configure esbuild for single-file distribution bundle"
```

---

## Task 20: Final Integration Test + Polish

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Build production bundle**

Run: `npm run build`
Expected: Single file `dist/index.js` created.

- [ ] **Step 4: Test global install end-to-end**

```bash
npm link
cd /path/to/a/real/rn-project
rn-dev start -i
# verify wizard, preflights, metro, TUI all work
rn-dev profiles
rn-dev preflight
rn-dev --help
```

- [ ] **Step 5: Test MCP server**

```bash
rn-dev mcp
# send JSON-RPC requests via stdin, verify responses
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Sub-project 1 — TUI shell, profiles, metro manager"
```
