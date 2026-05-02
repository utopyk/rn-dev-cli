/**
 * Vitest global setup — runs once before the test suite starts.
 *
 * Builds workspace packages whose `package.json#main` points at a `dist/`
 * artifact, so vite's import-analysis can resolve them by package name when
 * the CLI / daemon code dynamically imports them. Each build is idempotent
 * and finishes in <200ms, so we always run them instead of checking mtimes.
 *
 * Phase 3d added `@rn-dev/module-sdk`. Phase H0 added `@rn-dev/config`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export default async function globalSetup(): Promise<void> {
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const buildScripts = [
    join(repoRoot, "packages/module-sdk/build.ts"),
    join(repoRoot, "packages/config/build.ts"),
  ];
  for (const script of buildScripts) {
    const result = spawnSync("bun", ["run", script], {
      stdio: "inherit",
      cwd: repoRoot,
    });
    if (result.status !== 0) {
      throw new Error(
        `[vitest.global-setup] build of ${script} exited with code ${result.status}`,
      );
    }
  }
}
