import type { Pool } from "pg";
import type { VoiceStatus } from "@/lib/voice";

/** Spec §33.2: every query on `persona_voices`. */
type Queryable = Pick<Pool, "query">;

export type StoredVoice = {
  personaSlug: string;
  baseVoice: string;
  description: string;
  sampleText: string;
  sampleAudio: Buffer | null;
  sex: "male" | "female" | null;
  status: VoiceStatus;
  updatedAt: Date;
};

export async function findVoice(db: Queryable, slug: string): Promise<StoredVoice | null> {
  const { rows } = await db.query(
    `SELECT persona_slug, base_voice, description, sample_text, sample_audio, sex, status, updated_at
     FROM persona_voices WHERE persona_slug = $1`,
    [slug],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    personaSlug: r.persona_slug,
    baseVoice: r.base_voice,
    description: r.description,
    sampleText: r.sample_text,
    sampleAudio: r.sample_audio ?? null,
    sex: r.sex ?? null,
    status: r.status,
    updatedAt: r.updated_at,
  };
}

/** False when the persona already has a voice. */
export async function insertVoice(
  db: Queryable,
  v: { personaSlug: string; baseVoice: string; description: string; sampleText: string; sex?: "male" | "female" | null },
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO persona_voices (persona_slug, base_voice, description, sample_text, sex)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (persona_slug) DO NOTHING`,
    [v.personaSlug, v.baseVoice, v.description, v.sampleText, v.sex ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Spec §33.2: any edit of the voice or its description sends it back to draft and drops the sample, which no longer matches the form. */
export async function updateVoice(
  db: Queryable,
  slug: string,
  patch: { baseVoice?: string; description?: string },
): Promise<boolean> {
  const res = await db.query(
    `UPDATE persona_voices
     SET base_voice = COALESCE($2, base_voice), description = COALESCE($3, description),
         sample_audio = CASE WHEN $2::text IS NULL AND $3::text IS NULL THEN sample_audio ELSE NULL END,
         status = 'draft', approved_at = NULL, updated_at = now()
     WHERE persona_slug = $1`,
    [slug, patch.baseVoice ?? null, patch.description ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setSample(db: Queryable, slug: string, audio: Buffer): Promise<void> {
  await db.query(`UPDATE persona_voices SET sample_audio = $2, updated_at = now() WHERE persona_slug = $1`, [slug, audio]);
}

/** False when there is no voice or no sample to approve. */
export async function approveVoice(db: Queryable, slug: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE persona_voices SET status = 'approved', approved_at = now(), updated_at = now()
     WHERE persona_slug = $1 AND sample_audio IS NOT NULL`,
    [slug],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function deleteVoice(db: Queryable, slug: string): Promise<boolean> {
  const res = await db.query(`DELETE FROM persona_voices WHERE persona_slug = $1`, [slug]);
  return (res.rowCount ?? 0) > 0;
}

export async function approvedVoiceSlugs(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query(`SELECT persona_slug FROM persona_voices WHERE status = 'approved'`);
  return new Set(rows.map((r) => r.persona_slug as string));
}

/** For the admin picker: every persona that has a voice, with its status. */
export async function voiceStatuses(db: Queryable): Promise<Map<string, VoiceStatus>> {
  const { rows } = await db.query(`SELECT persona_slug, status FROM persona_voices`);
  return new Map(rows.map((r) => [r.persona_slug as string, r.status as VoiceStatus]));
}
