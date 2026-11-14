// SQLite access for the hub. Uses the built-in node:sqlite (Node 26.13.0 LTS), no native build.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Bump when SQL layout or stored semantics change. The hub refuses to open a database whose
 * `PRAGMA user_version` does not match: a database created by an earlier schema has tables
 * that `CREATE TABLE IF NOT EXISTS` would silently leave without the new columns and
 * constraints (R10). Only explicitly supported additive migrations are applied.
 */
export const SCHEMA_VERSION = 8;

export class IncompatibleDatabaseError extends Error {
  constructor(
    public readonly path: string,
    public readonly found: number,
  ) {
    super(
      `database ${path} has schema version ${found}, this hub needs ${SCHEMA_VERSION}. ` +
        `Preserve this database and replay history. Back up using VACUUM INTO, then use a compatible hub ` +
        `and fix forward; do not reset or downgrade history. Supported upgrades: schemas 5, 6 or 7 to 8.`,
    );
    this.name = "IncompatibleDatabaseError";
  }
}

export function schemaPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql");
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const hasTables = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n > 0;

  if (version === SCHEMA_VERSION) return db;
  if (version === 5 || version === 6 || version === 7) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (version === 5) db.exec(`CREATE TABLE retired_operations (
        kind TEXT NOT NULL CHECK (kind IN ('registration', 'message', 'board', 'cleanup')),
        operation_key TEXT NOT NULL,
        PRIMARY KEY (kind, operation_key)
      ); PRAGMA user_version = 6;`);
      db.exec(`CREATE INDEX deliveries_unread_session_seq ON deliveries(session_id, seq) WHERE state = 'unread';
        CREATE INDEX message_targets_message_id ON message_targets(message_id);
        PRAGMA user_version = 8;`);
      db.exec("COMMIT");
      return db;
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  if (version === 0 && !hasTables) {
    db.exec(readFileSync(schemaPath(), "utf8"));
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return db;
  }
  db.close();
  throw new IncompatibleDatabaseError(path, version);
}

/**
 * Consistent online backup: `VACUUM INTO` writes a complete, checkpointed copy while the hub
 * keeps running. Copying the .db file by hand is NOT safe in WAL mode (DESIGN.md §11).
 */
export function backupDatabase(db: DatabaseSync, targetPath: string): void {
  db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
}
