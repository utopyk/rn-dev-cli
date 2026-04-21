/**
 * NetworkTap — reduces CDP `Network.*` events into `NetworkEntry` rows in the
 * ring buffer, plus a bounded fire-and-forget worker that fetches response
 * bodies via `Network.getResponseBody`.
 *
 * Event order reference (CDP):
 *   1. `Network.requestWillBeSent` (optionally with `redirectResponse` for
 *      redirect hops — shares `requestId` with prior hops).
 *   2. `Network.responseReceived` — status, headers, mimeType.
 *   3. N × `Network.dataReceived` — chunks (on Hermes: metadata only,
 *      lengths without bytes).
 *   4. `Network.loadingFinished` — completion signal; we enqueue a body fetch.
 *   5. or `Network.loadingFailed` — terminal failure.
 */

import type {
  CapturedBody,
  CdpStackTrace,
  Initiator,
  NetworkEntry,
} from "./types.js";
import { DEFAULTS, type DevToolsOpts } from "./types.js";
import {
  type CdpCommand,
  type CdpEvent,
  type CdpResponse,
  type DomainTap,
  type RingBuffer,
  type TapDispatch,
  createRingBuffer,
} from "./domain-tap.js";
import { redactHeaders } from "./redact.js";

// ---------------------------------------------------------------------------
// Helpers: body kind inference
// ---------------------------------------------------------------------------

const TEXT_MIME_REGEX = /^(text\/|application\/(json|javascript|xml)|[a-z]+\/[a-z.+-]*\+json|[a-z]+\/[a-z.+-]*\+xml)/i;

function isTextMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return TEXT_MIME_REGEX.test(mime);
}

function captureTextBody(raw: string, cap: number): CapturedBody {
  if (raw.length <= cap) {
    return { kind: "text", data: raw, truncated: false, droppedBytes: 0 };
  }
  return {
    kind: "text",
    data: raw.slice(0, cap),
    truncated: true,
    droppedBytes: raw.length - cap,
  };
}

function normalizeInitiator(raw: unknown): Initiator | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "other";
  switch (type) {
    case "parser":
      return { type: "parser", url: typeof obj.url === "string" ? obj.url : "" };
    case "script": {
      const stack = obj.stack;
      if (typeof stack === "object" && stack !== null) {
        return { type: "script", stack: stack as unknown as CdpStackTrace };
      }
      return { type: "other" };
    }
    case "preload":
      return { type: "preload" };
    default:
      return { type: "other" };
  }
}

// ---------------------------------------------------------------------------
// Body fetcher — fire-and-forget worker pool
// ---------------------------------------------------------------------------

interface BodyJob {
  cdpRequestId: string;
}

class BodyFetcher {
  private queue: BodyJob[] = [];
  private inflight = 0;
  private disposed = false;

  constructor(
    private readonly dispatch: () => TapDispatch | null,
    private readonly concurrency: number,
    private readonly timeoutMs: number,
    private readonly queueCap: number,
    private readonly onDrop: () => void,
    private readonly onResult: (
      cdpRequestId: string,
      result: CdpResponse | Error
    ) => void
  ) {}

  enqueue(cdpRequestId: string): void {
    if (this.disposed) return;
    if (this.queue.length >= this.queueCap) {
      this.queue.shift();
      this.onDrop();
    }
    this.queue.push({ cdpRequestId });
    this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
  }

  private drain(): void {
    while (!this.disposed && this.inflight < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inflight += 1;
      void this.run(job);
    }
  }

  private async run(job: BodyJob): Promise<void> {
    const d = this.dispatch();
    if (!d) {
      this.inflight -= 1;
      if (!this.disposed) this.onResult(job.cdpRequestId, new Error("no-dispatch"));
      this.drain();
      return;
    }
    try {
      const cmd: CdpCommand = {
        method: "Network.getResponseBody",
        params: { requestId: job.cdpRequestId },
      };
      const res = await d.sendCommand(cmd, this.timeoutMs);
      if (!this.disposed) this.onResult(job.cdpRequestId, res);
    } catch (e) {
      if (!this.disposed) {
        this.onResult(
          job.cdpRequestId,
          e instanceof Error ? e : new Error(String(e))
        );
      }
    } finally {
      this.inflight -= 1;
      this.drain();
    }
  }
}

// ---------------------------------------------------------------------------
// NetworkTap
// ---------------------------------------------------------------------------

export class NetworkTap implements DomainTap<NetworkEntry> {
  readonly domain = "Network";
  readonly enableCommands: readonly CdpCommand[] = [
    { method: "Network.enable" },
  ];
  readonly ring: RingBuffer<NetworkEntry>;

  private dispatch: TapDispatch | null = null;
  private readonly body: BodyFetcher;
  private readonly captureBodies: boolean;
  private readonly requestBodyCap: number;
  private readonly responseBodyCap: number;

  constructor(opts: DevToolsOpts = {}) {
    const {
      ringCapacity = DEFAULTS.ringCapacity,
      requestBodyCap = DEFAULTS.requestBodyCap,
      responseBodyCap = DEFAULTS.responseBodyCap,
      bodyFetchConcurrency = DEFAULTS.bodyFetchConcurrency,
      bodyFetchTimeoutMs = DEFAULTS.bodyFetchTimeoutMs,
      bodyFetchQueueCap = DEFAULTS.bodyFetchQueueCap,
      captureBodies = DEFAULTS.captureBodies,
    } = opts;

    this.ring = createRingBuffer<NetworkEntry>(ringCapacity);
    this.captureBodies = captureBodies;
    this.requestBodyCap = requestBodyCap;
    this.responseBodyCap = responseBodyCap;

    this.body = new BodyFetcher(
      () => this.dispatch,
      bodyFetchConcurrency,
      bodyFetchTimeoutMs,
      bodyFetchQueueCap,
      () => this.ring.incTapDropped(),
      (requestId, result) => this.onBodyResult(requestId, result)
    );
  }

  attach(dispatch: TapDispatch): void {
    this.dispatch = dispatch;
  }

  detach(): void {
    this.dispatch = null;
    this.body.dispose();
  }

  handleEvent(evt: CdpEvent): void {
    if (!evt.method.startsWith("Network.")) return;
    switch (evt.method) {
      case "Network.requestWillBeSent":
        this.onRequestWillBeSent(evt.params);
        break;
      case "Network.responseReceived":
        this.onResponseReceived(evt.params);
        break;
      case "Network.dataReceived":
        this.onDataReceived(evt.params);
        break;
      case "Network.loadingFinished":
        this.onLoadingFinished(evt.params);
        break;
      case "Network.loadingFailed":
        this.onLoadingFailed(evt.params);
        break;
      default:
        // Ignored: extraInfo (not supported on Hermes), signedExchange,
        // webSocketCreated, etc.
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private onRequestWillBeSent(params: Record<string, unknown>): void {
    const cdpRequestId = String(params.requestId ?? "");
    if (!cdpRequestId) return;

    const request = (params.request as Record<string, unknown>) ?? {};
    const url = String(request.url ?? "");
    const method = String(request.method ?? "GET");
    const headersRaw = (request.headers as Record<string, string>) ?? {};
    const headers = redactHeaders(headersRaw);
    const postData = typeof request.postData === "string" ? request.postData : undefined;
    const requestBody: CapturedBody = this.captureBodies
      ? postData !== undefined
        ? captureTextBody(postData, this.requestBodyCap)
        : { kind: "absent", reason: "not-captured" }
      : { kind: "redacted", reason: "operator-disabled" };

    const startedAt = Number(params.timestamp ?? Date.now() / 1000) * 1000;
    const initiator = normalizeInitiator(params.initiator);

    const redirectResponse = params.redirectResponse as
      | Record<string, unknown>
      | undefined;

    this.ring.upsert(cdpRequestId, (prev, sequence, version) => {
      const redirectChain = redirectResponse
        ? [
            ...(prev?.redirectChain ?? []),
            String((redirectResponse.url as string) ?? prev?.url ?? ""),
          ]
        : prev?.redirectChain;

      const entry: NetworkEntry = {
        requestId: cdpRequestId,
        sequence,
        version,
        method,
        url,
        requestHeaders: headers,
        requestBody,
        timings: { startedAt },
        initiator,
        redirectChain,
        source: "cdp",
        terminalState: "pending",
      };
      return entry;
    });
  }

  private onResponseReceived(params: Record<string, unknown>): void {
    const cdpRequestId = String(params.requestId ?? "");
    if (!cdpRequestId) return;

    const response = (params.response as Record<string, unknown>) ?? {};
    const status = Number(response.status ?? 0);
    const statusText = String(response.statusText ?? "");
    const mimeType = String(response.mimeType ?? "");
    const responseHeaders = redactHeaders(
      (response.headers as Record<string, string>) ?? {}
    );

    this.ring.upsert(cdpRequestId, (prev, sequence, version) => {
      if (!prev) {
        // responseReceived arrived without prior requestWillBeSent — skip
        // gracefully by reconstructing a minimal pending row that we'll
        // replace on finish/fail.
        return {
          requestId: cdpRequestId,
          sequence,
          version,
          method: "UNKNOWN",
          url: String(response.url ?? ""),
          requestHeaders: {},
          requestBody: { kind: "absent", reason: "not-captured" },
          timings: { startedAt: Date.now() },
          source: "cdp",
          terminalState: "pending",
        };
      }
      // We stash the status info into `pending` — final transition happens on
      // loadingFinished/Failed. Using `Object.assign`-free explicit shape so
      // TS accepts the union.
      return {
        ...prev,
        version,
        terminalState: "pending",
        // these fields will be attached to the terminal entry below — for now
        // we store them on the pending entry via an internal carry. Since the
        // union doesn't allow status on pending, we keep them in a shadow map.
      };
    });
    // Stash shadow info to apply on finalize.
    this.shadow.set(cdpRequestId, {
      status,
      statusText,
      mimeType,
      responseHeaders,
    });
  }

  private onDataReceived(params: Record<string, unknown>): void {
    const cdpRequestId = String(params.requestId ?? "");
    if (!cdpRequestId) return;
    // On Hermes, dataReceived is metadata-only (no bytes). We don't need to
    // accumulate anything here for MVP; body comes via getResponseBody.
    // Kept as an observable hook — bumps `version` on the entry so live
    // consumers see progress, but only every ~Nth event to keep churn down.
    // MVP: no-op to preserve simplicity.
    void params;
  }

  private onLoadingFinished(params: Record<string, unknown>): void {
    const cdpRequestId = String(params.requestId ?? "");
    if (!cdpRequestId) return;
    const completedAt = Number(params.timestamp ?? Date.now() / 1000) * 1000;
    const shadow = this.shadow.get(cdpRequestId);

    this.ring.upsert(cdpRequestId, (prev, sequence, version) => {
      if (!prev) {
        return this.synthesizeMissing(cdpRequestId, sequence, version, completedAt);
      }
      const durationMs = Math.max(0, completedAt - prev.timings.startedAt);
      return {
        ...prev,
        version,
        terminalState: "finished",
        status: shadow?.status ?? 0,
        statusText: shadow?.statusText ?? "",
        mimeType: shadow?.mimeType ?? "",
        responseHeaders: shadow?.responseHeaders ?? {},
        responseBody: this.pendingBodyPlaceholder(shadow?.status, shadow?.mimeType),
        timings: {
          startedAt: prev.timings.startedAt,
          completedAt,
          durationMs,
        },
      };
    });
    // Enqueue body fetch, unless we already decided it's absent (e.g. 204/304
    // or capture disabled).
    if (this.shouldFetchBody(shadow?.status, shadow?.mimeType)) {
      this.body.enqueue(cdpRequestId);
    }
    this.shadow.delete(cdpRequestId);
  }

  private onLoadingFailed(params: Record<string, unknown>): void {
    const cdpRequestId = String(params.requestId ?? "");
    if (!cdpRequestId) return;
    const completedAt = Number(params.timestamp ?? Date.now() / 1000) * 1000;
    const errorText = String(params.errorText ?? "Unknown");
    const shadow = this.shadow.get(cdpRequestId);

    this.ring.upsert(cdpRequestId, (prev, sequence, version) => {
      if (!prev) {
        // Fabricate a stub for a request we never saw.
        return {
          requestId: cdpRequestId,
          sequence,
          version,
          method: "UNKNOWN",
          url: "",
          requestHeaders: {},
          requestBody: { kind: "absent", reason: "not-captured" },
          timings: { startedAt: completedAt, completedAt, durationMs: 0 },
          source: "cdp",
          terminalState: "failed",
          failureReason: errorText,
        };
      }
      const durationMs = Math.max(0, completedAt - prev.timings.startedAt);
      return {
        ...prev,
        version,
        terminalState: "failed",
        failureReason: errorText,
        status: shadow?.status,
        responseHeaders: shadow?.responseHeaders,
        timings: {
          startedAt: prev.timings.startedAt,
          completedAt,
          durationMs,
        },
      };
    });
    this.shadow.delete(cdpRequestId);
  }

  // -------------------------------------------------------------------------
  // Body result path
  // -------------------------------------------------------------------------

  private onBodyResult(cdpRequestId: string, result: CdpResponse | Error): void {
    const mkBody = (): CapturedBody => {
      if (result instanceof Error) {
        return { kind: "absent", reason: "fetch-failed" };
      }
      if (result.error) {
        return { kind: "absent", reason: "fetch-failed" };
      }
      const body = (result.result as Record<string, unknown> | undefined) ?? {};
      const bodyText = typeof body.body === "string" ? body.body : "";
      const base64 = body.base64Encoded === true;
      const prev = this.ring.get(cdpRequestId);
      const mimeType = prev && prev.terminalState === "finished" ? prev.mimeType : "";

      if (base64 || !isTextMime(mimeType)) {
        // Binary — drop bytes, keep metadata. We know byteLength from base64
        // by length * 3/4 approximation; we prefer the exact value from the
        // running entry when available.
        const approxBytes = base64
          ? Math.floor((bodyText.length * 3) / 4)
          : bodyText.length;
        return { kind: "binary", mimeType: mimeType || "application/octet-stream", byteLength: approxBytes };
      }
      const captured = captureTextBody(bodyText, this.responseBodyCap);
      if (captured.kind === "text" && captured.truncated) {
        this.ring.incBodyTruncated();
      }
      return captured;
    };

    const body = mkBody();

    this.ring.upsert(cdpRequestId, (prev, sequence, version) => {
      if (!prev) {
        // Response fetched for an unknown requestId — synthesize a finished
        // entry so the DTO layer has something coherent.
        return this.synthesizeMissing(cdpRequestId, sequence, version, Date.now(), body);
      }
      if (prev.terminalState === "finished") {
        return { ...prev, version, responseBody: body };
      }
      // Body arrived for a pending/failed entry — attach to failed, ignore on
      // pending (body without a response is an inconsistent CDP state).
      if (prev.terminalState === "failed") {
        return { ...prev, version };
      }
      return { ...prev, version };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Response-shape fields we collect on `responseReceived` and apply at
  // terminal transition. Kept off the entry union because status/headers are
  // illegal on a `pending` row.
  private shadow: Map<
    string,
    {
      status: number;
      statusText: string;
      mimeType: string;
      responseHeaders: Record<string, string>;
    }
  > = new Map();

  private pendingBodyPlaceholder(
    status: number | undefined,
    mimeType: string | undefined
  ): CapturedBody {
    if (!this.captureBodies) {
      return { kind: "redacted", reason: "operator-disabled" };
    }
    if (status === 204 || status === 304) {
      return { kind: "absent", reason: "204-or-304" };
    }
    // Placeholder while body fetch is in flight. Overwritten by onBodyResult.
    if (!isTextMime(mimeType)) {
      return { kind: "binary", mimeType: mimeType ?? "application/octet-stream", byteLength: 0 };
    }
    return { kind: "absent", reason: "not-captured" };
  }

  private shouldFetchBody(
    status: number | undefined,
    mimeType: string | undefined
  ): boolean {
    if (!this.captureBodies) return false;
    if (status === 204 || status === 304) return false;
    if (!isTextMime(mimeType)) return false; // binary stays metadata-only
    return true;
  }

  private synthesizeMissing(
    cdpRequestId: string,
    sequence: number,
    version: number,
    completedAt: number,
    responseBody: CapturedBody = { kind: "absent", reason: "not-captured" }
  ): NetworkEntry {
    return {
      requestId: cdpRequestId,
      sequence,
      version,
      method: "UNKNOWN",
      url: "",
      requestHeaders: {},
      requestBody: { kind: "absent", reason: "not-captured" },
      timings: { startedAt: completedAt, completedAt, durationMs: 0 },
      source: "cdp",
      terminalState: "finished",
      status: 0,
      statusText: "",
      mimeType: "",
      responseHeaders: {},
      responseBody,
    };
  }
}
