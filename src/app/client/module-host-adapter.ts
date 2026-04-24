// Client-side ModuleHost adapter. Phase 13.4 prereq #3.
//
// The 13.3 `routeEventToAdapters` switch had no home for `modules/*`
// events — the TUI didn't consume them. Electron does: its renderer
// sidebar, Marketplace panel, and Settings form all re-render when
// modules install / crash / flip state.
//
// This adapter consumes the three module-lifecycle SessionEvents the
// supervisor fans out (`modules/state-changed|crashed|failed`) and
// re-emits them on the `modules-event` topic, matching the pre-13.4
// in-process `moduleEventsBus` shape. Electron's ipcMain wiring at
// [electron/ipc/index.ts:93-95](../../../electron/ipc/index.ts) pipes
// `modules-event` payloads to the renderer as `modules:event` IPC
// sends; keeping the shape identical means that forwarder needs no
// edits during the 13.4.1 handler flip.
//
// Typed per-kind events (`state-changed` / `crashed` / `failed`)
// were considered and dropped — no current consumer. Add them back
// when a second subscriber actually appears (simplicity P2 on PR #18).
//
// Each `data` payload is narrowed through a runtime guard before
// re-emission so a malformed daemon push (or a future schema drift)
// surfaces as a dropped event + warn line rather than an
// undefined-laden IPC message the renderer's Marketplace panel
// would render. Matches the precedent `parseSessionEventEnvelope`
// set in PR #17 (Kieran P0 + Security P2 on PR #18).

import { EventEmitter } from "node:events";
import type { IpcClient } from "../../core/ipc.js";
import type { AdapterSink, ModuleHostEventKind } from "./adapter-sink.js";
import type {
  HostCallReply,
  HostCallRequest,
  ListPanelsReply,
  ResolvePanelError,
  ResolvePanelReply,
  ModuleCallRequest,
  ModuleCallSuccess,
  ModuleCallError,
  ModuleConfigGetResult,
  ModuleConfigSetRequest,
  ModuleConfigSetResult,
  ModuleInstallRequest,
  ModuleInstallReply,
  ModuleUninstallReply,
  MarketplaceInfoReply,
  MarketplaceListReply,
  RegisteredModuleRow,
} from "../modules-ipc.js";

/**
 * Payload shape on the `modules-event` topic. Matches what
 * `registerModulesIpc` emits on its local bus in Phase 3a+, which is
 * what the Electron renderer expects today.
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
  /**
   * Shimmed-through copy of the three supervisor events, shaped to
   * match the pre-13.4 in-process `moduleEventsBus` payload. This is
   * the only consumer surface today; Electron's ipcMain forwarder
   * subscribes to it.
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

  // ---------------------------------------------------------------------------
  // RPC methods — Phase 13.4.1. Every `modules/*` + `marketplace/*` action
  // the Electron handlers consume, wired as a thin `client.send` wrapper so
  // callers don't re-derive action names + payload typing at each site.
  // The replies are passed through verbatim; wire-level `{ error: string }`
  // error shapes returned by the daemon's registrar are mapped to the
  // dispatcher's typed error shape at the caller — the adapter is not the
  // right place to invent a unified error envelope across 10 RPCs.
  // ---------------------------------------------------------------------------

  async list(): Promise<{ modules: RegisteredModuleRow[] }> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/list",
      id: this.nextId(),
    });
    return resp.payload as { modules: RegisteredModuleRow[] };
  }

  async listPanels(): Promise<ListPanelsReply> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/list-panels",
      id: this.nextId(),
    });
    return resp.payload as ListPanelsReply;
  }

  async resolvePanel(
    moduleId: string,
    panelId: string,
  ): Promise<ResolvePanelReply | ResolvePanelError> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/resolve-panel",
      id: this.nextId(),
      payload: { moduleId, panelId },
    });
    return resp.payload as ResolvePanelReply | ResolvePanelError;
  }

  async call(
    payload: ModuleCallRequest,
  ): Promise<ModuleCallSuccess | ModuleCallError> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/call",
      id: this.nextId(),
      payload,
    });
    return resp.payload as ModuleCallSuccess | ModuleCallError;
  }

  async hostCall(payload: HostCallRequest): Promise<HostCallReply> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/host-call",
      id: this.nextId(),
      payload,
    });
    return resp.payload as HostCallReply;
  }

  async configGet(
    moduleId: string,
    scopeUnit?: string,
  ): Promise<ModuleConfigGetResult | { error: string }> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/config/get",
      id: this.nextId(),
      payload: scopeUnit === undefined ? { moduleId } : { moduleId, scopeUnit },
    });
    return resp.payload as ModuleConfigGetResult | { error: string };
  }

  async configSet(
    payload: ModuleConfigSetRequest,
  ): Promise<ModuleConfigSetResult> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/config/set",
      id: this.nextId(),
      payload,
    });
    return resp.payload as ModuleConfigSetResult;
  }

  async install(payload: ModuleInstallRequest): Promise<ModuleInstallReply> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/install",
      id: this.nextId(),
      payload,
    });
    return resp.payload as ModuleInstallReply;
  }

  async uninstall(payload: {
    moduleId: string;
    scopeUnit?: string;
    keepData?: boolean;
  }): Promise<ModuleUninstallReply> {
    const resp = await this.client.send({
      type: "command",
      action: "modules/uninstall",
      id: this.nextId(),
      payload,
    });
    return resp.payload as ModuleUninstallReply;
  }

  async marketplaceList(): Promise<
    MarketplaceListReply | { kind: "error"; code: string; message: string }
  > {
    const resp = await this.client.send({
      type: "command",
      action: "marketplace/list",
      id: this.nextId(),
    });
    return resp.payload as
      | MarketplaceListReply
      | { kind: "error"; code: string; message: string };
  }

  async marketplaceInfo(moduleId: string): Promise<MarketplaceInfoReply> {
    const resp = await this.client.send({
      type: "command",
      action: "marketplace/info",
      id: this.nextId(),
      payload: { moduleId },
    });
    return resp.payload as MarketplaceInfoReply;
  }

  dispatch(kind: ModuleHostEventKind, data: unknown): void {
    if (kind === "modules/state-changed") {
      const p = readStateChangedPayload(data);
      if (!p) return;
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
      const p = readReasonPayload(data);
      if (!p) return;
      this.emit("modules-event", {
        kind: "crashed",
        moduleId: p.moduleId,
        scopeUnit: p.scopeUnit,
        reason: p.reason,
      });
      return;
    }
    if (kind === "modules/failed") {
      const p = readReasonPayload(data);
      if (!p) return;
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
}

interface StateChangedPayload {
  moduleId: string;
  scopeUnit: string;
  from: string;
  to: string;
}

interface ReasonPayload {
  moduleId: string;
  scopeUnit: string;
  reason: string;
}

function readStateChangedPayload(data: unknown): StateChangedPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.moduleId !== "string" ||
    typeof d.scopeUnit !== "string" ||
    typeof d.from !== "string" ||
    typeof d.to !== "string"
  ) {
    return null;
  }
  return {
    moduleId: d.moduleId,
    scopeUnit: d.scopeUnit,
    from: d.from,
    to: d.to,
  };
}

function readReasonPayload(data: unknown): ReasonPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.moduleId !== "string" ||
    typeof d.scopeUnit !== "string" ||
    typeof d.reason !== "string"
  ) {
    return null;
  }
  return {
    moduleId: d.moduleId,
    scopeUnit: d.scopeUnit,
    reason: d.reason,
  };
}
