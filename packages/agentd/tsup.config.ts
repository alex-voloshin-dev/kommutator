import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  removeNodeProtocol: false, // keep node:sqlite and friends as-is (see hub/tsup.config.ts)
});
