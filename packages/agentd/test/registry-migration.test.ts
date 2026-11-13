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


it("upgrades schema 2 conservatively and persists retirement reasons through reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-state-reason-"));
  const path = join(directory, "state.db");
  try {
    const old = new Registry(path);
    old.save({ key: "claude-code:old", session: Session.parse({ id: "old-session", host: "host", name: "old", vendor: "claude-code", state: "gone" }), ownerGeneration: 1, pid: 123, processStartedAt: "birth", acked: 4, stopBlocked: false });
    old.db.exec("PRAGMA user_version = 2"); old.close();
    const upgraded = new Registry(path);
    const record = upgraded.get("claude-code:old");
    if (!record) throw new Error("missing migrated record");
    expect(record.goneReason).toBeUndefined();
    expect(record).toMatchObject({ ownerGeneration: 1, acked: 4, session: { state: "gone" } });
    record.goneReason = "session-end"; upgraded.save(record); upgraded.close();
    const reopened = new Registry(path);
    expect(reopened.get("claude-code:old")?.goneReason).toBe("session-end");
    expect(reopened.db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: STATE_SCHEMA_VERSION });
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.each([1, 2, 3])("creates schema4 observations from schema%i without rewriting legacy outbox", async version => {
  const directory = await mkdtemp(join(tmpdir(), "kom-observation-migration-")); const path = join(directory, "state.db");
  try {
    const old = new Registry(path);
    old.enqueue("old", "message.send", { idempotency_key: "keep-key", message: { body: "legacy" } }, 10);
    const before = old.outbox();
    old.db.exec(`DROP TABLE mutation_observations; PRAGMA user_version=${version}`); old.close();
    const current = new Registry(path);
    expect(current.outbox()).toEqual(before);
    expect(current.db.prepare("SELECT * FROM mutation_observations").all()).toEqual([]);
    expect(current.db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: STATE_SCHEMA_VERSION }); current.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("preserves schema4 owner, outbox and observation bytes when installing schema5 fence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-birth-migration-")); const path = join(directory, "state.db");
  try {
    const old = new Registry(path);
    old.save({ key: "legacy", session: Session.parse({ id: "history", host: "host", name: "legacy", vendor: "claude-code" }), pid: 42, processStartedAt: "Tue Nov 10 07:01:09 2026", acked: 12, stopBlocked: true });
    const id = old.enqueue("legacy", "message.send", { idempotency_key: "same-replay", message: { body: "keep" } }, 1);
    old.db.prepare("INSERT INTO mutation_observations VALUES (?,?,?,?,?,?,?,?,?,?)").run("operation", "owner", "history", "message.send", id, 1, 1, "queued", null, null);
    const before = { records: old.all(), outbox: old.outbox(), operations: old.db.prepare("SELECT * FROM mutation_observations").all() };
    old.db.exec("PRAGMA user_version=4"); old.close();
    const current = new Registry(path);
    expect(current.all()).toEqual(before.records); expect(current.outbox()).toEqual(before.outbox);
    expect(current.db.prepare("SELECT * FROM mutation_observations").all()).toEqual(before.operations);
    expect(current.db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 5 }); current.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
