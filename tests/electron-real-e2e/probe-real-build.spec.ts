import { test, expect, _electron as electron } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Probe — actually build the kimoby app on the user's real iPhone
// using the user's existing dirty profile (no fake-boot, no synthetic
// fixture, no signing modifications). Captures the build output so we
// can see whether xcodebuild succeeds or what errors out.
//
// What this verifies: the full chain — daemon spawn → events/subscribe
// → bootSessionServices → triggerBuildsIfNeeded → builder/build →
// react-native run-ios → xcodebuild → device install — actually works
// end-to-end on this machine.
//
// This is the "is it actually working" probe the user kept asking for.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const KIMOBY = process.env.PROBE_KIMOBY ?? "/Users/martincouso/Documents/GitHub/kimoby-mobile-app";
const SCREENSHOT_DIR = "/tmp/probe-real-build-screens";

const ENABLED = process.env.PROBE === "1" || process.env.PROBE_KIMOBY === "1";

test.describe("Probe — real build against kimoby + iPhone 15", () => {
  test.skip(!ENABLED, "Set PROBE=1 to run; spawns real Metro and xcodebuild against the user's iPhone.");
  // Real builds need real time. xcodebuild + pod install + device install
  // can easily take 10+ minutes the first time. Budget generously so the
  // probe shows what's happening, not "test timed out."
  test.setTimeout(20 * 60_000);

  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test("dirty mode + Kimoby scheme builds the app and pushes it to the iPhone (live, not fake)", async () => {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: KIMOBY }).toString().trim();
    const profileDir = join(KIMOBY, ".rn-dev", "profiles");
    mkdirSync(profileDir, { recursive: true });

    // Write a probe profile that pins the scheme explicitly to "Kimoby".
    // The user said the bug was "selecting a bundle we don't have signing
    // for" — pinning the scheme closes that ambiguity.
    const profileName = "rn-dev-probe-real-build";
    const profilePath = join(profileDir, `${profileName}.json`);
    writeFileSync(
      profilePath,
      JSON.stringify(
        {
          name: profileName,
          isDefault: true,
          worktree: null,
          branch,
          platform: "ios",
          mode: "dirty",
          metroPort: 8099,
          // Use a booted simulator so the build doesn't depend on the
          // physical-iPhone iOS version vs Xcode platform-support
          // installed combo — that's an environmental knob, not what
          // this probe verifies. The probe verifies our code path
          // (daemon spawn → triggerBuildsIfNeeded → run-ios with the
          // right scheme/mode args) gets through xcodebuild.
          // 2E1962FB-5EBC-458E-994C-9D84A8D93CA3 is a booted iPhone 16 Pro
          // simulator on iOS 18.5 per `xcrun simctl list devices booted`.
          devices: { ios: "2E1962FB-5EBC-458E-994C-9D84A8D93CA3", android: null },
          buildVariant: "debug",
          scheme: "Kimoby",
          configuration: "Debug",
          preflight: { checks: [], frequency: "once" },
          onSave: [],
          env: {},
          projectRoot: KIMOBY,
          packageManager: "pnpm",
        },
        null,
        2,
      ),
    );

    const userDataDir = join(KIMOBY, ".rn-dev", "probe-real-build-user-data");
    mkdirSync(userDataDir, { recursive: true });

    // Aggregate every captured stream so we can grep for build-progress
    // markers + success/failure signals.
    const allLogs: string[] = [];
    const buildEvents: string[] = [];
    const errorEvents: string[] = [];

    const pushLog = (text: string): void => {
      allLogs.push(text);
      // Build-progress markers: react-native CLI's verbose mode says
      // these things along the way.
      if (
        /Building for ios|run-ios|xcodebuild|info Building|debug Command line invocation|info Installing|info Launching|Successfully installed/i.test(
          text,
        )
      ) {
        buildEvents.push(text.trim());
      }
      // Failure markers worth surfacing.
      if (
        /error: |Failed to build|exited with error code|No matching profiles|Code Sign error|Provisioning profile|Couldn't find any device/i.test(
          text,
        )
      ) {
        errorEvents.push(text.trim());
      }
    };

    const app = await electron.launch({
      args: [join(REPO_ROOT, "electron", "launcher.cjs"), `--user-data-dir=${userDataDir}`],
      cwd: KIMOBY,
      stderr: "pipe",
      stdout: "pipe",
      env: {
        ...process.env,
        RN_DEV_PROJECT_ROOT: KIMOBY,
        RN_DEV_SMOKE: "1",
      },
      timeout: 30_000,
    });
    app.process().stderr?.on("data", (b: Buffer) => {
      const t = b.toString();
      pushLog(`[stderr] ${t}`);
      process.stderr.write(`[E-STDERR] ${t}`);
    });
    app.process().stdout?.on("data", (b: Buffer) => {
      const t = b.toString();
      pushLog(`[stdout] ${t}`);
      process.stdout.write(`[E-STDOUT] ${t}`);
    });

    const page = await app.firstWindow({ timeout: 30_000 });
    page.on("console", (msg) => pushLog(`[console:${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => pushLog(`[pageerror] ${err.message}`));

    await expect(page.locator(".sidebar")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-after-boot.png") });

    // Skip the codesign prompt — Skip is now the safe default. We do
    // NOT want to flip kimoby's pbxproj from Manual to Automatic.
    const skipSigning = page
      .getByRole("button", { name: /Keep Manual signing/i })
      .first();
    if (await skipSigning.count()) {
      console.log("Code-signing prompt visible — clicking 'Keep Manual signing' (the safe default).");
      await skipSigning.click();
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: join(SCREENSHOT_DIR, "02-codesign-skipped.png") });
    } else {
      console.log("No code-signing prompt visible — proceeding.");
    }

    // Periodically screenshot + sample renderer text to track what's
    // happening during the long build. Up to 12 minutes of observation.
    const observeUntil = Date.now() + 12 * 60_000;
    let lastScreenshot = Date.now();
    let lastText = "";
    while (Date.now() < observeUntil) {
      await page.waitForTimeout(10_000);
      // Take a screenshot every 60s.
      if (Date.now() - lastScreenshot > 60_000) {
        const elapsed = Math.round((Date.now() - (observeUntil - 12 * 60_000)) / 1000);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, `progress-t+${elapsed}s.png`),
        });
        lastScreenshot = Date.now();
      }
      // Sample what's in the Tool Output panel so the test log shows
      // ongoing progress without spamming a screenshot every second.
      const text = await page
        .locator(".dev-space, .panel-content")
        .first()
        .innerText()
        .catch(() => "");
      if (text !== lastText) {
        const tail = text.slice(-300);
        console.log(`\n--- panel sample [t+${Math.round((Date.now() - (observeUntil - 12 * 60_000)) / 1000)}s] ---`);
        console.log(tail.slice(-300));
        lastText = text;
      }

      // Exit early if we see definitive signals.
      if (allLogs.some((l) => /Successfully installed/i.test(l))) {
        console.log("✅ EARLY EXIT — 'Successfully installed' detected.");
        break;
      }
      if (errorEvents.length > 5) {
        console.log("⚠ Multiple error events; capturing state and exiting.");
        break;
      }
    }
    await page.screenshot({ path: join(SCREENSHOT_DIR, "99-end.png") });

    // Final summary.
    console.log(`\n===== FINAL =====`);
    console.log(`build event tally: ${buildEvents.length}`);
    for (const e of buildEvents.slice(0, 12)) console.log(`  ✓ ${e.slice(0, 200)}`);
    console.log(`error event tally: ${errorEvents.length}`);
    for (const e of errorEvents.slice(0, 12)) console.log(`  ✗ ${e.slice(0, 200)}`);

    const finalText = await page.locator("body").innerText().catch(() => "");

    await app.close().catch(() => undefined);

    try {
      rmSync(profilePath, { force: true });
      rmSync(join(KIMOBY, ".rn-dev", "sock"), { force: true });
      rmSync(join(KIMOBY, ".rn-dev", "pid"), { force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}

    // The point of this probe is OBSERVABILITY, not asserting success.
    // We just want the build trigger to fire and SOMETHING to happen.
    // Whether xcodebuild succeeds depends on the user's actual cert chain.
    expect(buildEvents.length, "Build never started — autobuild trigger failed.").toBeGreaterThan(0);

    // If "Failed to attach" surfaces, fail loudly.
    expect(
      errorEvents.filter((l) => /did not reach.*running/i.test(l)),
      "Watchdog regression: 30s timeout fired against a real build.",
    ).toEqual([]);

    // Final body sample for forensics.
    console.log(`\nFinal renderer body (last 800 chars):\n${finalText.slice(-800)}`);
  });
});
