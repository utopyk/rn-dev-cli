import { build } from "esbuild";
import { readFileSync } from "fs";

// Read package.json to get dependencies that should be external
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

// These packages have native/binary components or need to be resolved at runtime
const externalPackages = [
  // Node built-ins are handled by platform: "node"
  // Keep these external because they have native bindings or are optional
  "fsevents",
  // ink's optional devtools integration - not needed at runtime
  "react-devtools-core",
  // ink lazily loads devtools.js at runtime (caught in try/catch), keep it external
  "./devtools.js",
  // commander is CJS and requires node: built-ins via dynamic require;
  // keeping it external lets Node resolve it natively at runtime
  "commander",
];

await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  banner: { js: "#!/usr/bin/env node" },
  external: externalPackages,
  minify: false,        // keep readable for debugging
  sourcemap: true,
  metafile: true,       // for bundle analysis
  define: {
    "process.env.RN_DEV_VERSION": `"${pkg.version}"`,
  },
  loader: {
    ".json": "json",    // bundle JSON theme files
  },
}).then((result) => {
  // Print bundle size info
  const outputFile = result.metafile?.outputs["dist/index.js"];
  if (outputFile) {
    const sizeKB = (outputFile.bytes / 1024).toFixed(1);
    console.log(`✓ Built dist/index.js (${sizeKB} KB)`);
  }
});
