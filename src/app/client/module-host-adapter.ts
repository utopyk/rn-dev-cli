// Client-side ModuleHost adapter. Phase 13.4 prereq #3.
//
// The 13.3 `routeEventToAdapters` switch had no home for `modules/*`
// events — the TUI didn't consume them. Electron does: its renderer
// sidebar, Marketplace panel, and Settings form all re-render when
// modules install / crash / flip state.
//
// This adapter consumes the three module-lifecycle SessionEvents the
// supervisor fans out (`modules/state-changed|crashed|failed`) and
// re-emits them through two surfaces:
//
//   1. Typed topic events — `state-changed`, `crashed`, `failed` —
//      so new code can attach directly to the adapter.
//   2. The `modules-event` topic, matching the pre-13.4 on-process
//      `moduleEventsBus` shape. Electron's ipcMain wiring in
//      `electron/ipc/index.ts` pipes `modules-event` payloads to the
//      renderer as `modules:event` IPC sends; keeping the shape
//      identical means that forwarder needs no edits during the flip.
//
// Module RPCs (list / status / install / enable / disable / config /
// restart / marketplace) are reachable via `client.send(...)` against
// the same daemon; the Electron handlers in `electron/ipc/modules-*`
// call them directly. We expose them here too, but only the ones the
// flip consumes — keeps the adapter from growing into a
// one-to-one mirror of `modules-ipc.ts` prematurely.

import { EventEmitter } from "node:events";
import type { IpcClient } from "../../core/ipc.js";
import type { AdapterSink, ModuleHostEventKind } from "./adapter-sink.js";

/**
 * Payload shape on the `modules-event` topic. Matches what
 * `registerModulesIpc` emits on its local bus in Phase 3a+, which is
 * what the Electron renderer expects today. Not exported from
 * `modules-ipc.ts` because it's a subset — supervisor events carry
 * state-changed / crashed / failed but not enabled / installed /
 * config-changed (those still flow through `modules/subscribe`).
 */
export interface ModulesEventPayload {
  kind: "state-changed" | "crashed" | "failed";
  moduleId: string;
  scopeUnit: string;
  /** Present on `state-changed` — the destination state. */
  state?: string;
  /** Present on `crashed` / `failed`. */
  reason?: string;
}

export interface ModuleHostClientEvents {
  "state-changed": (evt: {
    moduleId: string;
    scopeUnit: string;
    from: string;
    to: string;
  }) => void;
  crashed: (evt: {
    moduleId: string;
    scopeUnit: string;
    reason: string;
  }) => void;
  failed: (evt: {
    moduleId: string;
    scopeUnit: string;
    reason: string;
  }) => void;
  /**
   * Shimmed-through copy of the three events above, shaped to match the
   * pre-13.4 in-process `moduleEventsBus` payload. Exists so existing
   * renderer-forwarding code keeps working during the flip (see
   * electron/ipc/index.ts).
   */
  "modules-event": (evt: ModulesEventPayload) => void;
  /** Fires once on unexpected daemon death (Phase 13.4 prereq #1). */
  disconnected: (err?: Error) => void;
}

export class ModuleHostClient
  extends EventEmitter
  implements AdapterSink<ModuleHostEventKind>
{
  constructor(
    private client: IpcClient,
    private nextId: () => string,
  ) {
    super();
  }

  dispatch(kind: ModuleHostEventKind, data: unknown): void {
    if (kind === "modules/state-changed") {
      const p = data as {
        moduleId: string;
        scopeUnit: string;
        from: string;
        to: string;
      };
      this.emit("state-changed", p);
      // Match pre-13.4 filter — renderer only cared about transitions
      // that affect tool callability (registerModulesIpc::forwardStateChanged).
      if (p.to === "active" || p.from === "active") {
        this.emit("modules-event", {
          kind: "state-changed",
          moduleId: p.moduleId,
          scopeUnit: p.scopeUnit,
          state: p.to,
        });
      }
      return;
    }
    if (kind === "modules/crashed") {
      const p = data as { moduleId: string; scopeUnit: string; reason: string };
      this.emit("crashed", p);
      this.emit("modules-event", {
        kind: "crashed",
        moduleId: p.moduleId,
        scopeUnit: p.scopeUnit,
        reason: p.reason,
      });
      return;
    }
    if (kind === "modules/failed") {
      const p = data as { moduleId: string; scopeUnit: string; reason: string };
      this.emit("failed", p);
      this.emit("modules-event", {
        kind: "failed",
        moduleId: p.moduleId,
        scopeUnit: p.scopeUnit,
        reason: p.reason,
      });
    }
  }

  notifyDisconnected(err?: Error): void {
    this.emit("disconnected", err);
  }

  // -------------------------------------------------------------------
  // RPC passthroughs.
  //
  // Kept minimal — every method mirrors exactly one daemon RPC without
  // translation. Electron's ipcMain handlers stay the canonical call
  // site, not this adapter. Adding more here is load-bearing only when
  // a second client (MCP in Phase 13.5, or a renderer-side mirror)
  // needs them.
  // -------------------------------------------------------------------

  async list(): Promise<unknown> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/list",
      id: this.nextId(),
    });
    return resp.payload;
  }
}
