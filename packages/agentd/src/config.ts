import { readFile } from "node:fs/promises";
import * as z from "zod";
import { Ident } from "@kommutator/protocol";
import { pathsFor } from "./paths.js";

export const Config = z.object({
  hub: z.string().url().refine((value) => ["http:", "https:", "ws:", "wss:"].includes(new URL(value).protocol), "unsupported hub protocol"),
  key: z.string().min(16),
  host: Ident,
});
export type DaemonConfig = z.infer<typeof Config>;

export async function loadConfig(home?: string): Promise<DaemonConfig> {
  const value: unknown = JSON.parse(await readFile(pathsFor(home).config, "utf8"));
  const parsed = Config.safeParse(value);
  if (!parsed.success) throw new Error("invalid kommutator config: expected hub URL, key (at least 16 characters), and host identifier");
  return parsed.data;
}
