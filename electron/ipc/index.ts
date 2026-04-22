import { BrowserWindow } from 'electron';
import path from 'node:path';
import { serviceBus } from '../../src/app/service-bus.js';
import type { ModuleHostManager } from '../../src/core/module-host/manager.js';
import type { ModuleRegistry } from '../../src/modules/registry.js';
import { state, send } from './state.js';
import { registerInstanceHandlers } from './instance.js';
import { registerMetroHandlers } from './metro.js';
import { registerToolsHandlers } from './tools.js';
import { registerProfileHandlers } from './profile.js';
import { registerWizardHandlers } from './wizard.js';
import { registerDevtoolsHandlers } from './devtools.js';
import { installPanelBridge } from '../panel-bridge-electron.js';
import { createBoundsCache } from './modules-panels.js';
import { registerModulesPanelsIpc } from './modules-panels-register.js';

export { startRealServices } from './services.js';

/**
 * Register every ipcMain handler group for the rn-dev Electron host.
 * Split from the former monolithic electron/ipc-bridge.ts in Phase 0.5 of the
 * module-system work — each file under electron/ipc/ owns a single concern.
 */
export function setupIpcBridge(window: BrowserWindow, initialProjectRoot?: string) {
  state.mainWindow = window;
  if (initialProjectRoot) {
    state.projectRoot = initialProjectRoot;
  }

  // Forward service bus events to renderer (legacy, for global logs)
  serviceBus.on('log', (text: string) => send('service:log', text));

  registerInstanceHandlers();
  registerMetroHandlers();
  registerToolsHandlers();
  registerProfileHandlers();
  registerWizardHandlers();
  registerDevtoolsHandlers();
  registerModulePanelsHandlers(window);
}

/**
 * Phase 4 — install the module-panels bridge + its ipcMain channels once
 * both the module host and the module registry have been published via
 * the service bus. Keeps the panel wiring out of the critical startup
 * path while still binding as early as possible.
 */
function registerModulePanelsHandlers(window: BrowserWindow): void {
  let latestManager: ModuleHostManager | null = null;
  let latestRegistry: ModuleRegistry | null = null;

  const tryInstall = () => {
    if (!latestManager || !latestRegistry) return;
    const manager = latestManager;
    const registry = latestRegistry;

    const boundsCache = createBoundsCache();
    let handleGetActiveBounds: (() => ReturnType<typeof boundsCache.get>) | null =
      null;

    const preloadPath = path.join(__dirname, '..', 'preload-module.js');
    const bridge = installPanelBridge({
      window,
      preloadPath,
      moduleRoot: (id: string) => {
        const reg = registry
          .getAllManifests()
          .find((m) => m.manifest.id === id);
        return reg?.modulePath ?? '';
      },
      getBounds: () =>
        handleGetActiveBounds?.() ?? { x: 0, y: 0, width: 0, height: 0 },
      auditLog: (event) => {
        // Phase 4: audit-log each panel event via the service-bus log
        // channel. A dedicated HMAC-chained sink lands in a follow-up when
        // the AuditLog API is finalized.
        send('service:log', `[panel-bridge] ${event.kind} ${event.moduleId}:${event.panelId}`);
      },
    });

    const handle = registerModulesPanelsIpc({
      bridge,
      manager,
      registry,
      bounds: boundsCache,
    });
    handleGetActiveBounds = handle.getActiveBounds;
  };

  serviceBus.on('moduleHost', (m) => {
    latestManager = m;
    tryInstall();
  });
  serviceBus.on('moduleRegistry', (r) => {
    latestRegistry = r;
    tryInstall();
  });
}
