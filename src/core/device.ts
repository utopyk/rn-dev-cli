import { execAsync, execShellAsync } from "./exec-async.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Device {
  id: string;
  name: string;
  type: "ios" | "android";
  status: "available" | "booted" | "shutdown" | "unauthorized";
  runtime?: string; // iOS only, e.g. "iOS-17-2"
  isPhysical?: boolean; // true for real devices, false/undefined for simulators
}

// ---------------------------------------------------------------------------
// parseAdbDevices
// ---------------------------------------------------------------------------

/**
 * Parse the text output of `adb devices`.
 *
 * Expected format:
 *   List of devices attached
 *   <serial>\tdevice
 *   <serial>\tunauthorized
 */
export function parseAdbDevices(output: string): Device[] {
  const devices: Device[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    // Skip the header line and empty lines
    if (!trimmed || trimmed.startsWith("List of devices")) {
      continue;
    }

    // Each device line is:  <serial>\t<state>
    const tabIndex = trimmed.lastIndexOf("\t");
    if (tabIndex === -1) {
      continue;
    }

    const serial = trimmed.slice(0, tabIndex).trim();
    const state = trimmed.slice(tabIndex + 1).trim();

    if (state === "device") {
      devices.push({
        id: serial,
        name: serial,
        type: "android",
        status: "available",
      });
    } else if (state === "unauthorized") {
      devices.push({
        id: serial,
        name: serial,
        type: "android",
        status: "unauthorized",
      });
    }
    // Ignore offline, no permissions, etc.
  }

  return devices;
}

// ---------------------------------------------------------------------------
// parseSimctlDevices
// ---------------------------------------------------------------------------

const SIMRUNTIME_PREFIX = "com.apple.CoreSimulator.SimRuntime.";
const IOS_RUNTIME_RE = /^iOS-/i;

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

interface SimctlOutput {
  devices: Record<string, SimctlDevice[]>;
}

/**
 * Parse the JSON output of `xcrun simctl list devices --json`.
 *
 * - Skips devices where `isAvailable` is false.
 * - Only includes iOS simulators (runtime key starts with "iOS-" after
 *   stripping the CoreSimulator prefix).
 * - Maps state "Booted" → status "booted"; everything else → "shutdown".
 * - Attaches the short runtime name (e.g. "iOS-17-2") to each device.
 */
export function parseSimctlDevices(jsonOutput: string): Device[] {
  const parsed = JSON.parse(jsonOutput) as SimctlOutput;
  const devices: Device[] = [];

  for (const [runtimeKey, simulators] of Object.entries(parsed.devices)) {
    // Strip the CoreSimulator prefix to get e.g. "iOS-17-2" or "watchOS-10-0"
    const runtime = runtimeKey.startsWith(SIMRUNTIME_PREFIX)
      ? runtimeKey.slice(SIMRUNTIME_PREFIX.length)
      : runtimeKey;

    // Only include iOS simulators
    if (!IOS_RUNTIME_RE.test(runtime)) {
      continue;
    }

    for (const sim of simulators) {
      if (!sim.isAvailable) {
        continue;
      }

      devices.push({
        id: sim.udid,
        name: sim.name,
        type: "ios",
        status: sim.state === "Booted" ? "booted" : "shutdown",
        runtime,
      });
    }
  }

  return devices;
}

// ---------------------------------------------------------------------------
// listDevices
// ---------------------------------------------------------------------------

/**
 * Discover connected/available devices by calling the real platform tools.
 * Catches errors gracefully if `adb` or `xcrun` are not installed.
 */
export async function listDevices(platform: "ios" | "android" | "both"): Promise<Device[]> {
  const devices: Device[] = [];

  if (platform === "android" || platform === "both") {
    try {
      const output = await execAsync("adb devices", {
        timeout: 15000, // 15s max
      });
      devices.push(...parseAdbDevices(output));
    } catch {
      // adb not available, timed out, or failed
    }
  }

  if (platform === "ios" || platform === "both") {
    // Physical devices via xctrace
    try {
      const output = await execAsync("xcrun xctrace list devices", {
        timeout: 15000,
      });
      devices.push(...parseXctraceDevices(output));
    } catch {
      // xctrace not available
    }

    // Simulators via simctl
    try {
      const output = await execAsync("xcrun simctl list devices --json", {
        timeout: 30000,
      });
      devices.push(...parseSimctlDevices(output));
    } catch {
      // xcrun not available, timed out, or failed
    }
  }

  return devices;
}

// ---------------------------------------------------------------------------
// parseXctraceDevices — physical iOS devices from `xcrun xctrace list devices`
// ---------------------------------------------------------------------------

/**
 * Parse output of `xcrun xctrace list devices` to find physical iOS devices.
 * Format: "Device Name (OS Version) (UDID)"
 */
export function parseXctraceDevices(output: string): Device[] {
  const devices: Device[] = [];
  const lines = output.split("\n");
  let inDevicesSection = false;
  let inOfflineSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "== Devices ==") {
      inDevicesSection = true;
      inOfflineSection = false;
      continue;
    }
    if (trimmed === "== Devices Offline ==") {
      inDevicesSection = false;
      inOfflineSection = true;
      continue;
    }
    if (trimmed === "== Simulators ==") {
      // Stop — we get simulators from simctl instead
      break;
    }

    if (!inDevicesSection && !inOfflineSection) continue;
    if (!trimmed) continue;

    // Match: "Device Name (OS Version) (UDID)"
    const match = trimmed.match(/^(.+?)\s+\(([^)]+)\)\s+\(([0-9A-Fa-f-]+)\)$/);
    if (match) {
      const [, name, version, udid] = match;
      // Skip Macs and Apple Watches
      if (name.includes("MacBook") || name.includes("Mac ") || name.includes("Apple Watch")) continue;

      devices.push({
        id: udid,
        name: name.trim(),
        type: "ios",
        status: inOfflineSection ? "shutdown" : "available",
        runtime: `iOS-${version.replace(/\./g, "-")}`,
        isPhysical: true,
      });
    }
  }

  return devices;
}

// ---------------------------------------------------------------------------
// bootDevice
// ---------------------------------------------------------------------------

/**
 * Boot an iOS simulator. Returns true on success, false on failure.
 * Currently only iOS simulators are supported.
 */
export async function bootDevice(device: Device): Promise<boolean> {
  if (device.type !== "ios") {
    return false;
  }

  try {
    await execShellAsync(`xcrun simctl boot ${device.id}`, {
      timeout: 30000,
    });
    return true;
  } catch {
    return false;
  }
}
