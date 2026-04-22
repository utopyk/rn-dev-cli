// Phase 5b — Marketplace built-in module.
//
// Unlike DevSpace / MetroLogs / LintTest / Settings, Marketplace has no
// existing TUI component. It's introduced now so the manifest shape +
// the `modules` capability registration are in place before Phase 6's
// real install flow lands. The renderer-native React panel + full
// `modules-install` / `modules-uninstall` implementation follow later.
//
// Contract decisions locked in here:
// - Built-in privileged, no subprocess. Registered through
//   `ModuleRegistry.registerBuiltIn`.
// - Exposes a `modules` capability id on the host `CapabilityRegistry`.
//   3p modules can query it via `ctx.host.capability<Modules>("modules")`.
// - `install` / `uninstall` are **stubs** in Phase 5b. They throw
//   `NOT_IMPLEMENTED` so callers see a clear signal, not a silent no-op.
// - `list` is real — it reads from the same `ModuleRegistry` the rest of
//   the host uses, so the Marketplace can't drift from the canonical
//   module list.

import type { ModuleManifest } from "@rn-dev/module-sdk";
import type { CapabilityRegistry } from "../../core/module-host/capabilities.js";
import type { ModuleRegistry, RegisteredModule } from "../registry.js";

// ---------------------------------------------------------------------------
// Capability surface
// ---------------------------------------------------------------------------

export interface MarketplaceModuleEntry {
  id: string;
  version: string;
  scope: RegisteredModule["manifest"]["scope"];
  isBuiltIn: boolean;
  kind: "subprocess" | "built-in-privileged";
  state: RegisteredModule["state"];
}

export interface MarketplaceCapability {
  /** Snapshot of every registered module — same source of truth as `modules/list`. */
  list(): MarketplaceModuleEntry[];
  /**
   * Phase 6 — install a module from the curated registry.
   * Throws `NOT_IMPLEMENTED` in Phase 5b.
   */
  install(args: { id: string }): Promise<{ installed: true; id: string }>;
  /**
   * Phase 6 — uninstall a user-installed module. Built-ins are rejected
   * with `UNINSTALLABLE`. Throws `NOT_IMPLEMENTED` in Phase 5b.
   */
  uninstall(args: { id: string }): Promise<{ uninstalled: true; id: string }>;
}

export const MARKETPLACE_CAPABILITY_ID = "modules" as const;

export function createMarketplaceCapability(
  registry: ModuleRegistry,
): MarketplaceCapability {
  return {
    list(): MarketplaceModuleEntry[] {
      return registry.getAllManifests().map((m) => ({
        id: m.manifest.id,
        version: m.manifest.version,
        scope: m.manifest.scope,
        isBuiltIn: m.isBuiltIn,
        kind: m.kind ?? "subprocess",
        state: m.state,
      }));
    },
    install(): Promise<{ installed: true; id: string }> {
      return Promise.reject(
        new Error(
          "NOT_IMPLEMENTED: marketplace install is deferred to Phase 6",
        ),
      );
    },
    uninstall(): Promise<{ uninstalled: true; id: string }> {
      return Promise.reject(
        new Error(
          "NOT_IMPLEMENTED: marketplace uninstall is deferred to Phase 6",
        ),
      );
    },
  };
}

/**
 * Register the Marketplace built-in into both the module registry and
 * the host capability registry. Call once during host startup before any
 * 3p module spawns — modules that declare a `modules` host-capability
 * dependency will resolve against this registration.
 */
export function registerMarketplaceBuiltIn(args: {
  moduleRegistry: ModuleRegistry;
  capabilities: CapabilityRegistry;
}): { manifest: RegisteredModule; capability: MarketplaceCapability } {
  const manifest = args.moduleRegistry.registerBuiltIn(marketplaceManifest);
  const capability = createMarketplaceCapability(args.moduleRegistry);
  args.capabilities.register<MarketplaceCapability>(
    MARKETPLACE_CAPABILITY_ID,
    capability,
  );
  return { manifest, capability };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const marketplaceManifest: ModuleManifest = {
  id: "marketplace",
  version: "0.1.0",
  hostRange: ">=0.1.0",
  scope: "global",
  contributes: {
    // No TUI / Electron panel contributions in Phase 5b — the
    // renderer-native React panel lands in Phase 5c / alongside Phase 6's
    // real install flow.
  },
  activationEvents: ["onStartup"],
};
