#!/usr/bin/env bun
/**
 * Build script for rn-dev-cli using Bun's native bundler.
 *
 * Usage:
 *   bun run build.ts          — bundle to dist/index.js
 *   bun run build.ts compile  — standalone binary at dist/rn-dev
 */

const isCompile = process.argv.includes("compile");

if (isCompile) {
  // Standalone binary — no runtime dependency needed
  const proc = Bun.spawn(
    ["bun", "build", "--compile", "--target=bun", "src/index.tsx", "--outfile", "dist/rn-dev"],
    { stdout: "inherit", stderr: "inherit" }
  );
  await proc.exited;
  console.log("✓ Built standalone binary: dist/rn-dev");
} else {
  // Bundled JS — requires bun to run
  const result = await Bun.build({
    entrypoints: ["src/index.tsx"],
    outdir: "dist",
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "external",
  });

  if (result.success) {
    for (const output of result.outputs) {
      const sizeKB = (output.size / 1024).toFixed(1);
      console.log(`✓ Built ${output.path} (${sizeKB} KB)`);
    }
  } else {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}
