import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { RnDevModule } from "../core/types.js";

export class ModuleRegistry {
  private modules: Map<string, RnDevModule> = new Map();

  register(module: RnDevModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Module "${module.id}" is already registered.`);
    }
    this.modules.set(module.id, module);
  }

  unregister(id: string): boolean {
    return this.modules.delete(id);
  }

  get(id: string): RnDevModule | undefined {
    return this.modules.get(id);
  }

  getAll(): RnDevModule[] {
    return [...this.modules.values()].sort((a, b) => a.order - b.order);
  }

  getShortcuts(): Array<{
    key: string;
    label: string;
    moduleId: string;
    action: () => Promise<void>;
  }> {
    const result: Array<{
      key: string;
      label: string;
      moduleId: string;
      action: () => Promise<void>;
    }> = [];

    for (const module of this.modules.values()) {
      if (!module.shortcuts) continue;
      for (const shortcut of module.shortcuts) {
        result.push({
          key: shortcut.key,
          label: shortcut.label,
          moduleId: module.id,
          action: shortcut.action,
        });
      }
    }

    return result;
  }

  async loadPlugins(projectRoot: string): Promise<void> {
    const pkgPath = join(projectRoot, "package.json");

    if (!existsSync(pkgPath)) {
      return;
    }

    let pkg: Record<string, unknown>;
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Malformed package.json — skip silently
      return;
    }

    const rnDev = pkg["rn-dev"] as Record<string, unknown> | undefined;
    if (!rnDev || !Array.isArray(rnDev.plugins)) {
      return;
    }

    for (const entry of rnDev.plugins as unknown[]) {
      if (typeof entry !== "string" || entry.trim() === "") {
        console.warn(`[ModuleRegistry] Skipping invalid plugin entry: ${String(entry)}`);
        continue;
      }

      try {
        const modulePath = entry.startsWith("./")
          ? join(projectRoot, entry)
          : entry;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imported = (await import(modulePath)) as Record<string, any>;

        // Support default export or named "default" export
        const candidate =
          imported.default ?? Object.values(imported).find(Boolean);

        if (!isRnDevModule(candidate)) {
          console.warn(
            `[ModuleRegistry] Plugin "${entry}" does not export a valid RnDevModule — skipping.`
          );
          continue;
        }

        this.register(candidate as RnDevModule);
      } catch (err) {
        console.warn(
          `[ModuleRegistry] Failed to load plugin "${entry}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
}

function isRnDevModule(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["icon"] === "string" &&
    typeof v["order"] === "number" &&
    typeof v["component"] === "function"
  );
}
