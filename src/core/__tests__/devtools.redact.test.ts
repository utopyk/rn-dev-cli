import { describe, it, expect } from "vitest";
import {
  REDACTED_VALUE,
  redactHeaders,
  shouldRedactHeader,
} from "../devtools/redact.js";

describe("shouldRedactHeader", () => {
  it.each([
    ["Authorization"],
    ["authorization"],
    ["AUTHORIZATION"],
    ["Cookie"],
    ["Set-Cookie"],
    ["Proxy-Authorization"],
    ["X-Api-Key"],
    ["X-Auth-Token"],
    ["X-CSRF-Token"],
  ])("matches exact deny-list: %s", (name) => {
    expect(shouldRedactHeader(name)).toBe(true);
  });

  it.each([
    ["X-Session-Id"],
    ["x-session-token"],
    ["X-SESSION-FOO"],
  ])("matches X-Session-* prefix: %s", (name) => {
    expect(shouldRedactHeader(name)).toBe(true);
  });

  it.each([
    ["X-Access-Token"],
    ["secret-admin"],
    ["my-api-key"],
    ["reset-password"],
    ["X-CSRF-Secret"],
  ])("matches token/secret/key/password pattern: %s", (name) => {
    expect(shouldRedactHeader(name)).toBe(true);
  });

  it.each([
    ["Content-Type"],
    ["Accept"],
    ["User-Agent"],
    ["Host"],
    ["X-Custom-Header"],
    ["Cache-Control"],
  ])("does not match innocuous header: %s", (name) => {
    expect(shouldRedactHeader(name)).toBe(false);
  });
});

describe("redactHeaders", () => {
  it("replaces sensitive values but preserves names", () => {
    const input = {
      Authorization: "Bearer xyz",
      Cookie: "session=abc",
      "Content-Type": "application/json",
    };
    const out = redactHeaders(input);
    expect(out).toEqual({
      Authorization: REDACTED_VALUE,
      Cookie: REDACTED_VALUE,
      "Content-Type": "application/json",
    });
  });

  it("does not mutate input", () => {
    const input = { Authorization: "Bearer xyz" };
    const before = { ...input };
    redactHeaders(input);
    expect(input).toEqual(before);
  });

  it("handles empty headers", () => {
    expect(redactHeaders({})).toEqual({});
  });

  it("applies to every matching header independently", () => {
    const input = {
      Authorization: "Bearer A",
      "X-Session-Id": "S1",
      "X-Access-Token": "T1",
      Foo: "bar",
    };
    const out = redactHeaders(input);
    expect(out.Authorization).toBe(REDACTED_VALUE);
    expect(out["X-Session-Id"]).toBe(REDACTED_VALUE);
    expect(out["X-Access-Token"]).toBe(REDACTED_VALUE);
    expect(out.Foo).toBe("bar");
  });
});
