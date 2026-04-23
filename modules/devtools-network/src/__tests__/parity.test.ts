/**
 * Parity test — guards against drift between the module's local mirrors of
 * host types (`types.ts`) and the real host types at
 * `src/core/devtools/types.ts`, plus the `DevtoolsHostCapability` shape
 * this module calls against.
 *
 * The module can't import host source directly (bundling boundary
 * violation), so the equivalence is verified via TypeScript's structural
 * subtyping: each assignment below must compile. When the host type
 * gains or renames a field, this file starts failing type-check at the
 * corresponding assignment — that's the intended signal.
 *
 * Runtime assertions are deliberately trivial; the real coverage is
 * compile-time.
 */

import { describe, it, expect } from "vitest";
import type {
  CaptureListResult as HostCaptureListResult,
  CaptureMeta as HostCaptureMeta,
  CapturedBody as HostCapturedBody,
  DevToolsStatus as HostDevToolsStatus,
  NetworkEntry as HostNetworkEntry,
  NetworkFilter as HostNetworkFilter,
  TargetDescriptor as HostTargetDescriptor,
} from "../../../../src/core/devtools/types.js";
import type {
  DevtoolsHostCapability as HostDevtoolsHostCapability,
} from "../../../../src/core/devtools/host-capability.js";
import type {
  CaptureListResult,
  CaptureMeta,
  CapturedBody,
  DevToolsStatus,
  NetworkEntry,
  NetworkFilter,
  TargetDescriptor,
} from "../types.js";
import type { DevtoolsHostCapability } from "../host-capability.js";

describe("module type mirrors — structural parity with host types", () => {
  it("NetworkEntry shape is assignable in both directions", () => {
    const fromHost = (x: HostNetworkEntry): NetworkEntry => x;
    const toHost = (x: NetworkEntry): HostNetworkEntry => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("CaptureMeta shape is assignable in both directions", () => {
    const fromHost = (x: HostCaptureMeta): CaptureMeta => x;
    const toHost = (x: CaptureMeta): HostCaptureMeta => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("CapturedBody shape is assignable in both directions", () => {
    const fromHost = (x: HostCapturedBody): CapturedBody => x;
    const toHost = (x: CapturedBody): HostCapturedBody => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("TargetDescriptor shape is assignable in both directions", () => {
    const fromHost = (x: HostTargetDescriptor): TargetDescriptor => x;
    const toHost = (x: TargetDescriptor): HostTargetDescriptor => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("DevToolsStatus shape is assignable in both directions", () => {
    const fromHost = (x: HostDevToolsStatus): DevToolsStatus => x;
    const toHost = (x: DevToolsStatus): HostDevToolsStatus => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("CaptureListResult<NetworkEntry> is assignable in both directions", () => {
    const fromHost = (
      x: HostCaptureListResult<HostNetworkEntry>,
    ): CaptureListResult<NetworkEntry> => x;
    const toHost = (
      x: CaptureListResult<NetworkEntry>,
    ): HostCaptureListResult<HostNetworkEntry> => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("NetworkFilter shape is assignable in both directions", () => {
    const fromHost = (x: HostNetworkFilter): NetworkFilter => x;
    const toHost = (x: NetworkFilter): HostNetworkFilter => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });

  it("DevtoolsHostCapability method signatures match the host contract", () => {
    const fromHost = (
      x: HostDevtoolsHostCapability,
    ): DevtoolsHostCapability => x;
    const toHost = (
      x: DevtoolsHostCapability,
    ): HostDevtoolsHostCapability => x;
    expect(fromHost).toBeTypeOf("function");
    expect(toHost).toBeTypeOf("function");
  });
});
