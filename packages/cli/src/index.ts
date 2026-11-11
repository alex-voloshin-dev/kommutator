#!/usr/bin/env node
// Keep the hook entrypoint light: the hard deadline includes lazy imports and stdin.
if (process.argv[2] === "hook") {
  const deadline = setTimeout(() => process.exit(0), 140);
  process.stdout.on("error", () => process.exit(0));
  try {
    let prepared: import("./hook-authority.js").HookPreparation | undefined;
    if (process.argv[3] === "SessionStart" && process.env.KOM_PLUGIN_PROFILE === "claude-code" && process.argv.length === 4) {
      const { prepareHook } = await import("./hook-authority.js");
      prepared = await prepareHook(process.argv[3], []);
    }
    const { runHook } = await import("./hooks.js");
    await runHook(process.argv[3], process.argv.slice(4), prepared);
  } catch { /* Vendor hooks must always fail open. */ }
  clearTimeout(deadline);
  process.exit(0);
} else {
  try {
    const { runCommands } = await import("./commands.js");
    await runCommands();
  } catch (error) {
    console.error("kom:", error instanceof Error ? error.message : "command failed");
    process.exitCode = 1;
  }
}
