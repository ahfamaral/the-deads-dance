import type { Pool } from "pg";
import { wikiHost, type WikiSite } from "./wikimedia";

type Queryable = Pick<Pool, "query">;

/** Spec §34.2: a running round older than this counts as failed (the function was killed). */
export const STALE_INGEST_MINUTES = 10;

export type SourceKind = "article" | "writing" | "quotes" | "linked" | "mention";
export type SourceRef = { kind: SourceKind; site: WikiSite; language: string; title: string };
export type StoredSource = SourceRef & { id: number; revid: number | null; url: string; passages: number; roundId: number };

/** Spec §34.3: how one edition of the main article scored. */
export type EditionScore = { language: string; title: string; words: number; badge: "featured" | "good" | null; answered: number; total: number };

export type RoundStatus = "draft" | "running" | "done" | "failed";
export type ItemAction = "compared" | "added" | "replaced" | "removed" | "kept" | "redrafted";
/** Costs and estimates are micro-dollars; null where not recorded. */
export type RoundItem = {
  id: number;
  action: ItemAction;
  label: string;
  passages: number | null;
  estimated: number | null;
  cost: number | null;
  /** Spec §34.2: one of its calls' costs is an estimate (embeddings report none), so the cost is shown as one. */
  costEstimated: boolean;
};
export type Round = {
  id: number;
  number: number;
  status: RoundStatus;
  startedAt: Date;
  finishedAt: Date | null;
  comparison: EditionScore[] | null;
  items: RoundItem[];
};

/** Spec §34.2: another round is already running for this persona. */
export class RoundBusyError extends Error {
  readonly code = "round_running";
  constructor() {
    super("A round is already running for this persona.");
    this.name = "RoundBusyError";
  }
}

export { sourceKey } from "./plan-changes";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Spec §34.2: the persona's current sources, oldest first. */
export async function listSources(db: Queryable, personaId: number): Promise<StoredSource[]> {
  const { rows } = await db.query(
    `SELECT id, kind, site, language, title, revid, url, passages, round_id FROM persona_sources WHERE persona_id = $1 ORDER BY id`,
    [personaId],
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, site: r.site, language: r.language, title: r.title,
    revid: num(r.revid), url: r.url, passages: r.passages, roundId: r.round_id,
  }));
}

/** Spec §34.2: a persona's rounds, newest first, each with its items in insertion order. */
export async function listRounds(db: Queryable, slug: string): Promise<Round[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.number, r.status, r.started_at, r.finished_at, r.comparison,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'action', i.action, 'label', i.label,
                  'passages', i.passages, 'estimated', i.estimated, 'cost', i.cost,
                  'cost_estimated', EXISTS (SELECT 1 FROM model_calls m WHERE m.ingest_item_id = i.id AND m.cost_source = 'estimated'))
                  ORDER BY i.id)
                 FROM ingest_round_items i WHERE i.round_id = r.id), '[]'::jsonb) AS items
     FROM ingest_rounds r WHERE r.persona_slug = $1 ORDER BY r.number DESC`,
    [slug],
  );
  return rows.map(toRound);
}

/** Spec §34.2: one of the round's calls has an estimated cost (embeddings report none), so its cost is shown as about. */
export async function roundHasEstimatedCost(db: Queryable, roundId: number): Promise<boolean> {
  const { rows } = await db.query<{ estimated: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM model_calls m JOIN ingest_round_items i ON i.id = m.ingest_item_id
                    WHERE i.round_id = $1 AND m.cost_source = 'estimated') AS estimated`,
    [roundId],
  );
  return rows[0].estimated;
}

/** Spec §34.2: the persona's running round, if any. */
export async function runningRound(db: Queryable, slug: string): Promise<Round | null> {
  return (await listRounds(db, slug)).find((r) => r.status === "running") ?? null;
}

function toRound(r: Record<string, unknown>): Round {
  const items = (r.items as Record<string, unknown>[]).map((i) => ({
    id: i.id as number, action: i.action as ItemAction, label: i.label as string,
    passages: num(i.passages), estimated: num(i.estimated), cost: num(i.cost), costEstimated: i.cost_estimated === true,
  }));
  return {
    id: r.id as number, number: r.number as number, status: r.status as RoundStatus,
    startedAt: r.started_at as Date, finishedAt: (r.finished_at as Date | null) ?? null,
    comparison: (r.comparison as EditionScore[] | null) ?? null, items,
  };
}

const NEXT_NUMBER = `(SELECT coalesce(max(number), 0) + 1 FROM ingest_rounds WHERE persona_slug = $1)`;

/**
 * Spec §34.2: the persona's draft round (a comparison not yet ingested), created if none. Race-safe:
 * a partial unique index allows one draft, and a lost race (on the draft or the round number) re-reads.
 */
export async function draftRound(db: Queryable, slug: string, adminId: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await db.query(`SELECT id FROM ingest_rounds WHERE persona_slug = $1 AND status = 'draft'`, [slug]);
    if (found.rows[0]) return found.rows[0].id;
    const { rows } = await db.query(
      `INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ($1, ${NEXT_NUMBER}, 'draft', $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [slug, adminId],
    );
    if (rows[0]) return rows[0].id;
  }
  throw new Error("Could not create a draft round.");
}

/** Spec §34.3: keeps the scores on the round and the compare cost as a `compared` item; returns the item's id. */
export async function saveComparison(
  db: Queryable,
  roundId: number,
  scores: EditionScore[],
  item: { label: string; estimated: number; cost: number },
): Promise<number> {
  await db.query(`UPDATE ingest_rounds SET comparison = $2::jsonb WHERE id = $1`, [roundId, JSON.stringify(scores)]);
  return addItem(db, roundId, { action: "compared", label: item.label, passages: null, estimated: item.estimated, cost: item.cost });
}

/**
 * Spec §34.2: takes the reingest lock. Stale running rounds are failed first; the draft is promoted,
 * or a new round inserted. Throws RoundBusyError when one is still running.
 */
export async function startRound(db: Queryable, slug: string, adminId: string): Promise<number> {
  await db.query(
    `UPDATE ingest_rounds SET status = 'failed', finished_at = now()
     WHERE persona_slug = $1 AND status = 'running' AND started_at < now() - make_interval(mins => $2)`,
    [slug, STALE_INGEST_MINUTES],
  );
  try {
    const promoted = await db.query(
      `UPDATE ingest_rounds SET status = 'running', started_by = $2, started_at = now()
       WHERE persona_slug = $1 AND status = 'draft' RETURNING id`,
      [slug, adminId],
    );
    if (promoted.rows[0]) return promoted.rows[0].id;
    const { rows } = await db.query(
      `INSERT INTO ingest_rounds (persona_slug, number, status, started_by) VALUES ($1, ${NEXT_NUMBER}, 'running', $2) RETURNING id`,
      [slug, adminId],
    );
    return rows[0].id;
  } catch (err) {
    // Two concurrent starts can collide on the round number before the running index; either way, one lost.
    if ((err as { code?: string; table?: string }).code === "23505" && (err as { table?: string }).table === "ingest_rounds") throw new RoundBusyError();
    throw err;
  }
}

export async function addItem(db: Queryable, roundId: number, item: Omit<RoundItem, "id" | "costEstimated">): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO ingest_round_items (round_id, action, label, passages, estimated, cost) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [roundId, item.action, item.label, item.passages, item.estimated, item.cost],
  );
  return rows[0].id;
}

/** Spec §34.6: an item's label and passages once its source is chunked. */
export async function updateItem(db: Queryable, itemId: number, item: { label: string; passages: number | null }): Promise<void> {
  await db.query(`UPDATE ingest_round_items SET label = $2, passages = $3 WHERE id = $1`, [itemId, item.label, item.passages]);
}

export async function setItemCost(db: Queryable, itemId: number, cost: number): Promise<void> {
  await db.query(`UPDATE ingest_round_items SET cost = $2 WHERE id = $1`, [itemId, cost]);
}

/** Spec §34.2: a round recorded after the fact (the CLI ingest), already done. */
export async function insertFinishedRound(db: Queryable, slug: string, startedBy: string): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO ingest_rounds (persona_slug, number, status, started_by, finished_at) VALUES ($1, ${NEXT_NUMBER}, 'done', $2, now()) RETURNING id`,
    [slug, startedBy],
  );
  return rows[0].id;
}

/** A page's address on its site, e.g. https://pt.wikipedia.org/wiki/Get%C3%BAlio_Vargas. */
export function sourceUrl(ref: Pick<SourceRef, "site" | "language" | "title">): string {
  const path = encodeURIComponent(ref.title.replaceAll(" ", "_")).replaceAll("%2F", "/").replaceAll("%3A", ":");
  return `https://${wikiHost(ref)}/wiki/${path}`;
}

/** Spec §34.2: stores one ingested source; its chunks point at the returned id. */
export async function insertSource(
  db: Queryable,
  personaId: number,
  roundId: number,
  source: SourceRef & { revid: number | null; passages: number },
): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO persona_sources (persona_id, kind, language, site, title, revid, url, passages, round_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [personaId, source.kind, source.language, source.site, source.title, source.revid, sourceUrl(source), source.passages, roundId],
  );
  return rows[0].id;
}

export async function finishRound(db: Queryable, roundId: number, status: "done" | "failed"): Promise<void> {
  await db.query(`UPDATE ingest_rounds SET status = $2, finished_at = now() WHERE id = $1`, [roundId, status]);
}
