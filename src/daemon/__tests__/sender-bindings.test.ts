import { describe, expect, it } from "vitest";
import { SenderBindings } from "../sender-bindings.js";

describe("SenderBindings (unit)", () => {
  it("denies by default — unbound (connId, moduleId) pairs return false", () => {
    const sb = new SenderBindings();
    expect(sb.canCall("c1", "modA")).toBe(false);
  });

  it("bind() then canCall() returns true", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    expect(sb.canCall("c1", "modA")).toBe(true);
  });

  it("bindings are scoped to (connectionId, moduleId) — neither dimension leaks", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    expect(sb.canCall("c1", "modB")).toBe(false); // same conn, different module
    expect(sb.canCall("c2", "modA")).toBe(false); // different conn, same module
  });

  it("bind() is idempotent on the same (connId, moduleId)", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    sb.bind("c1", "modA");
    sb.bind("c1", "modA");
    expect(sb.size()).toBe(1);
    expect(sb.canCall("c1", "modA")).toBe(true);
  });

  it("a single conn can bind multiple modules", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    sb.bind("c1", "modB");
    sb.bind("c1", "modC");
    expect(sb.canCall("c1", "modA")).toBe(true);
    expect(sb.canCall("c1", "modB")).toBe(true);
    expect(sb.canCall("c1", "modC")).toBe(true);
    expect(sb.boundModules("c1").size).toBe(3);
  });

  it("clearConnection drops every binding the conn held", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    sb.bind("c1", "modB");
    sb.bind("c2", "modA");

    sb.clearConnection("c1");

    expect(sb.canCall("c1", "modA")).toBe(false);
    expect(sb.canCall("c1", "modB")).toBe(false);
    // c2's binding is unaffected.
    expect(sb.canCall("c2", "modA")).toBe(true);
  });

  it("clearConnection on an unknown id is a no-op", () => {
    const sb = new SenderBindings();
    sb.bind("c1", "modA");
    expect(() => sb.clearConnection("c-ghost")).not.toThrow();
    expect(sb.canCall("c1", "modA")).toBe(true);
  });

  it("size() reflects total bindings across all connections", () => {
    const sb = new SenderBindings();
    expect(sb.size()).toBe(0);
    sb.bind("c1", "modA");
    expect(sb.size()).toBe(1);
    sb.bind("c1", "modB");
    expect(sb.size()).toBe(2);
    sb.bind("c2", "modA");
    expect(sb.size()).toBe(3);
    sb.clearConnection("c1");
    expect(sb.size()).toBe(1);
  });
});
