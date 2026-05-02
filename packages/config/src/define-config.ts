import AjvDefault, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { HookError, HookErrorCode } from "@rn-dev/module-sdk";
import schema from "../config.schema.json" with { type: "json" };
import type {
  HookEntry,
  HookPhase,
  HookSlotsOf,
  RnDevConfig,
} from "./types.js";
import type { ModuleManifest } from "@rn-dev/module-sdk";

// ---------------------------------------------------------------------------
// Ajv setup — mirrors @rn-dev/module-sdk's interop pattern.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvAny = AjvDefault as any;
const AjvCtor = (AjvAny?.default ?? AjvAny) as new (
  opts?: { allErrors?: boolean; strict?: boolean }
) => { compile<T>(schema: unknown): ValidateFunction<T> };
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validator: ValidateFunction<RnDevConfig> =
  ajv.compile<RnDevConfig>(schema);

// ---------------------------------------------------------------------------
// defineConfig — typed identity helper
// ---------------------------------------------------------------------------
//
// Generic over a `BuiltInModules` const-tuple. With `M = readonly []` the
// `hooks` keys narrow to `never`, which means the project still gets an
// `unknown`-shaped fallback (`HookPhase`) for typing — H2/H3 phases will
// flow real built-in manifests in via the daemon's host bundle so the
// keys narrow to `'build/pre' | 'clean/pre' | …` automatically.
//
// At runtime this is identity. Daemon revalidates at session boot using
// the same JSON schema, so call-site validation would be redundant noise
// per the package's "zero-runtime + tree-shakeable" design goal.

export interface DefineConfigInput<
  M extends readonly ModuleManifest[] = readonly [],
> {
  hooks?: [HookSlotsOf<M[number]>] extends [never]
    ? Partial<Record<HookPhase, HookEntry>>
    : Partial<Record<HookSlotsOf<M[number]>, HookEntry>>;
  allowModuleOverrides?: string[];
  allowModuleHardFails?: string[];
}

export function defineConfig<
  const M extends readonly ModuleManifest[] = readonly [],
>(config: DefineConfigInput<M>): DefineConfigInput<M> {
  return config;
}

// ---------------------------------------------------------------------------
// validateConfig — shape-only runtime check
// ---------------------------------------------------------------------------

export interface ConfigValidationError {
  /** JSON Pointer into the candidate (e.g. `/hooks/build~1pre`). */
  path: string;
  message: string;
  keyword: string;
}

export type ValidateConfigResult =
  | { valid: true; config: RnDevConfig }
  | { valid: false; errors: ConfigValidationError[] };

/**
 * Validates a candidate against `config.schema.json`. Function-form hook
 * entries are accepted at the type level but the JSON schema only sees
 * the `fn` key existing — the daemon does the deeper "is this callable"
 * check at load time.
 */
export function validateConfig(candidate: unknown): ValidateConfigResult {
  // The schema can't see function values; replace fn callables with a
  // sentinel object so ajv's `oneOf` matches the fn branch by key
  // presence rather than choking on `typeof === 'function'` JSON-wise.
  const probe = stripFunctions(candidate);
  if (validator(probe)) {
    return { valid: true, config: candidate as RnDevConfig };
  }
  return {
    valid: false,
    errors: (validator.errors ?? []).map(formatError),
  };
}

function stripFunctions(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripFunctions);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = typeof v === "function" ? "<fn>" : stripFunctions(v);
  }
  return out;
}

function formatError(err: ErrorObject): ConfigValidationError {
  return {
    path: err.instancePath || "/",
    message: err.message ?? "invalid",
    keyword: err.keyword,
  };
}

// ---------------------------------------------------------------------------
// loadConfig — orchestrates dynamic-import + shape validation
// ---------------------------------------------------------------------------
//
// Maps every failure mode to `HookErrorCode.E_HOOK_CONFIG_INVALID` with the
// appropriate `cause` discriminator so MCP clients can render specific
// guidance per cause. Used by the daemon at session boot AND by the
// `rn-dev config validate` CLI.

export interface LoadConfigOptions {
  /** Wall-clock cap on the dynamic import. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export async function loadConfig(
  filePath: string,
  options: LoadConfigOptions = {},
): Promise<RnDevConfig> {
  const timeoutMs = options.timeoutMs ?? 5_000;

  let module_: { default?: unknown };
  try {
    module_ = await Promise.race([
      import(/* @vite-ignore */ filePath) as Promise<{ default?: unknown }>,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new HookError(
                `Loading config at ${filePath} exceeded ${timeoutMs}ms.`,
                {
                  code: HookErrorCode.E_HOOK_CONFIG_INVALID,
                  cause: "config-load-timeout",
                  configPath: filePath,
                },
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
  } catch (err) {
    if (err instanceof HookError) throw err;
    if (isParseError(err)) {
      throw new HookError(
        `Failed to parse ${filePath}: ${(err as Error).message}`,
        {
          code: HookErrorCode.E_HOOK_CONFIG_INVALID,
          cause: "parse-failed",
          configPath: filePath,
        },
      );
    }
    throw new HookError(
      `Config module ${filePath} threw during evaluation: ${(err as Error).message ?? String(err)}`,
      {
        code: HookErrorCode.E_HOOK_CONFIG_INVALID,
        cause: "threw",
        configPath: filePath,
      },
    );
  }

  const candidate = module_.default;
  const result = validateConfig(candidate);
  if (!result.valid) {
    const summary = result.errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join("\n");
    throw new HookError(
      `Invalid rn-dev config at ${filePath}:\n${summary}`,
      {
        code: HookErrorCode.E_HOOK_CONFIG_INVALID,
        cause: "shape-invalid",
        configPath: filePath,
      },
    );
  }
  return result.config;
}

function isParseError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    constructor?: { name?: unknown };
  };
  if (e.name === "SyntaxError") return true;
  if (e.constructor?.name === "SyntaxError") return true;
  if (typeof e.code === "string" && e.code === "ERR_PARSE_ERROR") return true;
  if (typeof e.message !== "string") return false;
  if (/Unexpected (token|identifier|end of|reserved)/i.test(e.message)) {
    return true;
  }
  // Vite's import-analysis wrapper used by vitest. Production daemon imports
  // bypass this (plain Node ESM loader), so the wrapper text is the only
  // signal we have when the SyntaxError class identity is lost.
  if (
    /Failed to parse source for import analysis|invalid JS syntax/i.test(
      e.message,
    )
  ) {
    return true;
  }
  return false;
}
