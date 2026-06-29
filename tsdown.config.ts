import { defineConfig } from "tsdown/config";

export default defineConfig({
  entry: "src/executor.ts",
  format: "esm",
  platform: "node",
  target: "node25",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  treeshake: true,
  fixedExtension: true
});
