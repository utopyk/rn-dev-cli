import { BrowserWindow } from 'electron';
import type { EventEmitter } from 'node:events';
import path from 'node:path';
import { serviceBus } from '../../src/app/service-bus.js';
import { getDefaultAuditLog, type AuditEntry } from '../../src/core/audit-log.js';
import { state, send } from './state.js';

// Phase 8 — AuditLog is a process-wide singleton so the four audit sinks
// below (panel-bridge, host-call, config-set, install/uninstall) can
// reach it without every registrar threading it in. The three
// `registerModule*Handlers` functions are invoked from inside
// `setupIpcBridge` but live at module scope, so they can't close over a
// local variable there — the previous attempt put `auditLog` inside
// `setupIpcBridge` and tripped the P0 caught in the Phase 8 review
// (`ReferenceError: auditLog is not defined` at every audit callback,
// silently swallowed by `void`). Module scope makes the closure chain
// explicit + visible to every reader.
const auditLog = getDefaultAuditLog();
import { registerInstanceHandlers } from './instance.js';
import { registerMetroHandlers } from './metro.js';
import { registerToolsHandlers } from './tools.js';
import { registerProfileHandlers } from './profile.js';
import { registerWizardHandlers } from './wizard.js';
import { registerDevtoolsHandlers } from './devtools.js';
import { installPanelBridge } from '../panel-bridge-electron.js';
import { PanelSenderRegistry } from '../panel-sender-registry.js';
import { createBoundsCache, type ModulesPanelsIpcDeps } from './modules-panels.js';
import { registerModulesPanelsIpc } from './modules-panels-register.js';
import type { ModulesConfigIpcDeps } from './modules-config.js';
import { registerModulesConfigIpc } from './modules-config-register.js';
import {
  registerModulesInstallIpc,
  type ModulesInstallIpcDeps,
} from './modules-install-register.js';

// Phase 5b hardening — one PanelSenderRegistry per Electron process.
// The main BrowserWindow's webContents is trusted as "host"; panel
// factory registers each new WebContentsView against its moduleId.
// ipcMain handlers consult this via _event.sender to reject spoofed
// moduleId payloads.
const senderRegistry = new PanelSenderRegistry();

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

  // Trust the main BrowserWindow's webContents as the host UI. READ
  // access is wildcard (Marketplace panel enumerates every module; the
  // modules:list surface needs cross-module reads). WRITE access is an
  // explicit allowlist — Phase 6 Security P1-1 caps renderer-XSS blast
  // radius. `settings` is the only host-writable module today; add more
  // here when a new host-native panel legitimately edits another
  // module's config.
  senderRegistry.trustHostSender(window.webContents);
  senderRegistry.allowHostWrite('settings');

  // Forward service bus events to renderer (legacy, for global logs)
  serviceBus.on('log', (text: string) => send('service:log', text));

  // Phase 8 — every privileged host action funnels through the
  // HMAC-chained AuditLog. The service-log pane UX is preserved via a
  // single subscription that renders each audit entry as a human-
  // readable line; the structured record persists at `~/.rn-dev/audit.log`
  // and survives across daemon restarts (chain verifies post-hoc).
  //
  // The `appended` listener attaches HERE rather than at module load
  // because `send()` requires `state.mainWindow` to be set. Any audit
  // entry logged before `setupIpcBridge` runs (unusual — it runs before
  // any module-related IPC could fire) lands on disk but not in the
  // service-log pane. Not a correctness hazard; it's a late-subscriber
  // UX note the architecture reviewer flagged.
  auditLog.on('appended', (entry: AuditEntry) => {
    send('service:log', formatAuditEntry(entry));
  });

  // Forward module-system events to the renderer so the sidebar rebuilds
  // when a 3p module installs / crashes / toggles + Settings + Marketplace
  // panels live-update on `config-changed`. Simplicity #6 (Phase 5c) —
  // we subscribe to the shared moduleEvents bus once it's published,
  // rather than routing through a second serviceBus topic. Same payload
  // the MCP server consumes via `modules/subscribe`.
  serviceBus.on('moduleEventsBus', (bus: EventEmitter) => {
    bus.on('modules-event', (event) => send('modules:event', event));
  });

  registerInstanceHandlers();
  registerMetroHandlers();
  registerToolsHandlers();
  registerProfileHandlers();
  registerWizardHandlers();
  registerDevtoolsHandlers();
  registerModulePanelsHandlers(window);
  registerModulesConfigHandlers();
  registerModulesInstallHandlers();
}

/**
 * Phase 4 (13.4.1 flipped) — install the module-panels bridge + its
 * ipcMain channels. Data-plane resolution (list, list-panels, host-call,
 * call-tool) routes through the daemon client; panel-lifecycle ops
 * (activate/deactivate/set-bounds) drive the local WebContentsView but
 * pre-fetch the manifest contribution + moduleRoot from the daemon via
 * `modules/resolve-panel`.
 *
 * The panel-bridge's `moduleRoot(id)` callback reads from a per-handler
 * cache (`moduleRoots`) populated by the `modules:activate-panel`
 * handler. The bridge's synchronous `register(moduleId, contribution)`
 * signature is preserved that way — the async RPC round-trip happens
 * upstream of the register call, never inside it.
 */
function registerModulePanelsHandlers(window: BrowserWindow): void {
  const boundsCache = createBoundsCache();
  const moduleRoots = new Map<string, string>();
  let deps: ModulesPanelsIpcDeps | null = null;

  const handle = registerModulesPanelsIpc(
    () => deps,
    () => senderRegistry,
  );

  serviceBus.on('modulesClient', (client) => {
    if (deps) return;

    const preloadPath = path.join(__dirname, '..', 'preload-module.js');
    const bridge = installPanelBridge({
      window,
      preloadPath,
      moduleRoot: (id: string) => moduleRoots.get(id) ?? '',
      getBounds: () =>
        handle.getActiveBounds() ?? { x: 0, y: 0, width: 0, height: 0 },
      auditLog: (event) => {
        void auditLog.append({
          kind: 'panel-bridge',
          moduleId: event.moduleId,
          outcome: 'ok',
          action: event.kind,
          panelId: event.panelId,
        });
      },
      senderRegistry,
    });

    deps = {
      bridge,
      modulesClient: client,
      bounds: boundsCache,
      moduleRoots,
      auditHostCall: (event) => {
        void auditLog.append({
          kind: 'host-call',
          moduleId: event.moduleId,
          outcome: mapHostCallOutcome(event.outcome),
          capabilityId: event.capabilityId,
          method: event.method,
        });
      },
    };

    // Re-notify the renderer so sidebar re-fetches panel list now that
    // deps are live. Renderer subscribes to `modules:event` and refetches
    // `modules:list-panels` on any kind — `ready` is a synthetic marker
    // for "deps just transitioned to non-null". Same semantics as before
    // the flip; the trigger is now serviceBus.modulesClient arrival.
    send('modules:event', { kind: 'ready', moduleId: '', scopeUnit: '' });
  });
}

/**
 * Phase 5a (13.4.1 flipped) — install the module-config ipcMain channels.
 * Handlers register eagerly; deps fill in once `connectElectronToDaemon`
 * publishes `modulesClient` (the daemon-client RPC surface). The
 * in-process `moduleHost` / `moduleRegistry` / `moduleEventsBus` topics
 * are no longer consulted here — reads + writes both go through the
 * client's `configGet` / `configSet` round-trip. The service:log audit
 * sink stays Electron-side so the renderer's log pane keeps showing
 * config-set outcomes; the daemon runs its own HMAC-chained audit log.
 */
function registerModulesConfigHandlers(): void {
  let deps: ModulesConfigIpcDeps | null = null;

  registerModulesConfigIpc(
    () => deps,
    () => senderRegistry,
  );

  serviceBus.on('modulesClient', (client) => {
    if (deps) return;
    deps = {
      modulesClient: client,
      auditConfigSet: (event) => {
        void auditLog.append({
          kind: 'config-set',
          moduleId: event.moduleId,
          outcome: event.outcome === 'ok' ? 'ok' : 'error',
          patchKeys: event.patchKeys,
          ...(event.code ? { code: event.code } : {}),
          ...(event.scopeUnit ? { scopeUnit: event.scopeUnit } : {}),
        });
      },
    };
  });
}

/**
 * Phase 6 (13.4.1 flipped) — install/uninstall/marketplace ipcMain
 * handlers. Deps resolve to the daemon-client RPC surface (`modulesClient`)
 * published by `connectElectronToDaemon`. Kieran + Security P1 sender-
 * identity gate unchanged: a sandboxed panel still can't trigger
 * pacote-backed installs on the user's behalf — the marketplace write
 * principal is only granted to the host UI's webContents.
 */
function registerModulesInstallHandlers(): void {
  let deps: ModulesInstallIpcDeps | null = null;

  senderRegistry.allowHostWrite('marketplace');
  registerModulesInstallIpc(
    () => deps,
    () => senderRegistry,
  );

  serviceBus.on('modulesClient', (client) => {
    if (deps) return;
    deps = {
      modulesClient: client,
      auditInstall: (event) => {
        void auditLog.append({
          kind: event.kind,
          moduleId: event.moduleId,
          outcome: event.outcome === 'ok' ? 'ok' : 'error',
          ...(event.code ? { code: event.code } : {}),
          ...(event.version ? { version: event.version } : {}),
        });
      },
    };
  });
}

/**
 * Render a structured audit entry as a service-log line so the existing
 * log pane UX doesn't regress. Switches on the `kind` discriminator so
 * each subsystem gets a tailored one-liner; the default branch exists
 * only to keep this exhaustive for a TS-never guarantee.
 */
function formatAuditEntry(entry: AuditEntry): string {
  const id = entry.moduleId || '(host)';
  const tag = `[${entry.kind}]`;
  const codeSuffix = 'code' in entry && entry.code ? ` (${entry.code})` : '';
  switch (entry.kind) {
    case 'install':
    case 'uninstall': {
      const v = 'version' in entry && entry.version ? ` v${entry.version}` : '';
      return `${tag} ${id}${v} ${entry.outcome}${codeSuffix}`;
    }
    case 'host-call':
      return `${tag} ${id}/${entry.capabilityId}.${entry.method} ${entry.outcome}`;
    case 'config-set': {
      const scope = entry.scopeUnit ? `:${entry.scopeUnit}` : '';
      return `${tag} ${id}${scope} keys=[${entry.patchKeys.join(',')}] ${entry.outcome}${codeSuffix}`;
    }
    case 'panel-bridge':
      return `${tag} ${entry.action} ${id}:${entry.panelId} ${entry.outcome}`;
  }
}

/**
 * Map the Phase 4 host-call audit outcomes (unavailable | denied |
 * method-not-found | ok | error) onto the AuditLog's 3-value `AuditOutcome`.
 */
function mapHostCallOutcome(
  outcome: 'ok' | 'unavailable' | 'denied' | 'method-not-found' | 'error',
): 'ok' | 'error' | 'denied' {
  if (outcome === 'ok') return 'ok';
  if (outcome === 'denied') return 'denied';
  return 'error';
}
