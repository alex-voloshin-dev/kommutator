import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  removeNodeProtocol: false, // no builtins here today; kept for consistency with the other packages
});
