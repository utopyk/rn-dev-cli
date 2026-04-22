// Electron-bound registrar for module-panel IPC. Separated from
// `modules-panels.ts` so the pure logic there can be imported in vitest
// without triggering `import { ipcMain } from "electron"` at module load
// time.

import { ipcMain } from "electron";
import {
  activatePanel,
  deactivatePanel,
  listPanels,
  resolveHostCall,
  setPanelBounds,
  type ActivatePanelPayload,
  type DeactivatePanelPayload,
  type HostCallPayload,
  type ModulesPanelsIpcDeps,
  type ModulesPanelsIpcHandle,
  type SetPanelBoundsPayload,
} from "./modules-panels.js";

/**
 * Installs the Electron `ipcMain.handle` channels for module panels. Each
 * channel delegates to the pure helpers in `modules-panels.ts` so the
 * glue is thin enough that an integration regression is the common
 * failure mode, not a logic bug.
 *
 * Channels are registered eagerly — deps are looked up per call via
 * `getDeps()` so the renderer can safely invoke `modules:list-panels`
 * before `startRealServices` finishes publishing `moduleHost` +
 * `moduleRegistry`. Missing deps return safe no-op defaults instead of
 * "No handler registered" errors.
 */
export function registerModulesPanelsIpc(
  getDeps: () => ModulesPanelsIpcDeps | null,
): ModulesPanelsIpcHandle {
  let activeKey: string | null = null;

  ipcMain.handle("modules:list-panels", () => {
    const deps = getDeps();
    if (!deps) return { modules: [] };
    return listPanels(deps.registry);
  });

  ipcMain.handle(
    "modules:activate-panel",
    (_event, payload: ActivatePanelPayload) => {
      const deps = getDeps();
      if (!deps) return { ok: false, error: "modules-panels: services not ready yet" };
      const result = activatePanel(deps, payload);
      if (result.ok) {
        activeKey = `${payload.moduleId}:${payload.panelId}`;
      }
      return result;
    },
  );

  ipcMain.handle(
    "modules:deactivate-panel",
    (_event, payload: DeactivatePanelPayload) => {
      const deps = getDeps();
      const key = `${payload.moduleId}:${payload.panelId}`;
      if (activeKey === key) activeKey = null;
      if (!deps) return { ok: true };
      return deactivatePanel(deps, payload);
    },
  );

  ipcMain.handle(
    "modules:set-panel-bounds",
    (_event, payload: SetPanelBoundsPayload) => {
      const deps = getDeps();
      if (!deps) return { ok: true };
      return setPanelBounds(deps, payload);
    },
  );

  ipcMain.handle("modules:host-call", (_event, payload: HostCallPayload) => {
    const deps = getDeps();
    if (!deps) {
      return {
        kind: "error" as const,
        code: "MODULE_UNAVAILABLE" as const,
        message: "modules-panels: services not ready yet",
      };
    }
    return resolveHostCall(
      deps.manager,
      deps.registry,
      payload,
      deps.auditHostCall,
    );
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("modules:list-panels");
      ipcMain.removeHandler("modules:activate-panel");
      ipcMain.removeHandler("modules:deactivate-panel");
      ipcMain.removeHandler("modules:set-panel-bounds");
      ipcMain.removeHandler("modules:host-call");
    },
    getActiveBounds: () => {
      const deps = getDeps();
      return activeKey && deps ? deps.bounds.get(activeKey) : undefined;
    },
  };
}
