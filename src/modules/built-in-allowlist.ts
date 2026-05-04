// Compiled-in allowlist of module IDs permitted to declare
// `kind: "built-in-privileged"`. A 3p manifest that smuggles `kind` past
// schema validation, or any code path that calls `registerBuiltIn` with
// an unknown id, must be rejected here — built-in-privileged modules run
// in-process inside the daemon and are exempt from the
// `<moduleId>__<tool>` prefix policy. Without this gate, any 3p
// installation could escalate from subprocess isolation to in-process.
//
// New built-ins land here as an explicit code change reviewable in PR.
// H1 adds `session`; H2 wraps Builder and adds `build`; H3 adds
// `clean`, `metro`, `devtools-core`, `preflight`. Keep this list in
// lockstep with the modules that actually exist on disk under
// `src/modules/built-in/manifests.ts` — the asserter does NOT cross-check.

import { ModuleError, ModuleErrorCode } from "@rn-dev/module-sdk";

/**
 * IDs permitted to be `kind: "built-in-privileged"`. Compile-time
 * constant — modifications require a code review and a host release.
 *
 * Pre-H1 built-ins (`dev-space`, `lint-test`, `settings`, `marketplace`)
 * are codified here from `src/modules/built-in/manifests.ts` and
 * `src/modules/built-in/marketplace.ts`. `session` is new in H1.
 */
const PRODUCTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "dev-space",
  "lint-test",
  "settings",
  "marketplace",
  "session",
]);

/**
 * Test-only extensions added via `__addBuiltInAllowedForTests`. Cleared
 * by `__resetBuiltInAllowlistForTests`. Production code paths never
 * touch this set; the seam exists so vitest can register synthetic
 * fixture ids without weakening the production gate.
 */
const testExtensions: Set<string> = new Set();

/**
 * Public read-only view of the production allowlist. Tests should NOT
 * read this directly — `isBuiltInAllowed` consults both prod and test
 * extensions and is what `registerBuiltIn` uses internally.
 */
export const BUILT_IN_MODULE_ALLOWLIST: ReadonlySet<string> = PRODUCTION_ALLOWLIST;

/**
 * Throw `E_INVALID_MANIFEST` if `id` is not on the allowlist. Called by
 * `ModuleRegistry.registerBuiltIn`. Callers MUST handle the throw —
 * built-in registration is a programmer-controlled path and a rejection
 * here is a configuration bug, not runtime state.
 */
export function assertBuiltInAllowed(id: string): void {
  if (isBuiltInAllowed(id)) return;
  throw new ModuleError(
    ModuleErrorCode.E_INVALID_MANIFEST,
    `Module "${id}" is not in the built-in-privileged allowlist. ` +
      `Only host-shipped modules may declare kind: "built-in-privileged"; ` +
      `add the id to src/modules/built-in-allowlist.ts to permit it.`,
    { id },
  );
}

/** Predicate form. Honors both the production list and active test extensions. */
export function isBuiltInAllowed(id: string): boolean {
  return PRODUCTION_ALLOWLIST.has(id) || testExtensions.has(id);
}

/**
 * Test seam — temporarily permit a synthetic id to be registered as
 * built-in-privileged. Pair with `__resetBuiltInAllowlistForTests` in a
 * test-suite teardown so extensions don't leak between tests.
 */
export function __addBuiltInAllowedForTests(id: string): void {
  testExtensions.add(id);
}

/** Test seam — drop all extensions added by `__addBuiltInAllowedForTests`. */
export function __resetBuiltInAllowlistForTests(): void {
  testExtensions.clear();
}
