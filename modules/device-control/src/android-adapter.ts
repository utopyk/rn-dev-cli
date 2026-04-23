// Android adapter — wraps the `adb` binary.
//
// Why not appium-adb? v0.1.0 aims for a tight install footprint + no
// native dependencies. Direct adb shelling covers the 80% surface
// (list, screencap, input tap/swipe/text, am start, logcat, install,
// uninstall). When we need framebuffer streaming, dump hierarchy, or
// grpc device control, swap in appium-adb + adbkit — the DeviceAdapter
// interface doesn't change.

import { execBinary, execBinaryText } from "./exec.js";
import type { Device, DeviceAdapter, ListOutcome } from "./adapter.js";

export interface AndroidAdapterOptions {
  /**
   * Inject a mock for `adb devices` / `adb shell` etc. Every adapter
   * method funnels through `runAdb` so the test harness only needs to
   * intercept this single entry point.
   */
  runAdb?: typeof runAdbDefault;
  /** Override the `adb` binary path. Useful for tests / wrapped toolchains. */
  adbBinary?: string;
}

export function createAndroidAdapter(
  options: AndroidAdapterOptions = {},
): DeviceAdapter {
  const runAdb = options.runAdb ?? runAdbDefault;
  const binary = options.adbBinary ?? "adb";

  async function adb(argv: readonly string[], timeoutMs?: number): Promise<string> {
    return runAdb(binary, argv, timeoutMs ? { timeoutMs } : undefined);
  }

  async function adbBuf(argv: readonly string[], timeoutMs?: number): Promise<Buffer> {
    const outcome = await execBinary(binary, argv, timeoutMs ? { timeoutMs } : undefined);
    if (outcome.kind === "ok") return outcome.stdout;
    if (outcome.kind === "not-found") {
      throw new Error(`${binary} is not installed or not on PATH`);
    }
    throw new Error(formatExecError(binary, outcome));
  }

  return {
    platform: "android",

    async list(): Promise<ListOutcome> {
      try {
        const raw = await adb(["devices", "-l"]);
        return { kind: "ok", devices: parseDevices(raw) };
      } catch (err) {
        return {
          kind: "unavailable",
          reason:
            err instanceof Error ? err.message : "adb devices failed",
        };
      }
    },

    async screenshot(udid) {
      // `adb exec-out screencap -p` streams the PNG bytes over the
      // exec-out channel without any newline remapping that plain
      // `adb shell screencap -p > file` path would apply on some
      // legacy shells.
      const png = await adbBuf(["-s", udid, "exec-out", "screencap", "-p"]);
      return { pngBase64: png.toString("base64") };
    },

    async tap(udid, x, y) {
      await adb([
        "-s",
        udid,
        "shell",
        "input",
        "tap",
        String(Math.round(x)),
        String(Math.round(y)),
      ]);
    },

    async swipe(udid, x1, y1, x2, y2, durationMs) {
      await adb([
        "-s",
        udid,
        "shell",
        "input",
        "swipe",
        String(Math.round(x1)),
        String(Math.round(y1)),
        String(Math.round(x2)),
        String(Math.round(y2)),
        String(Math.max(1, Math.round(durationMs))),
      ]);
    },

    async type(udid, text) {
      // `adb input text` treats spaces as field separators. %s is the
      // documented workaround — replace spaces with `%s` so the shell
      // hands a single argv entry to input.
      const escaped = text.replace(/ /g, "%s");
      await adb(["-s", udid, "shell", "input", "text", escaped]);
    },

    async launchApp(udid, appId) {
      await adb([
        "-s",
        udid,
        "shell",
        "monkey",
        "-p",
        appId,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ]);
    },

    async logsTail(udid, lines) {
      const raw = await adb(
        ["-s", udid, "logcat", "-d", "-t", String(lines)],
        30_000,
      );
      return { lines: raw.split("\n").filter((l) => l.length > 0) };
    },

    async installApp(udid, path) {
      await adb(["-s", udid, "install", "-r", path], 120_000);
    },

    async uninstallApp(udid, appId) {
      await adb(["-s", udid, "uninstall", appId]);
    },
  };
}

async function runAdbDefault(
  binary: string,
  argv: readonly string[],
  options?: { timeoutMs?: number },
): Promise<string> {
  return execBinaryText(binary, argv, options);
}

/**
 * Parse `adb devices -l` output. Format:
 *   List of devices attached
 *   emulator-5554  device product:sdk_gphone_x86 model:Pixel_6 device:emulator ...
 *   <serial>       <state> <key:value>...
 */
export function parseDevices(raw: string): Device[] {
  const lines = raw.split("\n").slice(1); // drop header
  const devices: Device[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const [udid, rawState, ...rest] = parts;
    if (!udid || !rawState) continue;
    const state = mapState(rawState);
    const kv = parseKeyValues(rest);
    devices.push({
      udid,
      name: kv["model"] ?? kv["device"] ?? udid,
      platform: "android",
      state,
    });
  }
  return devices;
}

function parseKeyValues(parts: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    out[key] = value;
  }
  return out;
}

function mapState(raw: string): Device["state"] {
  if (raw === "device") return "booted";
  if (raw === "offline" || raw === "unauthorized") return "unavailable";
  return "unknown";
}

function formatExecError(
  binary: string,
  err: Exclude<
    Awaited<ReturnType<typeof execBinary>>,
    { kind: "ok" }
  >,
): string {
  switch (err.kind) {
    case "non-zero":
      return `${binary} exited ${err.code ?? "null"}: ${err.stderr.trim() || "(no stderr)"}`;
    case "timeout":
      return `${binary} timed out after ${err.timeoutMs}ms`;
    case "oversize":
      return `${binary} stdout exceeded ${err.limitBytes} bytes`;
    case "not-found":
      return `${binary}: ${err.message}`;
  }
}
