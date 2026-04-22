// Electron-bound registrar for module-config IPC. Separated from
// `modules-config.ts` so the pure logic there can be imported in vitest
// without triggering `import { ipcMain } from "electron"` at module load.
//
// Channels are registered eagerly — deps are looked up per call via
// `getDeps()` so the renderer can safely invoke `modules:config-get`
// before `startRealServices` finishes publishing `moduleHost` +
// `moduleRegistry` + `moduleEventsBus`. Missing deps return a clear
// error rather than "No handler registered".

import { ipcMain } from "electron";
import {
  handleConfigGet,
  handleConfigSet,
  type ConfigGetPayload,
  type ConfigSetPayload,
  type ModulesConfigIpcDeps,
} from "./modules-config.js";

export interface ModulesConfigIpcHandle {
  dispose: () => void;
}

export function registerModulesConfigIpc(
  getDeps: () => ModulesConfigIpcDeps | null,
): ModulesConfigIpcHandle {
  ipcMain.handle("modules:config-get", (_event, payload: ConfigGetPayload) => {
    const deps = getDeps();
    if (!deps) {
      return { error: "modules-config: services not ready yet" };
    }
    return handleConfigGet(deps, payload);
  });

  ipcMain.handle("modules:config-set", (_event, payload: ConfigSetPayload) => {
    const deps = getDeps();
    if (!deps) {
      return {
        kind: "error" as const,
        code: "E_CONFIG_MODULE_UNKNOWN" as const,
        message: "modules-config: services not ready yet",
      };
    }
    return handleConfigSet(deps, payload);
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("modules:config-get");
      ipcMain.removeHandler("modules:config-set");
    },
  };
}
