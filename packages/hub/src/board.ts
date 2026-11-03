import type { BoardEntry, Methods, Results } from "@kommutator/protocol";
import type { z } from "zod";
import {
  errors, rejectRetiredOperation, requireMembership, requireSession, RpcFault, transaction, type HubContext, type HubPeer,
} from "./context.js";

interface BoardRow {
  topic_id: number;
  key: string;
  body: string;
  version: number;
  author: string;
  protected: number;
  updated_at: string;
}

interface BoardReplayRow extends BoardRow { author_session: string | null }

function boardRecord(topic: string, row: BoardRow): BoardEntry {
  return {
    topic, key: row.key, body: row.body, version: row.version, author: row.author,
    protected: row.protected !== 0, updated_at: row.updated_at,
  };
}

export function getBoard(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["board.get"]>) {
  requireSession(ctx, peer, params.session_id);
  const topicId = requireMembership(ctx, params.session_id, params.topic);
  const rows = ctx.db.prepare(`SELECT * FROM board_entries
    WHERE topic_id = ? AND (? IS NULL OR key = ?) ORDER BY key`)
    .all(topicId, params.key ?? null, params.key ?? null) as unknown as BoardRow[];
  return { entries: rows.map((row) => boardRecord(params.topic, row)) };
}

export function putBoard(
  ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["board.put"]>,
): z.output<typeof Results["board.put"]> {
  const result = transaction(ctx, () => {
    const session = requireSession(ctx, peer, params.session_id);
    const topicId = requireMembership(ctx, session.id, params.topic);
    rejectRetiredOperation(ctx, "board", params.op_id);
    const replay = ctx.db.prepare(`SELECT topic_id, key, body, version, author, author_session, protected, created_at AS updated_at
      FROM board_versions WHERE op_id = ?`).get(params.op_id) as BoardReplayRow | undefined;
    if (replay) {
      if (replay.topic_id !== topicId || replay.key !== params.key || replay.author_session !== session.id) {
        throw new RpcFault(errors.conflict, "board operation belongs to another topic, key or author");
      }
      return { entry: boardRecord(params.topic, replay), replayed: true };
    }
    const previous = ctx.db.prepare("SELECT * FROM board_entries WHERE topic_id = ? AND key = ?")
      .get(topicId, params.key) as BoardRow | undefined;
    if (previous ? params.if_version !== previous.version : params.if_version !== undefined) {
      throw new RpcFault(errors.conflict, "board version conflict; read the current entry before retrying");
    }
    const entry: BoardEntry = {
      topic: params.topic, key: params.key, body: params.body, version: (previous?.version ?? 0) + 1,
      author: session.handle, protected: params.protected ?? (previous?.protected === 1), updated_at: ctx.now(),
    };
    ctx.db.prepare(`INSERT INTO board_entries(topic_id, key, body, version, author, protected, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(topic_id, key) DO UPDATE SET
      body = excluded.body, version = excluded.version, author = excluded.author,
      protected = excluded.protected, updated_at = excluded.updated_at`)
      .run(topicId, entry.key, entry.body, entry.version, entry.author, Number(entry.protected), entry.updated_at);
    ctx.db.prepare(`INSERT INTO board_versions(topic_id, key, version, body, author, author_session, protected, op_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(topicId, entry.key, entry.version, entry.body, entry.author, session.id, Number(entry.protected), params.op_id, entry.updated_at);
    return { entry, replayed: false };
  });
  if (!result.replayed) ctx.events.publish("board.put", { entry: result.entry });
  return result;
}

export function boardHistory(
  ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["board.history"]>,
): z.output<typeof Results["board.history"]> {
  requireSession(ctx, peer, params.session_id);
  const topicId = requireMembership(ctx, params.session_id, params.topic);
  const rows = ctx.db.prepare(`SELECT topic_id, key, body, version, author, protected, created_at AS updated_at
    FROM board_versions WHERE topic_id = ? AND key = ? AND (? IS NULL OR version < ?)
    ORDER BY version DESC LIMIT ?`)
    .all(topicId, params.key, params.before_version ?? null, params.before_version ?? null, params.limit + 1) as unknown as BoardRow[];
  const more = rows.length > params.limit;
  const entries = rows.slice(0, params.limit).map((row) => boardRecord(params.topic, row));
  return { entries, more, next_before_version: more ? entries.at(-1)?.version ?? null : null };
}
