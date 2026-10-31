// The container bootstrap adds secret-file loading and graceful shutdown to the hub APIs.
import { openDatabase } from "../dist/db.js";
import { createHubServer } from "../dist/server.js";
import { readKey } from "./secret.mjs";

process.umask(0o077);
const port = Number(process.env.KOM_HUB_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid hub port");
const key = readKey();
const db = openDatabase(process.env.KOM_HUB_DB ?? "/data/kommutator.db");
const server = createHubServer({ db, key });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 15_000);
  timeout.unref();
  server.close(() => {
    clearTimeout(timeout);
    db.close();
  });
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
server.once("error", () => {
  console.error("Hub listener failed");
  process.exitCode = 1;
  stop();
});
server.listen(port, process.env.KOM_HUB_BIND ?? "0.0.0.0", () => {
  console.log(`kommutator hub listening on port ${port}`);
});
