import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node26",
  clean: true,
  // Bundle schema/workspace imports to minimize cold hook startup against the 200 ms target.
  external: ["ws"],
  noExternal: [/^@kommutator\/(agentd|protocol)(?:\/|$)/, /^zod(?:\/|$)/],
  removeNodeProtocol: false,
  // The shebang in src/index.ts is preserved by esbuild; no banner needed.
});
