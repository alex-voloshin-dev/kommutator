import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node26",
  clean: true,
  // Bundle schema/workspace imports so cold hooks retain their 200 ms budget.
  external: ["ws"],
  noExternal: [/^@kommutator\/(agentd|protocol)(?:\/|$)/, /^zod(?:\/|$)/],
  removeNodeProtocol: false,
  // The shebang in src/index.ts is preserved by esbuild; no banner needed.
});
