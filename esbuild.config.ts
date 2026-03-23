import { build } from "esbuild";

await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  banner: { js: "#!/usr/bin/env node" },
  external: [],
  minify: false,
  sourcemap: true,
});
