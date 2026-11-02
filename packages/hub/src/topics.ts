import type { Methods } from "@kommutator/protocol";
import type { z } from "zod";
import { errors, requireSession, RpcFault, transaction, type HubContext, type HubPeer } from "./context.js";

function requireAdHoc(name: string): void {
  if (name === "global" || name.startsWith("project:")) {
    throw new RpcFault(errors.invalidParams, "only ad-hoc topic membership can be changed");
  }
}

export function joinTopic(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["topic.join"]>) {
  const result = transaction(ctx, () => {
    requireSession(ctx, peer, params.session_id);
    requireAdHoc(params.name);
    const created = ctx.db.prepare("INSERT OR IGNORE INTO topics(name, kind) VALUES (?, 'adhoc')").run(params.name).changes > 0;
    const joined = ctx.db.prepare(`INSERT OR IGNORE INTO memberships(session_id, topic_id)
      SELECT ?, id FROM topics WHERE name = ?`).run(params.session_id, params.name).changes > 0;
    return { created, joined };
  });
  if (result.joined) ctx.events.publish("topic.join", { session_id: params.session_id, topic: params.name });
  return { ok: true as const, ...result };
}

export function leaveTopic(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["topic.leave"]>) {
  const changed = transaction(ctx, () => {
    requireSession(ctx, peer, params.session_id);
    requireAdHoc(params.name);
    return ctx.db.prepare(`DELETE FROM memberships WHERE session_id = ?
      AND topic_id IN (SELECT id FROM topics WHERE name = ?)`).run(params.session_id, params.name).changes > 0;
  });
  if (changed) ctx.events.publish("topic.leave", { session_id: params.session_id, topic: params.name });
  return { ok: true as const };
}

export function listTopics(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["topic.list"]>) {
  requireSession(ctx, peer, params.session_id);
  const topics = ctx.db.prepare(`SELECT t.name, t.kind FROM topics t
    WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.topic_id = t.id AND m.session_id = ?)
      OR (? = 1 AND t.kind = 'adhoc') ORDER BY t.name`)
    .all(params.session_id, params.discover === true ? 1 : 0) as Array<{ name: string; kind: "global" | "project" | "adhoc" }>;
  return { topics };
}
