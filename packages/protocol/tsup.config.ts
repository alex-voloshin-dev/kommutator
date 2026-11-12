import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/hello.ts"],
  format: ["esm"],
  target: "node26",
  dts: true,
  clean: true,
  removeNodeProtocol: false, // no builtins here today; kept for consistency with the other packages
});
