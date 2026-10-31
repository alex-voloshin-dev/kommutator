#!/usr/bin/env node
// Standalone hub entrypoint for the deployed package/container. Opens the database and
// serves the authenticated dashboard, API and agentd WebSocket RPC.

import { openDatabase } from "./db.js";
import { createHubServer } from "./server.js";

const PORT = Number(process.env.KOM_HUB_PORT ?? 8787); // plaintext; put TLS or Tailscale in front
const BIND = process.env.KOM_HUB_BIND ?? "127.0.0.1"; // Docker sets 0.0.0.0; bare metal stays local by default
const DB_PATH = process.env.KOM_HUB_DB ?? "./kommutator.db";
const KEY = process.env.KOM_KEY;

if (!KEY || KEY.length < 16) {
  console.error("KOM_KEY is required (at least 16 characters)");
  process.exit(1);
}

const db = openDatabase(DB_PATH);
const server = createHubServer({ db, key: KEY });

server.listen(PORT, BIND, () => {
  console.log(`kommutator hub listening on ${BIND}:${PORT}, db=${DB_PATH}`);
});
