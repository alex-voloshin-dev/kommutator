import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.js";
const paths: string[] = [];
afterEach(() => paths.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
it.each([5, 6, 7])("rolls back both indexes, prerequisite migration and version when second index fails from %s", version => {
  const dir = mkdtempSync(join(tmpdir(), "kom-index-migration-")); paths.push(dir); const path = join(dir, "hub.db");
  const db = openDatabase(path);
  db.exec(`DROP INDEX deliveries_unread_session_seq; DROP INDEX message_targets_message_id;
    CREATE TABLE message_targets_message_id (conflict TEXT); PRAGMA user_version=${version}`);
  if (version === 5) db.exec("DROP TABLE retired_operations");
  db.close();
  expect(() => openDatabase(path)).toThrow();
  const check = new DatabaseSync(path);
  try {
    expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: version });
    expect(check.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='deliveries_unread_session_seq'").get()).toBeUndefined();
    expect(Boolean(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='retired_operations'").get())).toBe(version !== 5);
    expect(check.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
  } finally { check.close(); }
});
