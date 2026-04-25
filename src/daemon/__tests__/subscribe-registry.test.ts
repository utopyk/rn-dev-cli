import { describe, it, expect } from "vitest";
import { SubscribeRegistry } from "../subscribe-registry.js";

describe("SubscribeRegistry", () => {
  it("records a bidirectional subscriber and reports it", () => {
    const reg = new SubscribeRegistry();
    reg.register("c1", { bidirectional: true, kindFilter: null });
    expect(reg.isBidirectional("c1")).toBe(true);
    expect(reg.has("c1")).toBe(true);
  });
});
