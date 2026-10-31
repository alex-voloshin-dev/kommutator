import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    child.stdout?.destroy(); child.stderr?.destroy();
  }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function home() {
  const path = await mkdtemp(join(tmpdir(), "kom-process-logs-")); dirs.push(path);
  return path;
}

function start(directory: string, args: string[], consume = true) {
  const child = spawn(process.execPath, [entry, "logs", ...args], { env: { ...process.env, KOM_HOME: directory }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let stdout = "";
  let stderr = "";
  if (consume) child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, stdout: () => stdout, stderr: () => stderr };
}

describe("production log command", () => {
  it("accepts --lines and prints raw JSONL without daemon side effects", async () => {
    const directory = await home();
    await writeFile(join(directory, "agentd.log"), '{"message":"first"}\n{"message":"last"}\n');
    const command = start(directory, ["--lines", "1"]);
    expect(await command.exited).toEqual({ code: 0, signal: null });
    expect(command.stdout()).toBe('{"message":"last"}\n');
    expect(command.stderr()).toBe("");
    expect(await readdir(directory)).toEqual(["agentd.log"]);
  });

  it("accepts -f and follows appends until SIGINT", async () => {
    const directory = await home();
    await writeFile(join(directory, "agentd.log"), '{"message":"first"}\n');
    const command = start(directory, ["-f"]);
    await expect.poll(command.stdout).toBe('{"message":"first"}\n');
    await appendFile(join(directory, "agentd.log"), '{"message":"next"}\n');
    await expect.poll(command.stdout).toBe('{"message":"first"}\n{"message":"next"}\n');
    command.child.kill("SIGINT");
    expect(await command.exited).toEqual({ code: 0, signal: null });
  });

  it.each(["SIGINT", "SIGTERM"] as const)("exits on %s even if the output pipe is not drained", async (signal) => {
    const directory = await home();
    const line = JSON.stringify({ message: "x".repeat(60_000) }) + "\n";
    await writeFile(join(directory, "agentd.log"), line.repeat(100));
    const command = start(directory, ["--follow"], false);
    // Readable bytes prove command startup; leave the multi-megabyte pipe undrained.
    await expect.poll(() => command.child.stdout.readableLength).toBeGreaterThan(0);
    command.child.kill(signal);
    expect(await command.exited).toEqual({ code: 0, signal: null });
    expect(command.stderr()).toBe("");
  });
});
