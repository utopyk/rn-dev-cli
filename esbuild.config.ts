// Build using Bun's native bundler — OpenTUI requires bun:ffi
// Run with: bun run build

const result = await Bun.build({
  entrypoints: ["src/index.tsx", "src/app/service-worker.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  sourcemap: "external",
  external: [
    "@opentui/core",
    "@opentui/react",
    "bun:ffi",
    "react",
    "react-reconciler",
    "commander",
    "fsevents",
  ],
  define: {
    "process.env.RN_DEV_VERSION": `"0.1.0"`,
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const msg of result.logs) {
    console.error(msg);
  }
  process.exit(1);
} else {
  const output = result.outputs[0];
  const sizeKB = (output.size / 1024).toFixed(1);
  console.log(`✓ Built dist/index.js (${sizeKB} KB)`);
}
