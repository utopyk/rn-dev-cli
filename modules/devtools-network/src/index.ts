// devtools-network subprocess entry. Spawned by the rn-dev host via
// `node dist/index.js` after `@rn-dev-modules/devtools-network` is
// installed into `~/.rn-dev/modules/devtools-network/`.
//
// Manifest-loaded: the host reads `rn-dev-module.json` for MCP tool
// contributions; `runModule()` registers exactly those names so manifest
// and runtime can't drift.
//
// Data path: every tool call resolves the `devtools` host capability
// (registered at `startServicesAsync` time) and round-trips through
// vscode-jsonrpc `host/call` back to the daemon's `DevToolsManager`.
// The S5 body-redaction gate is the module's `captureBodies` config
// value — OFF by default.
//
// All four tool wire names carry the 3p `<moduleId>__` prefix
// (`devtools-network__*`). Agents that used the previous built-in
// names (`rn-dev/devtools-network-*`) should re-discover tools via
// `tools/listChanged`; the names won't match 1:1.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runModule, type ModuleManifest } from "@rn-dev/module-sdk";
import { clear, get, list, selectTarget, status } from "./tools.js";

export const MODULE_ID = "devtools-network" as const;

async function loadManifest(entryDir: string): Promise<ModuleManifest> {
  const manifestPath = join(entryDir, "..", "rn-dev-module.json");
  const raw = await readFile(manifestPath, "utf-8");
  return JSON.parse(raw) as ModuleManifest;
}

const invokedAsEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /devtools-network[\\/](dist|src)[\\/]index\.(js|ts)$/.test(process.argv[1]);

if (invokedAsEntry) {
  const entryDir = dirname(fileURLToPath(import.meta.url));
  const manifest = await loadManifest(entryDir);

  runModule({
    manifest,
    tools: {
      "devtools-network__status": (args, ctx) => status(args, ctx),
      "devtools-network__list": (args, ctx) => list(args, ctx),
      "devtools-network__get": (args, ctx) => get(args, ctx),
      "devtools-network__select-target": (args, ctx) => selectTarget(args, ctx),
      "devtools-network__clear": (args, ctx) => clear(args, ctx),
    },
    activate: (ctx) => {
      ctx.log.info("devtools-network activated", {
        captureBodies: ctx.config.captureBodies === true,
      });
    },
  });
}
