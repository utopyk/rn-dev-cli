import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Runs first-time setup when no `.rn-dev` directory exists in the project root.
 *
 * Creates the directory structure used by rn-dev and prints helpful hints for
 * the developer.
 */
export async function firstRunSetup(projectRoot: string): Promise<void> {
  const rnDevDir = join(projectRoot, ".rn-dev");

  // Not first run — directory already exists
  if (existsSync(rnDevDir)) return;

  // Create directory structure
  mkdirSync(join(rnDevDir, "profiles"), { recursive: true });
  mkdirSync(join(rnDevDir, "artifacts"), { recursive: true });
  mkdirSync(join(rnDevDir, "logs"), { recursive: true });

  // Check .gitignore for .rn-dev/ entry
  const gitignorePath = join(projectRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".rn-dev/") && !content.includes(".rn-dev\n")) {
        console.log("  Consider adding .rn-dev/ to your .gitignore");
      }
    } catch {
      // Cannot read .gitignore — not critical
    }
  }

  // Check for .nvmrc / .node-version
  const hasNodeConfig = [".nvmrc", ".node-version"].some((f) =>
    existsSync(join(projectRoot, f))
  );
  if (!hasNodeConfig) {
    console.log("  Consider creating a .nvmrc or .node-version file");
  }
}
