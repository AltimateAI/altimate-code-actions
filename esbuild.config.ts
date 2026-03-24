import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: false,
  banner: {
    js: [
      '// Auto-generated — do not edit directly.',
      'import { createRequire } from "module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("Built dist/index.js");
