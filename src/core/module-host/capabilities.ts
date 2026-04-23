// Generic host-side capability registry. Built-ins and 3p modules both
// register into this — the SDK's `host.capability<T>(id)` is a thin proxy
// over `resolve()` with the calling module's granted permissions bound in.
//
// Phase 1 decision: exact-match permission strings only. No globs. Keeps
// the permission surface small enough to audit at install-consent time.

export interface RegisterOptions {
  requiredPermission?: string;
  /**
   * Phase 10 P2-7 — optional per-method permission overrides. Layered on
   * top of `requiredPermission`: the capability-level permission is the
   * baseline gate for `resolve()` (you need the baseline to see the
   * impl at all), and each method can demand a stricter permission
   * checked by `resolveMethod()`. Used by the devtools capability to
   * split read-only (list/get/status) from mutating (clear/selectTarget)
   * methods — a module with read-only grants can't drop the worktree's
   * capture buffer.
   */
  methodPermissions?: Readonly<Record<string, string>>;
  /**
   * Opt-in override for reserved id enforcement. Only `startFlow` /
   * `startRealServices` use this when wiring the host's own `"log"` /
   * `"appInfo"` implementations; every other caller (3p + built-in
   * capabilities) must pick a non-reserved id.
   */
  allowReserved?: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  requiredPermission?: string;
  methodPermissions?: Readonly<Record<string, string>>;
}

interface StoredCapability<T = unknown> {
  id: string;
  impl: T;
  requiredPermission?: string;
  methodPermissions?: Readonly<Record<string, string>>;
}

/**
 * Security F6 — reserved capability ids. The SDK synthesizes
 * `host.capability("log")` / `host.capability("appInfo")` client-side
 * without a round-trip (see packages/module-sdk/src/module-runtime.ts);
 * registering another impl under these ids would be silently shadowed for
 * in-process callers and surprise-confused for RPC callers. Guard at
 * `register()` time rather than hope nobody makes the mistake.
 */
export const RESERVED_CAPABILITY_IDS: ReadonlyArray<string> = [
  "log",
  "appInfo",
];

export class CapabilityRegistry {
  private readonly entries = new Map<string, StoredCapability>();

  register<T>(id: string, impl: T, options: RegisterOptions = {}): void {
    if (this.entries.has(id)) {
      throw new Error(`Capability "${id}" is already registered.`);
    }
    if (!options.allowReserved && RESERVED_CAPABILITY_IDS.includes(id)) {
      throw new Error(
        `Capability id "${id}" is reserved (SDK synthesizes it client-side); pass { allowReserved: true } only from host startup.`,
      );
    }
    this.entries.set(id, {
      id,
      impl,
      requiredPermission: options.requiredPermission,
      ...(options.methodPermissions !== undefined
        ? { methodPermissions: options.methodPermissions }
        : {}),
    });
  }

  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  resolve<T>(id: string, grantedPermissions: readonly string[]): T | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (
      entry.requiredPermission &&
      !grantedPermissions.includes(entry.requiredPermission)
    ) {
      return null;
    }
    return entry.impl as T;
  }

  /**
   * Phase 10 P2-7 — second-level permission check. Callers that already
   * `resolve()`'d a capability (baseline permission granted) can use this
   * to gate individual methods on stricter permissions. Returns the
   * stricter permission required for `method` (or undefined if the method
   * has no override). The RPC layer uses this to reject calls like
   * `devtools.clear()` from a read-only-permissioned module.
   */
  requiredPermissionForMethod(id: string, method: string): string | undefined {
    return this.entries.get(id)?.methodPermissions?.[method];
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  describe(id: string): CapabilityDescriptor | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      ...(entry.requiredPermission !== undefined
        ? { requiredPermission: entry.requiredPermission }
        : {}),
      ...(entry.methodPermissions !== undefined
        ? { methodPermissions: entry.methodPermissions }
        : {}),
    };
  }

  describeAll(): CapabilityDescriptor[] {
    return [...this.entries.values()].map((e) => ({
      id: e.id,
      ...(e.requiredPermission !== undefined
        ? { requiredPermission: e.requiredPermission }
        : {}),
      ...(e.methodPermissions !== undefined
        ? { methodPermissions: e.methodPermissions }
        : {}),
    }));
  }
}
