// docker compose exec -T hub node /app/container/backup.mjs /data/backup-<timestamp>.db
import { DatabaseSync } from "node:sqlite";
import { backupDatabase } from "../dist/db.js";

const target = process.argv[2];
if (!target || !/^\/data\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.db$/.test(target)) {
  throw new Error("Backup target must be a new /data/<filename>.db");
}
process.umask(0o077);
const db = new DatabaseSync(process.env.KOM_HUB_DB ?? "/data/kommutator.db", { readOnly: true });
try {
  backupDatabase(db, target);
  console.log("Hub backup completed");
} finally {
  db.close();
}
