import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts", "src/db.ts", "src/testing.ts"],
  format: ["esm"],
  target: "node26",
  dts: true,
  clean: true,
  // tsup strips the `node:` prefix by default; esbuild then treats `sqlite` as an npm
  // package and the built-in node:sqlite can't be found at runtime.
  removeNodeProtocol: false,
});
