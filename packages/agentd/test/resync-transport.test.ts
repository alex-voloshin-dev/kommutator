import { expect, it } from "vitest";
import { once } from "node:events";
import { createConformanceHarness } from "@kommutator/hub/testing";
import { createHubServer } from "@kommutator/hub";
import { Results } from "@kommutator/protocol";
import { DaemonCore } from "../src/core.js";
import { HubLink } from "../src/hub-link.js";

it("recovers 200 large unread deliveries through real sockets and reincarnation without reconnect churn or receipts", async () => {
  const hub = createConformanceHarness(); const seed = hub.connect("isolated");
  const register = (name: string) => Results["session.upsert"].parse(seed.request("session.upsert", {
    op: "register", reg_id: `register-${name}`, session: { host: "isolated", name, vendor: "other", capability: "none" },
  })).session;
  const sender = register("sender"), recipient = register("recipient");
  for (let i = 0; i < 200; i++) seed.request("message.send", { session_id: sender.id, idempotency_key: `message-${i}`,
    message: { from: "", to: [recipient.handle], body: "x".repeat(60_000) } });
  seed.disconnect(); let errors = 0;
  const server = createHubServer({ db: hub.db, runtime: hub.runtime, key: "isolated-test-key-12345", onConnectionError: () => { errors++; } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  const config = { host: "isolated", hub: `http://127.0.0.1:${address.port}`, key: "isolated-test-key-12345" };
  const failures: string[] = [];
  const link = new HubLink(config, error => failures.push(error));
  const core = new DaemonCore({ config, dbPath: ":memory:", transport: link, isAlive: async () => true });
  core.registry.save({ key: "recipient", session: recipient, acked: 0, stopBlocked: false });
  try {
    await core.start();
    const deadline = Date.now() + 5000;
    while (core.registry.pending(recipient.id).length !== 200) {
      if (Date.now() > deadline) throw new Error("backlog recovery timed out");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await core.synchronize();
    expect(link.epoch).toBe(1); expect(errors).toBe(0); expect(failures).toEqual([]);
    expect(core.registry.pending(recipient.id)).toHaveLength(200);
    expect(core.registry.get("recipient")?.acked).toBe(0);
    expect(hub.db.prepare("SELECT count(*) AS n FROM deliveries WHERE state='unread'").get()).toEqual({ n: 200 });
    expect(core.registry.get("recipient")?.session.incarnation).toBe(1);
  } finally {
    await core.close(); await new Promise<void>(resolve => server.close(() => resolve())); hub.close();
  }
}, 10_000);
