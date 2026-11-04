import type { Pool } from "pg";
import type { Spend } from "@/lib/chat-types";
import type { ResolvedCall } from "./pricing";

type Queryable = Pick<Pool, "query">;
const spend = (cost: unknown, tokens: unknown): Spend => ({ cost: Number(cost ?? 0), tokens: Number(tokens ?? 0) });

/**
 * Spec §26.3, §26.4: calls with no reply to hang on (ingest, or a turn refused after the classifier ran).
 * One statement: log, and charge when asked.
 */
export async function recordCalls(
  pool: Queryable,
  r: { userId: string; calls: ResolvedCall[]; charge: boolean; personaSlug?: string | null; ingestItemId?: number | null },
): Promise<void> {
  if (r.calls.length === 0) return;
  const total = r.calls.reduce((n, c) => n + c.cost, 0);
  await pool.query(
    `WITH logged AS (
       INSERT INTO model_calls (user_id, persona_slug, role, model, input_tokens, output_tokens, cost, cost_source, generation_id, latency_ms, ingest_item_id)
       SELECT $1, $2, c.role, c.model, c.input_tokens, c.output_tokens, c.cost, c.cost_source, c.generation_id, c.latency_ms, $6::int
       FROM jsonb_to_recordset($3::jsonb) AS c(role text, model text, input_tokens int, output_tokens int, cost bigint, cost_source text, generation_id text, latency_ms int)
     )
     UPDATE "user" SET "energyBalance" = "energyBalance" - $4::bigint WHERE id = $1 AND $5::boolean`,
    [
      r.userId,
      r.personaSlug ?? null,
      JSON.stringify(r.calls.map((c) => ({ role: c.role, model: c.model, input_tokens: c.inputTokens, output_tokens: c.outputTokens, cost: c.cost, cost_source: c.costSource, generation_id: c.generationId, latency_ms: c.latencyMs }))),
      total,
      r.charge,
      r.ingestItemId ?? null,
    ],
  );
}

/** Spec §26.6: the admin's own spend today (UTC), for the picker. */
export async function spendToday(pool: Queryable, userId: string): Promise<Spend> {
  const { rows } = await pool.query(
    `SELECT sum(cost) AS cost, sum(input_tokens + output_tokens) AS tokens FROM model_calls
     WHERE user_id = $1 AND created_at >= date_trunc('day', now(), 'UTC')`,
    [userId],
  );
  return spend(rows[0].cost, rows[0].tokens);
}

/** Spec §26.6: logged spend for today, this week and this month, in UTC like OpenRouter's. */
export async function loggedSpend(pool: Queryable): Promise<{ today: Spend; week: Spend; month: Spend }> {
  const { rows } = await pool.query(
    `SELECT
       sum(cost) FILTER (WHERE created_at >= date_trunc('day', now(), 'UTC')) AS today_cost,
       sum(input_tokens + output_tokens) FILTER (WHERE created_at >= date_trunc('day', now(), 'UTC')) AS today_tokens,
       sum(cost) FILTER (WHERE created_at >= date_trunc('week', now(), 'UTC')) AS week_cost,
       sum(input_tokens + output_tokens) FILTER (WHERE created_at >= date_trunc('week', now(), 'UTC')) AS week_tokens,
       sum(cost) FILTER (WHERE created_at >= date_trunc('month', now(), 'UTC')) AS month_cost,
       sum(input_tokens + output_tokens) FILTER (WHERE created_at >= date_trunc('month', now(), 'UTC')) AS month_tokens
     FROM model_calls
     WHERE created_at >= least(date_trunc('week', now(), 'UTC'), date_trunc('month', now(), 'UTC'))`,
  );
  const r = rows[0];
  return { today: spend(r.today_cost, r.today_tokens), week: spend(r.week_cost, r.week_tokens), month: spend(r.month_cost, r.month_tokens) };
}

/** Spec §26.6: the energy approved testers still hold (overdrafts count as 0), for the credit warning. */
export async function heldEnergy(pool: Queryable): Promise<number> {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(greatest("energyBalance", 0)), 0) AS held FROM "user" WHERE status = 'approved' AND role IS DISTINCT FROM 'admin'`,
  );
  return Number(rows[0].held);
}
