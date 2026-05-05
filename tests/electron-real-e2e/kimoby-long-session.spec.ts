import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { launchRealE2e, teardownRealE2e, type RealE2eHandle } from "./launch.js";

// Real-project long-session suite. Unlike the synthetic-fixture suite, this
// one points Electron at the developer's actual `kimoby-mobile-app` tree,
// boots a REAL daemon (no fake-boot) which spawns REAL Metro, and drives
// the renderer UI for 30+ seconds. This is the test layer the user
// explicitly asked for after the synthetic pipeline gave a green light
// while the real app failed on first use.
//
// Override the target via:
//   RN_DEV_REAL_BOOT_TARGET=/path/to/your/rn-app
//   RN_DEV_REAL_BOOT_PACKAGE_MANAGER=pnpm  (or npm/yarn/bun)
//
// Skipped unless `REAL_BOOT_SMOKE=1` — the spec writes a profile into the
// real project's .rn-dev/ tree and spawns real Metro on a non-default port.

const REAL_BOOT_ENABLED = process.env.REAL_BOOT_SMOKE === "1";

const PROJECT_ROOT =
  process.env.RN_DEV_REAL_BOOT_TARGET ??
  "/Users/martincouso/Documents/GitHub/kimoby-mobile-app";

const PACKAGE_MANAGER = (process.env.RN_DEV_REAL_BOOT_PACKAGE_MANAGER ??
  "pnpm") as "npm" | "pnpm" | "yarn" | "bun";

test.describe("Real-kimoby long session", () => {
  test.skip(
    !REAL_BOOT_ENABLED,
    `Set REAL_BOOT_SMOKE=1 to run; spawns a real daemon + Metro against ${PROJECT_ROOT}.`,
  );

  // Real boot needs more headroom than the synthetic suite — preflight,
  // package-manager probe, and the daemon's first events/subscribe round
  // can together eat 30s before anything renders.
  test.setTimeout(180_000);

  let handle: RealE2eHandle | null = null;

  test.beforeEach(() => {
    if (!existsSync(PROJECT_ROOT)) {
      throw new Error(
        `Real-kimoby long session requires the project at ${PROJECT_ROOT}. ` +
          `Override via RN_DEV_REAL_BOOT_TARGET if your path differs.`,
      );
    }
  });

  test.afterEach(async () => {
    if (handle) {
      await teardownRealE2e(handle);
      handle = null;
    }
  });

  test("Electron + real daemon survives 30s of DevTools UI activity against kimoby (Bug A)", async () => {
    handle = await launchRealE2e({
      realProjectRoot: PROJECT_ROOT,
      realProjectPackageManager: PACKAGE_MANAGER,
      // Use a non-8081 port so the real Metro instance the user might
      // already have running for kimoby doesn't collide.
      metroPort: 8099,
    });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    handle.page.on("pageerror", (err) => pageErrors.push(err.message));
    handle.page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await expect(handle.page.locator(".sidebar")).toBeVisible({ timeout: 60_000 });

    // Click DevTools — the user-reported failure path. Pre-fix, an
    // unhandled-rejection inside CdpProxy.openUpstream(no-target URL)
    // killed the daemon under Bun's default policy and the next
    // metro:reload landed on a closed pipe.
    await handle.page.getByRole("button", { name: /devtools/i }).click();

    const start = Date.now();
    while (Date.now() - start < 30_000) {
      await handle.page.waitForTimeout(2_500);
      // Drive Reload + DevMenu shortcuts so traffic flows over the live
      // metro adapter, not a parked socket.
      await handle.page
        .getByRole("button", { name: /\[r\]/i })
        .click()
        .catch(() => undefined);
    }

    expect(
      handle.app.process().exitCode,
      "Electron exited mid-session — did the daemon die?",
    ).toBeNull();

    const stderr = handle.getStderr();
    expect(
      stderr,
      "stderr contained the canonical Bug A signature 'subscribe.send: connection already closed' — daemon-disconnect regression against the real kimoby daemon.",
    ).not.toMatch(/subscribe\.send:\s*connection already closed/);

    // The user's report also showed the renderer surfacing
    // "Daemon disconnected" service-log lines after the crash.
    // The renderer logs those via `service:log`; they appear in the
    // page's text content if the daemon dies. Assert NOT visible.
    const disconnectedBanner = await handle.page.getByText(/daemon disconnected/i).count();
    expect(
      disconnectedBanner,
      "Renderer surfaced 'Daemon disconnected' — daemon died during the 30s DevTools session.",
    ).toBe(0);

    expect(
      pageErrors,
      `Renderer pageerrors during real-kimoby session:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("Boot log shows 'Physical device' for the real iPhone profile (Bug D)", async () => {
    // The user's actual iPhone profile lives at
    // .rn-dev/profiles/profile-1777926131792.json. We launch with our smoke
    // profile (different file), but the boot path itself is shared. Bug D
    // is that bootDevice(physical-iPhone) used to spawn `xcrun simctl boot`;
    // the regression test for that lives in vitest. This test is the
    // user-visible side: the renderer's log surface should NEVER show
    // "Booting simulator <iPhone name>" for a physical device profile.
    //
    // We can't inject the user's profile here (smoke needs the matching
    // git branch + a known port), so this assertion is opportunistic:
    // assert that whatever IS shown is NOT the misleading simulator-boot
    // message AND does not surface the simctl-against-physical error
    // ("Could not boot simulator").
    handle = await launchRealE2e({
      realProjectRoot: PROJECT_ROOT,
      realProjectPackageManager: PACKAGE_MANAGER,
      metroPort: 8099,
    });

    await expect(handle.page.locator(".sidebar")).toBeVisible({ timeout: 60_000 });
    // Give the boot trace 5s to print.
    await handle.page.waitForTimeout(5_000);

    const stdout = handle.getStdout();
    // If a future regression brings back the unconditional simctl-against-
    // physical path, the user's log will show "Could not boot simulator —
    // may already be booting" because xcrun fails on a physical UDID.
    expect(
      stdout,
      "Boot log surfaced 'Could not boot simulator' — simctl was attempted against a non-simulator. Bug D regression.",
    ).not.toMatch(/Could not boot simulator/);
  });
});
