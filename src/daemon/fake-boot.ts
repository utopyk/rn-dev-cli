// Test-only session boot. Gated by `RN_DEV_DAEMON_BOOT_MODE=fake` in the
// daemon entrypoint — never selected in production paths.
//
// Returns a SessionServices-shaped stub that emits the metro lifecycle
// events (starting → running on start, stopped on dispose) the session
// integration test asserts on, without spawning the real Metro packager.
// Everything else is a minimal stub: the test asserts on the state
// machine and event fan-out, not the inner services.

import { EventEmitter } from "node:events";
import { MetroLogsStore } from "../core/metro-logs/buffer.js";
import { CapabilityRegistry } from "../core/module-host/capabilities.js";
import { ModuleRegistry } from "../modules/registry.js";
import type {
  BootSessionServicesOptions,
  SessionServices,
} from "../core/session/boot.js";
import type { MetroManager } from "../core/metro.js";
import type { DevToolsManager } from "../core/devtools.js";
import type { Builder } from "../core/builder.js";
import type { FileWatcher } from "../core/watcher.js";
import type { ModuleHostManager } from "../core/module-host/manager.js";

export async function fakeBootSessionServices(
  opts: BootSessionServicesOptions,
): Promise<SessionServices> {
  const worktreeKey = opts.artifactStore.worktreeHash(opts.profile.worktree);
  const metro = new EventEmitter() as unknown as MetroManager;
  const devtools = new EventEmitter() as unknown as DevToolsManager;
  const moduleHost = new EventEmitter() as unknown as ModuleHostManager;
  const moduleEvents = new EventEmitter();
  const metroLogsStore = new MetroLogsStore();
  const capabilities = new CapabilityRegistry();
  const moduleRegistry = opts.moduleRegistry;

  // Emit "starting" on the next macrotask — supervisor wires event
  // listeners AFTER bootFn resolves, so a microtask-scheduled emit
  // fires too early. setTimeout(0) pushes past the await continuation
  // and lets the listener attach first. "running" follows shortly after
  // so the integration test's `waitForEvent` completes.
  setTimeout(() => {
    metro.emit("status", { worktreeKey, status: "starting" });
  }, 5);
  setTimeout(() => {
    metro.emit("status", { worktreeKey, status: "running" });
  }, 25);

  const dispose = async (): Promise<void> => {
    metro.emit("status", { worktreeKey, status: "stopped" });
  };

  return {
    metro,
    devtools,
    watcher: null as FileWatcher | null,
    builder: {} as Builder,
    moduleHost,
    moduleRegistry,
    worktreeKey,
    metroLogsStore,
    capabilities,
    moduleEvents,
    dispose,
  };
}
