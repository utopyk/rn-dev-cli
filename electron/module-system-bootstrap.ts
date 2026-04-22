// Electron-mode module-system bootstrap.
//
// The TUI path (`src/app/start-flow.ts`) creates the daemon's ModuleHost +
// ModuleRegistry + moduleEvents bus inside `startServicesAsync`, because
// that process runs the unix-socket IpcServer and needs the full
// `modules/*` IPC dispatcher for MCP clients. Electron's `startRealServices`
// has no unix socket and no MCP server to feed — it only needs the
// ipcMain handlers in `electron/ipc/modules-panels-register.ts` +
// `modules-config-register.ts` to resolve against live services.
//
// This file stands up the minimum: a capability registry, a module host,
// a registry populated with built-in manifests + user-global 3p modules,
// a shared event bus for `modules:event` + `modules:config-set` fan-out.
// Published through the serviceBus singleton; the existing eager-
// registered ipcMain handlers pick up `deps` via their `tryInstall`
// closures without further wiring.
//
// Phase 5c NEW work — before this existed, `modules:list-panels` returned
// `{modules: []}` and `modules:config-*` returned `E_CONFIG_SERVICES_PENDING`
// in Electron mode, which broke the Marketplace panel + Settings
// migration this phase is shipping.

import { EventEmitter } from "node:events";
import path from "node:path";
import { readFileSync } from "node:fs";
import { CapabilityRegistry } from "../src/core/module-host/capabilities.js";
import { ModuleHostManager } from "../src/core/module-host/manager.js";
import { ModuleRegistry } from "../src/modules/registry.js";
import {
  devSpaceManifest,
  metroLogsManifest,
  lintTestManifest,
  settingsManifest,
} from "../src/modules/built-in/manifests.js";
import { registerMarketplaceBuiltIn } from "../src/modules/built-in/marketplace.js";
import { serviceBus } from "../src/app/service-bus.js";

export interface BootstrapResult {
  capabilities: CapabilityRegistry;
  moduleHost: ModuleHostManager;
  moduleRegistry: ModuleRegistry;
  moduleEvents: EventEmitter;
}

/**
 * Call once from `startRealServices` right after `state.artifactStore` +
 * `state.projectRoot` are populated. Idempotent by virtue of the
 * serviceBus publish — re-running would double-register capabilities so
 * we guard with a module-scoped flag.
 */
let booted: BootstrapResult | null = null;

export function bootstrapElectronModuleSystem(args: {
  worktreeKey: string | null;
}): BootstrapResult {
  if (booted) return booted;

  const hostVersion = readHostVersion();
  const capabilities = new CapabilityRegistry();
  capabilities.register(
    "appInfo",
    {
      hostVersion,
      platform: process.platform,
      worktreeKey: args.worktreeKey,
    },
    { allowReserved: true },
  );
  capabilities.register(
    "log",
    {
      debug: (msg: string) => console.log(`[mod debug] ${msg}`),
      info: (msg: string) => console.log(`[mod info] ${msg}`),
      warn: (msg: string) => console.warn(`[mod warn] ${msg}`),
      error: (msg: string) => console.error(`[mod error] ${msg}`),
    },
    { allowReserved: true },
  );

  const moduleHost = new ModuleHostManager({ hostVersion, capabilities });

  const moduleRegistry = new ModuleRegistry();
  moduleRegistry.registerBuiltIn(devSpaceManifest);
  moduleRegistry.registerBuiltIn(metroLogsManifest);
  moduleRegistry.registerBuiltIn(lintTestManifest);
  moduleRegistry.registerBuiltIn(settingsManifest);
  registerMarketplaceBuiltIn({ moduleRegistry, capabilities });

  // Load user-global 3p manifests — best-effort; a broken 3p module
  // shouldn't break the Electron boot.
  const loaded = moduleRegistry.loadUserGlobalModules({
    hostVersion,
    scopeUnit: args.worktreeKey ?? "global",
  });
  if (loaded.rejected.length > 0) {
    for (const r of loaded.rejected) {
      console.warn(
        `[module-system] rejected manifest (${r.code}): ${r.manifestPath} — ${r.message}`,
      );
    }
  }

  const moduleEvents = new EventEmitter();

  serviceBus.setModuleHost(moduleHost);
  serviceBus.setModuleRegistry(moduleRegistry);
  serviceBus.setModuleEventsBus(moduleEvents);

  booted = { capabilities, moduleHost, moduleRegistry, moduleEvents };
  return booted;
}

function readHostVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
