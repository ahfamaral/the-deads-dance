import type { Pool } from "pg";
import { toVectorLiteral } from "./db";

export type SearchHit = { chunkId: number; sectionHeading: string; content: string; score: number;
  /** Spec §34.6: ISO 639-1 of the source the passage came from; 'en' when it has none. */
  language: string;
};

/**
 * Nearest chunks for one persona by cosine similarity. The shared building block the
 * MCP server's retrieval (multi-query + RRF) calls once per query variant.
 */
export async function searchChunks(
  pool: Pool,
  params: { personaSlug: string; embedding: number[]; topK: number },
): Promise<SearchHit[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // HNSW finds neighbours across all personas before the persona filter applies, so a
    // small persona could get fewer than topK rows. Iterative scans keep going until the
    // filter is satisfied (pgvector >= 0.8).
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    const { rows } = await client.query<{ id: number; section_heading: string; content: string; score: number; language: string }>(
      `SELECT c.id, c.section_heading, c.content, 1 - (c.embedding <=> $1::vector) AS score,
              COALESCE(s.language, 'en') AS language
       FROM chunks c JOIN personas p ON p.id = c.persona_id
       LEFT JOIN persona_sources s ON s.id = c.source_id
       WHERE p.slug = $2 AND p.status = 'ready'
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3`,
      [toVectorLiteral(params.embedding), params.personaSlug, params.topK],
    );
    await client.query("COMMIT");
    // relaxed_order may return rows slightly out of order; re-sort exactly.
    return rows
      .map((r) => ({ chunkId: r.id, sectionHeading: r.section_heading, content: r.content,
        score: Number(r.score),
        language: r.language,
      }))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
