import { describe, it, expect } from "vitest";
import { parseAdbDevices, parseSimctlDevices } from "../device.js";

// ---------------------------------------------------------------------------
// parseAdbDevices
// ---------------------------------------------------------------------------

describe("parseAdbDevices", () => {
  it("parses normal output with device and unauthorized entries", () => {
    const output = [
      "List of devices attached",
      "emulator-5554\tdevice",
      "R58M31YXXXXX\tdevice",
      "ZX1G22BXXXXX\tunauthorized",
    ].join("\n");

    const devices = parseAdbDevices(output);

    expect(devices).toHaveLength(3);

    expect(devices[0]).toMatchObject({
      id: "emulator-5554",
      name: "emulator-5554",
      type: "android",
      status: "available",
    });

    expect(devices[1]).toMatchObject({
      id: "R58M31YXXXXX",
      name: "R58M31YXXXXX",
      type: "android",
      status: "available",
    });

    expect(devices[2]).toMatchObject({
      id: "ZX1G22BXXXXX",
      name: "ZX1G22BXXXXX",
      type: "android",
      status: "unauthorized",
    });
  });

  it("handles empty output (just header line)", () => {
    const output = "List of devices attached\n";
    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(0);
  });

  it("ignores lines that are not device entries", () => {
    const output = [
      "List of devices attached",
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "emulator-5554\tdevice",
    ].join("\n");

    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe("emulator-5554");
  });
});

// ---------------------------------------------------------------------------
// parseSimctlDevices
// ---------------------------------------------------------------------------

describe("parseSimctlDevices", () => {
  const sampleJson = JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
        {
          udid: "AAAAAAAA-0000-0000-0000-AAAAAAAAAAAA",
          name: "iPhone 15",
          state: "Booted",
          isAvailable: true,
        },
        {
          udid: "BBBBBBBB-0000-0000-0000-BBBBBBBBBBBB",
          name: "iPhone 15 Pro",
          state: "Shutdown",
          isAvailable: true,
        },
        {
          udid: "CCCCCCCC-0000-0000-0000-CCCCCCCCCCCC",
          name: "iPhone SE (3rd generation)",
          state: "Shutdown",
          isAvailable: false,
        },
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
        {
          udid: "DDDDDDDD-0000-0000-0000-DDDDDDDDDDDD",
          name: "iPhone 14",
          state: "Shutdown",
          isAvailable: true,
        },
      ],
      "com.apple.CoreSimulator.SimRuntime.watchOS-10-0": [
        {
          udid: "EEEEEEEE-0000-0000-0000-EEEEEEEEEEEE",
          name: "Apple Watch Series 9",
          state: "Shutdown",
          isAvailable: true,
        },
      ],
    },
  });

  it("filters out unavailable devices", () => {
    const devices = parseSimctlDevices(sampleJson);
    const ids = devices.map((d) => d.id);
    expect(ids).not.toContain("CCCCCCCC-0000-0000-0000-CCCCCCCCCCCC");
  });

  it("maps Booted state to status 'booted'", () => {
    const devices = parseSimctlDevices(sampleJson);
    const booted = devices.find(
      (d) => d.id === "AAAAAAAA-0000-0000-0000-AAAAAAAAAAAA"
    );
    expect(booted).toBeDefined();
    expect(booted!.status).toBe("booted");
    expect(booted!.type).toBe("ios");
  });

  it("maps Shutdown state to status 'shutdown'", () => {
    const devices = parseSimctlDevices(sampleJson);
    const shutdown = devices.find(
      (d) => d.id === "BBBBBBBB-0000-0000-0000-BBBBBBBBBBBB"
    );
    expect(shutdown).toBeDefined();
    expect(shutdown!.status).toBe("shutdown");
  });

  it("extracts runtime name by stripping the CoreSimulator prefix", () => {
    const devices = parseSimctlDevices(sampleJson);
    const device = devices.find(
      (d) => d.id === "AAAAAAAA-0000-0000-0000-AAAAAAAAAAAA"
    );
    expect(device!.runtime).toBe("iOS-17-2");
  });

  it("returns only iOS devices (skips watchOS, tvOS, etc.)", () => {
    // watchOS entry EEEEEEEE should not be included because its runtime key
    // does not start with iOS
    const devices = parseSimctlDevices(sampleJson);
    const watchDevice = devices.find(
      (d) => d.id === "EEEEEEEE-0000-0000-0000-EEEEEEEEEEEE"
    );
    expect(watchDevice).toBeUndefined();
  });

  it("parses JSON with multiple runtimes and returns all available iOS devices", () => {
    const devices = parseSimctlDevices(sampleJson);
    // Available iOS: iPhone 15 (booted), iPhone 15 Pro (shutdown), iPhone 14 (shutdown)
    // Filtered out: iPhone SE (isAvailable=false), Apple Watch (watchOS)
    expect(devices).toHaveLength(3);
  });

  it("handles an empty devices object", () => {
    const json = JSON.stringify({ devices: {} });
    const devices = parseSimctlDevices(json);
    expect(devices).toHaveLength(0);
  });
});
