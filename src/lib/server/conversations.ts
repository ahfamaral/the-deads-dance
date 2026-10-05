import type { Pool } from "pg";
import { HISTORY_WINDOW, type HistoryMessage, type Message } from "@/lib/chat-types";
import { cutPreview, type ConversationSummary, type StoredConversation } from "@/lib/conversation-types";
import type { StoredReply } from "@/lib/turn-state";
import type { VisitEnding } from "@/lib/visit";
import { VisitorActSchema, type VisitorAct } from "@/lib/visitor-act";

/**
 * Spec §25: every query on `conversations` and `messages`. The chat route and the
 * /api/conversations routes go through here; nothing else touches these tables.
 */
type Queryable = Pick<Pool, "query">;

export type ConversationRow = {
  id: string;
  userId: string;
  personaSlug: string;
  personaName: string;
  ended: VisitEnding | null;
};

export type { StoredReply };

export type TurnContext = {
  /** The last HISTORY_WINDOW messages, oldest first, for the model. */
  history: HistoryMessage[];
  /** Every visitor message's act, oldest first, for foldVisit (spec §25.3 step 5). */
  acts: (VisitorAct | null)[];
  /** The newest message is the visitor's, with no reply stored yet. */
  unanswered: boolean;
};

export type BeginTurn = {
  conversationId: string;
  userId: string;
  personaSlug: string;
  personaName: string;
  /** null on Retry: the visitor message is already stored. */
  visitor: { text: string; act: VisitorAct | null } | null;
  /** Set when this turn ends the visit; locked before the reply streams. */
  ending: VisitEnding | null;
  /** True only on a conversation's first message; otherwise a missing row (deleted mid-turn) is not_found. */
  create: boolean;
};

/** A stored act that no longer parses reads as null, like a classifier failure. */
export function parseAct(value: unknown): VisitorAct | null {
  const parsed = VisitorActSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function findConversation(pool: Queryable, id: string): Promise<ConversationRow | null> {
  const { rows } = await pool.query(
    `SELECT id, user_id, persona_slug, persona_name, ended FROM conversations WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, userId: r.user_id, personaSlug: r.persona_slug, personaName: r.persona_name, ended: r.ended } : null;
}

export async function loadTurnContext(pool: Queryable, conversationId: string): Promise<TurnContext> {
  const [recent, acts] = await Promise.all([
    pool.query<HistoryMessage>(
      `SELECT role, text FROM (
         SELECT id, role, text FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2
       ) recent ORDER BY id`,
      [conversationId, HISTORY_WINDOW],
    ),
    pool.query<{ act: unknown }>(
      `SELECT act FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY id`,
      [conversationId],
    ),
  ]);
  const history = recent.rows.map(({ role, text }) => ({ role, text }));
  return { history, acts: acts.rows.map((r) => parseAct(r.act)), unanswered: history.at(-1)?.role === "user" };
}

/**
 * Spec §25.3 step 7, in one transaction: creates the conversation on its first turn, refuses
 * another user's or an ended one, stores the visitor message, and locks this turn's ending
 * before the reply streams. The row lock makes two racing turns take turns.
 */
export async function beginTurn(pool: Pool, t: BeginTurn): Promise<{ ok: true } | { ok: false; reason: "not_found" | "ended" }> {
  const client = await pool.connect();
  let failed: unknown;
  try {
    await client.query("BEGIN");
    if (t.create) {
      await client.query(
        `INSERT INTO conversations (id, user_id, persona_slug, persona_name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [t.conversationId, t.userId, t.personaSlug, t.personaName],
      );
    }
    const { rows } = await client.query(`SELECT user_id, ended FROM conversations WHERE id = $1 FOR UPDATE`, [t.conversationId]);
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const refusal = rows[0].user_id !== t.userId ? "not_found" : rows[0].ended !== null ? "ended" : null;
    if (refusal) {
      await client.query("ROLLBACK");
      return { ok: false, reason: refusal };
    }
    if (t.visitor) {
      await client.query(`INSERT INTO messages (conversation_id, role, text, act) VALUES ($1, 'user', $2, $3::jsonb)`, [
        t.conversationId,
        t.visitor.text,
        t.visitor.act === null ? null : JSON.stringify(t.visitor.act),
      ]);
    }
    await client.query(`UPDATE conversations SET updated_at = now(), ended = coalesce($2, ended) WHERE id = $1`, [
      t.conversationId,
      t.ending,
    ]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    failed = err;
    // On a dead connection ROLLBACK throws too; the original error is the one worth reporting.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release(failed instanceof Error ? failed : undefined);
  }
}

/** Spec §25.3 step 9: the persona's reply, finished or stopped. Throws if the conversation is gone. */
export async function storeReply(pool: Queryable, conversationId: string, reply: StoredReply): Promise<void> {
  const m = reply.message;
  await pool.query(
    `WITH stored AS (
       INSERT INTO messages (conversation_id, role, text, tool_calls, sources, ended, stopped)
       VALUES ($1, 'persona', $2, $3::jsonb, $4::jsonb, $5, $6)
     )
     UPDATE conversations SET updated_at = now() WHERE id = $1`,
    [conversationId, m.text, JSON.stringify(m.toolCalls ?? []), JSON.stringify(m.sources ?? []), m.ended ?? null, reply.stopped],
  );
}

type MessageRow = {
  id: string;
  role: "user" | "persona";
  text: string;
  act: unknown;
  tool_calls: Message["toolCalls"] | null;
  sources: Message["sources"] | null;
  ended: VisitEnding | null;
  stopped: boolean;
};

/** The UI's Message shape: acts on visitor messages, traces on persona ones (spec §25.4). */
function toMessage(r: MessageRow): Message {
  return {
    id: String(r.id),
    role: r.role,
    text: r.text,
    ...(r.role === "user" ? { act: parseAct(r.act) } : { toolCalls: r.tool_calls ?? [], sources: r.sources ?? [] }),
    ...(r.ended ? { ended: r.ended } : {}),
    ...(r.stopped ? { stopped: true } : {}),
  };
}

/** Spec §25.4: the user's conversations, newest first. Summaries only, no paging. */
export async function listConversations(pool: Queryable, userId: string): Promise<ConversationSummary[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.persona_slug, c.persona_name, c.updated_at, c.ended,
            (SELECT m.text FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_text
     FROM conversations c
     WHERE c.user_id = $1
     ORDER BY c.updated_at DESC, c.id`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    personaId: r.persona_slug,
    personaName: r.persona_name,
    preview: cutPreview(r.first_text),
    updatedAt: new Date(r.updated_at).toISOString(),
    ended: r.ended,
  }));
}

/** One of the user's conversations with its messages, or null (another user's, or none). */
export async function readConversation(pool: Queryable, userId: string, id: string): Promise<StoredConversation | null> {
  const { rows } = await pool.query(
    `SELECT id, persona_slug, persona_name, updated_at FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!rows[0]) return null;
  const { rows: messages } = await pool.query<MessageRow>(
    `SELECT id, role, text, act, tool_calls, sources, ended, stopped FROM messages WHERE conversation_id = $1 ORDER BY id`,
    [id],
  );
  return {
    id: rows[0].id,
    personaId: rows[0].persona_slug,
    personaName: rows[0].persona_name,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
    messages: messages.map(toMessage),
  };
}

/** Spec §25.4: a hard delete; the messages go with it. False when it isn't the user's. */
export async function deleteConversation(pool: Queryable, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rowCount === 1;
}
