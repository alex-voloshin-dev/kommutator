import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

it("publishes and retires authority without loading the full protocol or daemon", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-authority-boundary-"));
  try {
    const filename = (await readdir(dist)).find(name => /^hook-authority-.*\.js$/.test(name));
    if (!filename) throw new Error("Built authority entry missing");
    const entry = pathToFileURL(join(dist, filename)).href;
    const preload = join(home, "deny-unrelated-imports.mjs");
    await writeFile(preload, `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (["@kommutator/protocol", "@kommutator/agentd", "ws", "node:sqlite"].includes(specifier))
          throw new Error("Unrelated import reached authority");
        return nextResolve(specifier, context);
      }, load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        // Workspace schemas are bundled: reject unrelated hub schemas even without a package import.
        if (String(result.source).includes('"session.upsert":'))
          throw new Error("Full protocol schemas reached authority");
        return result;
      } });
    `);
    const input = JSON.stringify({ session_id: "authority-fixture", cwd: home });
    const run = async (event: string) => {
      const source = `import { Readable } from "node:stream";
        Object.defineProperty(process, "stdin", { value: Readable.from([${JSON.stringify(input)}]) });
        const { prepareHook } = await import(${JSON.stringify(entry)});
        await prepareHook(${JSON.stringify(event)}, []);
        console.log("prepared");`;
      const result = await exec(process.execPath, ["--import", preload, "--input-type=module", "-e", source], {
        env: { PATH: process.env.PATH ?? "", KOM_HOME: home, KOM_PLUGIN_PROFILE: "claude-code", CLAUDE_CODE_SESSION_ID: "authority-fixture" },
        timeout: 5_000,
      });
      expect(result.stdout).toBe("prepared\n");
      expect(result.stderr).toBe("");
    };
    await run("SessionStart");
    const directories = (await readdir(join(home, "contexts"))).filter(name => name.endsWith(".d"));
    expect(directories).toHaveLength(1);
    const directory = directories[0];
    if (!directory) throw new Error("Authority journal missing");
    const journal = join(home, "contexts", directory);
    expect(JSON.parse(await readFile(join(journal, "1.json"), "utf8"))).toMatchObject({
      generation: 1, hello: { vendor_session_id: "authority-fixture", owner_generation: 1 },
    });
    await run("SessionEnd");
    expect(await readFile(join(journal, "1.ended"), "utf8")).toBe("");
  } finally { await rm(home, { recursive: true, force: true }); }
});
