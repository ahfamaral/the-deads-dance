import type { Pool } from "pg";
import { HISTORY_WINDOW, type HistoryMessage, type Message, type Spend, type TurnSpend } from "@/lib/chat-types";
import { cutPreview, type ConversationSummary, type StoredConversation } from "@/lib/conversation-types";
import type { VisitEnding } from "@/lib/visit";
import { VisitorActSchema, type VisitorAct } from "@/lib/visitor-act";
import type { ResolvedCall } from "./pricing";

/**
 * Spec §25: every query on `conversations` and `messages`. The chat route and the
 * /api/conversations routes go through here; nothing else touches these tables.
 */
type Queryable = Pick<Pool, "query">;

// Spec §26.4: a flag older than 2 minutes is a crash, not a turn.
const RUNNING = "(turn_running_since > now() - interval '2 minutes') IS TRUE";

export type ConversationRow = {
  id: string;
  userId: string;
  personaSlug: string;
  personaName: string;
  ended: VisitEnding | null;
  turnRunning: boolean;
};

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
    `SELECT id, user_id, persona_slug, persona_name, ended, ${RUNNING} AS turn_running FROM conversations WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, userId: r.user_id, personaSlug: r.persona_slug, personaName: r.persona_name, ended: r.ended, turnRunning: r.turn_running } : null;
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
export async function beginTurn(pool: Pool, t: BeginTurn): Promise<{ ok: true } | { ok: false; reason: "not_found" | "ended" | "busy" }> {
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
    const { rows } = await client.query(`SELECT user_id, ended, ${RUNNING} AS busy FROM conversations WHERE id = $1 FOR UPDATE`, [t.conversationId]);
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const refusal = rows[0].user_id !== t.userId ? "not_found" : rows[0].ended !== null ? "ended" : rows[0].busy ? "busy" : null;
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
    await client.query(`UPDATE conversations SET updated_at = now(), ended = coalesce($2, ended), turn_running_since = now() WHERE id = $1`, [
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

export type SettleTurn = { conversationId: string; userId: string; charge: boolean; reply: Message | null; calls: ResolvedCall[] };
export type Settled = { balance: number | null; full: number | null; turn: TurnSpend; conversation: Spend };

const callsJson = (calls: ResolvedCall[]) =>
  JSON.stringify(
    calls.map((c) => ({
      role: c.role, model: c.model, input_tokens: c.inputTokens, output_tokens: c.outputTokens,
      cost: c.cost, cost_source: c.costSource, generation_id: c.generationId, latency_ms: c.latencyMs,
    })),
  );

export function turnSpend(calls: ResolvedCall[]): TurnSpend {
  const inputTokens = calls.reduce((n, c) => n + c.inputTokens, 0);
  const outputTokens = calls.reduce((n, c) => n + c.outputTokens, 0);
  return { tokens: inputTokens + outputTokens, cost: calls.reduce((n, c) => n + c.cost, 0), inputTokens, outputTokens };
}

/**
 * Spec §26.4: one statement, so it's atomic and adds no round trip. Stores the reply (if any) with the
 * turn's cost, logs every call, charges the tester (not the admin), adds to the conversation's totals
 * and clears the turn flag. Throws if the conversation is gone.
 */
export async function settleTurn(pool: Queryable, t: SettleTurn): Promise<Settled> {
  const turn = turnSpend(t.calls);
  const m = t.reply;
  const { rows } = await pool.query(
    `WITH reply AS (
       INSERT INTO messages (conversation_id, role, text, tool_calls, sources, ended, cost, tokens)
       SELECT $1, 'persona', $2, $3::jsonb, $4::jsonb, $5, $6::bigint, $7::int WHERE $8::boolean
       RETURNING id
     ), calls AS (
       INSERT INTO model_calls (user_id, conversation_id, message_id, role, model, input_tokens, output_tokens, cost, cost_source, generation_id, latency_ms)
       SELECT $9, $1, (SELECT id FROM reply), c.role, c.model, c.input_tokens, c.output_tokens, c.cost, c.cost_source, c.generation_id, c.latency_ms
       FROM jsonb_to_recordset($10::jsonb) AS c(role text, model text, input_tokens int, output_tokens int, cost bigint, cost_source text, generation_id text, latency_ms int)
     ), charged AS (
       UPDATE "user" SET "energyBalance" = "energyBalance" - $6::bigint WHERE id = $9 AND $11::boolean
       RETURNING "energyBalance", "energyFull"
     ), totals AS (
       UPDATE conversations SET cost = cost + $6::bigint, tokens = tokens + $7::int, turn_running_since = NULL, updated_at = now()
       WHERE id = $1 RETURNING cost, tokens
     )
     SELECT (SELECT "energyBalance" FROM charged) AS balance, (SELECT "energyFull" FROM charged) AS full,
            (SELECT cost FROM totals) AS conv_cost, (SELECT tokens FROM totals) AS conv_tokens`,
    [
      t.conversationId, m?.text ?? "", JSON.stringify(m?.toolCalls ?? []), JSON.stringify(m?.sources ?? []), m?.ended ?? null,
      turn.cost, turn.tokens, m !== null, t.userId, callsJson(t.calls), t.charge,
    ],
  );
  const r = rows[0];
  if (r.conv_cost === null) throw new Error(`Conversation ${t.conversationId} is gone.`);
  return {
    balance: r.balance === null ? null : Number(r.balance),
    full: r.full === null ? null : Number(r.full),
    turn,
    conversation: { cost: Number(r.conv_cost), tokens: Number(r.conv_tokens) },
  };
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
  cost: string | null;
  tokens: number | null;
};

/** The UI's Message shape: acts on visitor messages, traces on persona ones (spec §25.4). */
function toMessage(r: MessageRow, costs: boolean): Message {
  return {
    id: String(r.id),
    role: r.role,
    text: r.text,
    ...(r.role === "user" ? { act: parseAct(r.act) } : { toolCalls: r.tool_calls ?? [], sources: r.sources ?? [] }),
    ...(r.ended ? { ended: r.ended } : {}),
    ...(r.stopped ? { stopped: true } : {}),
    ...(costs && r.cost !== null ? { cost: Number(r.cost), tokens: r.tokens ?? 0 } : {}),
  };
}

/**
 * Spec §25.4: the user's conversations, newest first. Summaries only, no paging. Spec §27: with `all`
 * (the admin), every user's, each with its owner's email and whether it's the caller's own.
 */
export async function listConversations(pool: Queryable, userId: string, opts: { all: boolean } = { all: false }): Promise<ConversationSummary[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.persona_slug, c.persona_name, c.updated_at, c.ended, u.email AS user_email, c.user_id = $1 AS mine,
            (SELECT m.text FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_text
     FROM conversations c JOIN "user" u ON u.id = c.user_id
     WHERE $2::boolean OR c.user_id = $1
     ORDER BY c.updated_at DESC, c.id`,
    [userId, opts.all],
  );
  return rows.map((r) => ({
    id: r.id,
    personaId: r.persona_slug,
    personaName: r.persona_name,
    preview: cutPreview(r.first_text),
    updatedAt: new Date(r.updated_at).toISOString(),
    ended: r.ended,
    ...(opts.all ? { userEmail: r.user_email, mine: r.mine } : {}),
  }));
}

/** One of the user's conversations with its messages, or null (another user's, or none). Spec §27: with `anyOwner` (the admin), anyone's, with the owner's email. */
export async function readConversation(pool: Queryable, userId: string, id: string, opts: { costs: boolean; anyOwner?: boolean }): Promise<StoredConversation | null> {
  const { rows } = await pool.query(
    `SELECT c.id, c.persona_slug, c.persona_name, c.updated_at, c.cost, c.tokens, ${RUNNING} AS turn_running, u.email AS user_email
     FROM conversations c JOIN "user" u ON u.id = c.user_id
     WHERE c.id = $1 AND ($3::boolean OR c.user_id = $2)`,
    [id, userId, opts.anyOwner === true],
  );
  if (!rows[0]) return null;
  const { rows: messages } = await pool.query<MessageRow>(
    `SELECT id, role, text, act, tool_calls, sources, ended, stopped, cost, tokens FROM messages WHERE conversation_id = $1 ORDER BY id`,
    [id],
  );
  return {
    id: rows[0].id,
    personaId: rows[0].persona_slug,
    personaName: rows[0].persona_name,
    updatedAt: new Date(rows[0].updated_at).toISOString(),
    messages: messages.map((m) => toMessage(m, opts.costs)),
    turnRunning: rows[0].turn_running,
    ...(opts.costs ? { spend: { cost: Number(rows[0].cost), tokens: rows[0].tokens } } : {}),
    ...(opts.anyOwner ? { userEmail: rows[0].user_email } : {}),
  };
}

/** Spec §25.4: a hard delete; the messages go with it. False when it isn't the user's. */
export async function deleteConversation(pool: Queryable, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rowCount === 1;
}
