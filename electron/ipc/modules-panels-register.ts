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
 */
export function registerModulesPanelsIpc(
  deps: ModulesPanelsIpcDeps,
): ModulesPanelsIpcHandle {
  let activeKey: string | null = null;

  ipcMain.handle("modules:list-panels", () => listPanels(deps.registry));

  ipcMain.handle(
    "modules:activate-panel",
    (_event, payload: ActivatePanelPayload) => {
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
      const result = deactivatePanel(deps, payload);
      const key = `${payload.moduleId}:${payload.panelId}`;
      if (activeKey === key) activeKey = null;
      return result;
    },
  );

  ipcMain.handle(
    "modules:set-panel-bounds",
    (_event, payload: SetPanelBoundsPayload) => setPanelBounds(deps, payload),
  );

  ipcMain.handle(
    "modules:host-call",
    (_event, payload: HostCallPayload) =>
      resolveHostCall(deps.manager, deps.registry, payload),
  );

  return {
    dispose: () => {
      ipcMain.removeHandler("modules:list-panels");
      ipcMain.removeHandler("modules:activate-panel");
      ipcMain.removeHandler("modules:deactivate-panel");
      ipcMain.removeHandler("modules:set-panel-bounds");
      ipcMain.removeHandler("modules:host-call");
    },
    getActiveBounds: () =>
      activeKey ? deps.bounds.get(activeKey) : undefined,
  };
}
