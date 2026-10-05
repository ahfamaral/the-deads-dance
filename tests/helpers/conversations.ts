import { getPool } from "@corpus/db";
import type { VisitEnding } from "@/lib/visit";
import type { VisitorAct } from "@/lib/visitor-act";

export type SeedMessage =
  | { role: "user"; text: string; act?: VisitorAct | null }
  | { role: "persona"; text: string; ended?: VisitEnding };

/** An approved user row, inserted directly (no session). */
export async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await getPool().query(`INSERT INTO "user" (id, name, email, "emailVerified", status) VALUES ($1, '', $2, true, 'approved')`, [
    id,
    email,
  ]);
  return id;
}

/** A conversation and its messages, inserted directly, as earlier turns would have stored them. */
export async function seedConversation(opts: {
  id?: string;
  userId: string;
  personaSlug?: string;
  personaName?: string;
  ended?: VisitEnding | null;
  messages?: SeedMessage[];
}): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  const pool = getPool();
  await pool.query(`INSERT INTO conversations (id, user_id, persona_slug, persona_name, ended) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    opts.userId,
    opts.personaSlug ?? "wu",
    opts.personaName ?? "Chien-Shiung Wu",
    opts.ended ?? null,
  ]);
  for (const m of opts.messages ?? []) {
    await pool.query(
      `INSERT INTO messages (conversation_id, role, text, act, ended, tool_calls, sources)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb)`,
      [
        id,
        m.role,
        m.text,
        m.role === "user" && m.act ? JSON.stringify(m.act) : null,
        m.role === "persona" ? (m.ended ?? null) : null,
        m.role === "persona" ? "[]" : null,
        m.role === "persona" ? "[]" : null,
      ],
    );
  }
  return id;
}

/** `n` visitor/persona exchanges, every visitor message carrying `act`. */
export function exchanges(n: number, act: VisitorAct): SeedMessage[] {
  return Array.from({ length: n }, (_, i): SeedMessage[] => [
    { role: "user", text: `Q${i}`, act },
    { role: "persona", text: `A${i}` },
  ]).flat();
}

export async function messagesOf(conversationId: string) {
  const { rows } = await getPool().query(
    `SELECT role, text, act, tool_calls, sources, ended, stopped FROM messages WHERE conversation_id = $1 ORDER BY id`,
    [conversationId],
  );
  return rows;
}

export async function conversationRow(id: string) {
  return (await getPool().query(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0];
}
