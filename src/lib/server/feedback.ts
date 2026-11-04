import type { Pool } from "pg";
import { summarizeFeedback, type Feedback, type FeedbackItem, type FeedbackReport } from "@/lib/feedback";

/** Spec §32: every query on `conversation_feedback`. */
type Queryable = Pick<Pool, "query">;

export type SaveFeedback = Feedback & {
  conversationId: string;
  userId: string;
  /** Spec §32.1: the config at the first save; an edit keeps the first values. */
  model: string;
  commitSha: string;
};

/**
 * Spec §32.2–3: one rating per conversation, by its owner only (the admin included). Needs a
 * visitor message. An edit replaces stars and comment and moves updated_at.
 */
export async function saveFeedback(
  pool: Queryable,
  f: SaveFeedback,
): Promise<{ ok: true; feedback: Feedback } | { ok: false; reason: "not_found" | "no_messages" }> {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS has_user_message
     FROM conversations c WHERE c.id = $1 AND c.user_id = $2`,
    [f.conversationId, f.userId],
  );
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if (!rows[0].has_user_message) return { ok: false, reason: "no_messages" };
  const saved = await pool.query(
    `INSERT INTO conversation_feedback (conversation_id, user_id, stars, comment, model, commit_sha)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (conversation_id) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()
     RETURNING stars, comment`,
    [f.conversationId, f.userId, f.stars, f.comment, f.model, f.commitSha],
  );
  return { ok: true, feedback: { stars: saved.rows[0].stars, comment: saved.rows[0].comment } };
}

/**
 * Spec §32.7: every rating, newest first, with the tester's email and the persona, and the summary.
 * Spec §34.4: with `personaSlug`, only that persona's ratings (the profile page).
 */
export async function listFeedback(pool: Queryable, personaSlug?: string): Promise<FeedbackReport> {
  const { rows } = await pool.query(
    `SELECT f.conversation_id, f.stars, f.comment, u.email, c.persona_name, f.created_at, f.updated_at > f.created_at AS edited
     FROM conversation_feedback f
     JOIN conversations c ON c.id = f.conversation_id
     JOIN "user" u ON u.id = f.user_id
     WHERE $1::text IS NULL OR c.persona_slug = $1
     ORDER BY f.created_at DESC, f.conversation_id`,
    [personaSlug ?? null],
  );
  const items: FeedbackItem[] = rows.map((r) => ({
    conversationId: r.conversation_id,
    stars: r.stars,
    comment: r.comment,
    email: r.email,
    personaName: r.persona_name,
    createdAt: new Date(r.created_at).toISOString(),
    edited: r.edited,
  }));
  return { summary: summarizeFeedback(items), items };
}
