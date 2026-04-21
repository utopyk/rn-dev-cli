/**
 * Header redaction — security control S1.
 *
 * Applied at capture time (not query time) to all three surfaces. The header
 * name is preserved so agents can still reason about auth/session shape;
 * only the value is replaced with `[REDACTED]`.
 *
 * Deny list:
 *   - Exact matches (case-insensitive): Authorization, Cookie, Set-Cookie,
 *     Proxy-Authorization, X-Api-Key, X-Auth-Token, X-CSRF-Token.
 *   - Prefix (case-insensitive): X-Session-*.
 *   - Regex (case-insensitive): any header name containing `token`, `secret`,
 *     `password`, or `key`.
 */

export const REDACTED_VALUE = "[REDACTED]";

const EXACT_DENYLIST: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

const PREFIX_DENYLIST: readonly string[] = ["x-session-"];

// Matches header names containing the given substrings (case-insensitive).
// `key` is broad by design — covers `x-api-key`, `x-access-key`, etc.
const PATTERN_DENYLIST = /(token|secret|password|key)/i;

/**
 * Returns true if the header name should be redacted.
 */
export function shouldRedactHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXACT_DENYLIST.has(lower)) return true;
  for (const prefix of PREFIX_DENYLIST) {
    if (lower.startsWith(prefix)) return true;
  }
  return PATTERN_DENYLIST.test(lower);
}

/**
 * Return a new headers object with sensitive values replaced by `[REDACTED]`.
 * Input is not mutated. Header names are preserved as-given.
 */
export function redactHeaders(
  headers: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = shouldRedactHeader(name) ? REDACTED_VALUE : value;
  }
  return out;
}
