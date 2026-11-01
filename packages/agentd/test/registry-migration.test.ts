import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "@kommutator/protocol";
import { Registry, STATE_SCHEMA_VERSION } from "../src/registry.js";

it("upgrades schema 1 without losing identity, pending replay or delivery records and persists the new fence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-state-migration-"));
  const path = join(directory, "state.db");
  try {
    const old = new Registry(path);
    old.save({ key: "claude-code:old", session: Session.parse({ id: "old-session", host: "host", name: "old", vendor: "claude-code", vendor_session_id: "old" }), pid: 123, processStartedAt: "birth", acked: 4, stopBlocked: false });
    old.enqueue("claude-code:old", "message.send", { idempotency_key: "preserved", message: { body: "queued" } }, 1);
    old.db.prepare("INSERT INTO deliveries VALUES (?,?,?,?)").run("old-session", 5, JSON.stringify({ fixture: "preserved" }), 0);
    old.db.exec("PRAGMA user_version = 1");
    old.close();
    const upgraded = new Registry(path);
    expect(upgraded.db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: STATE_SCHEMA_VERSION });
    expect(upgraded.get("claude-code:old")).toMatchObject({ acked: 4, pid: 123, processStartedAt: "birth" });
    expect(upgraded.get("claude-code:old")?.ownerGeneration).toBeUndefined();
    expect(JSON.parse(upgraded.outbox()[0]?.params ?? "{}")).toMatchObject({ idempotency_key: "preserved" });
    expect(upgraded.db.prepare("SELECT notification FROM deliveries").get()).toMatchObject({ notification: JSON.stringify({ fixture: "preserved" }) });
    const record = upgraded.get("claude-code:old");
    if (!record) throw new Error("missing migrated record");
    record.ownerGeneration = 7; upgraded.save(record); upgraded.close();
    const reopened = new Registry(path);
    expect(reopened.get("claude-code:old")?.ownerGeneration).toBe(7);
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
