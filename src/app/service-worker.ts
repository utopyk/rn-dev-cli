/**
 * Service startup worker — runs in a separate thread so execSync calls
 * don't block the main thread's renderer.
 *
 * Receives: { profile, projectRoot, artifactsDir }
 * Sends back: { type: "log", text } | { type: "done", result } | { type: "error", message }
 */

import path from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { ArtifactStore } from "../core/artifact.js";
import { MetroManager } from "../core/metro.js";
import { CleanManager } from "../core/clean.js";
import { FileWatcher } from "../core/watcher.js";
import type { Profile } from "../core/types.js";

declare var self: Worker;

self.onmessage = async (event: MessageEvent) => {
  const { profile, projectRoot, artifactsDir } = event.data as {
    profile: Profile;
    projectRoot: string;
    artifactsDir: string;
  };

  const artifactStore = new ArtifactStore(artifactsDir);
  const emit = (text: string) => self.postMessage({ type: "log", text });

  try {
    // Preflights
    if (profile.preflight.checks.length > 0) {
      const artifact = artifactStore.load(
        artifactStore.worktreeHash(profile.worktree)
      );
      const needsPreflight =
        profile.preflight.frequency === "always" || !artifact?.preflightPassed;

      if (needsPreflight) {
        emit("⏳ Running preflight checks...");
        const { createDefaultPreflightEngine } = await import(
          "../core/preflight.js"
        );
        const engine = createDefaultPreflightEngine(projectRoot);
        const results = await engine.runAll(profile.platform, profile.preflight);

        let hasErrors = false;
        for (const [id, result] of results) {
          const icon = result.passed ? "✔" : "✖";
          emit(`  ${icon} ${id}: ${result.message}`);
          if (!result.passed) hasErrors = true;
        }

        if (hasErrors) {
          emit("  ⚠ Some preflight checks failed. Continuing anyway...");
        } else {
          emit("  ✔ All preflight checks passed");
        }
        emit("");

        const worktreeKey = artifactStore.worktreeHash(profile.worktree);
        artifactStore.save(worktreeKey, { preflightPassed: !hasErrors });
      }
    }

    // Check node_modules — auto-install if missing
    const effectiveRoot = profile.worktree ?? projectRoot;
    if (!existsSync(path.join(effectiveRoot, "node_modules"))) {
      emit("⚠ node_modules not found — auto-installing dependencies...");

      // Detect package manager: package-lock.json → npm, bun.lock → bun, yarn.lock (alone) → yarn
      const hasPackageLock = existsSync(path.join(effectiveRoot, "package-lock.json"));
      const hasBunLock = existsSync(path.join(effectiveRoot, "bun.lock")) || existsSync(path.join(effectiveRoot, "bun.lockb"));
      const hasYarnLock = existsSync(path.join(effectiveRoot, "yarn.lock"));
      const installCmd = hasPackageLock ? "npm install" : hasBunLock ? "bun install" : hasYarnLock ? "yarn install" : "npm install";

      emit(`  ⏳ ${installCmd}...`);
      try {
        execSync(installCmd, {
          cwd: effectiveRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 300000,
        });
        emit("  ✔ Dependencies installed");
      } catch (err: any) {
        emit(`  ✖ Install failed: ${(err.message ?? "").slice(0, 120)}`);
        emit("  ⚠ Build will likely fail without node_modules");
      }
      emit("");

      // Install pods if iOS and Podfile exists
      if (profile.platform === "ios" || profile.platform === "both") {
        const podfilePath = path.join(effectiveRoot, "ios", "Podfile");
        if (existsSync(podfilePath)) {
          emit("  ⏳ pod install...");
          try {
            execSync("pod install", {
              cwd: path.join(effectiveRoot, "ios"),
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 300000,
            });
            emit("  ✔ Pods installed");
          } catch {
            emit("  ⚠ pod install failed");
          }
          emit("");
        }
      }
    }

    // Clean
    if (profile.mode !== "dirty") {
      const cleaner = new CleanManager(projectRoot);
      emit(`⏳ Running ${profile.mode} clean...`);
      await cleaner.execute(profile.mode, profile.platform, (step, status) => {
        const icon = status === "done" ? "✔" : status === "skip" ? "ℹ" : "⚠";
        emit(`  ${icon} ${step}`);
      });
      emit("");
    }

    // Watchman reset
    try {
      const effectiveRoot = profile.worktree ?? projectRoot;
      execSync(`watchman watch-del '${effectiveRoot}'`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      emit("✔ Watchman watch cleared for project");
    } catch {
      // Fine if watchman isn't installed
    }

    // Metro port check
    const metro = new MetroManager(artifactStore);
    const worktreeKey = artifactStore.worktreeHash(profile.worktree);
    const port = profile.metroPort;

    const portFree = await metro.isPortFree(port);
    if (!portFree) {
      emit(`⚠ Port ${port} is in use. Killing stale process...`);
      const killed = await metro.killProcessOnPort(port);
      if (killed) {
        emit(`  ✔ Killed process on port ${port}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        emit(`  ✖ Could not kill process on port ${port}. Trying anyway...`);
      }
    }

    // Boot simulator if needed
    if (profile.platform === "ios" || profile.platform === "both") {
      const deviceId = profile.devices?.ios;
      if (deviceId) {
        const { listDevices: listDev, bootDevice } = await import("../core/device.js");
        const devices = listDev("ios");
        const device = devices.find((d) => d.id === deviceId);
        if (device && device.status === "shutdown") {
          emit(`⏳ Booting simulator ${device.name}...`);
          const booted = bootDevice(device);
          if (booted) {
            emit("  ✔ Simulator booted");
          } else {
            emit("  ⚠ Could not boot simulator — may already be booting");
          }
        } else if (device && device.status === "booted") {
          emit(`  ✔ Simulator ${device.name} already booted`);
        }
      }
    }

    emit("✔ All services started");
    emit("");

    // Send result back — metro/watcher/ipc can't be sent across threads,
    // so we send the config needed to recreate them on the main thread
    self.postMessage({
      type: "done",
      result: {
        worktreeKey,
        port,
        portFree: await metro.isPortFree(port),
      },
    });
  } catch (err: any) {
    self.postMessage({ type: "error", message: err.message ?? String(err) });
  }
};
