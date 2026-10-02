-- Idempotent: safe to apply on every `npm run db:setup`.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS personas (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  description     text NOT NULL DEFAULT '',
  lifespan        text NOT NULL DEFAULT '',
  wikipedia_title text NOT NULL,
  wikipedia_revid bigint,
  wikidata_qid    text,
  source_text     text,
  profile         jsonb,
  profile_stamp   text,
  languages       jsonb,
  origin          text NOT NULL CHECK (origin IN ('curated', 'user')),
  status          text NOT NULL CHECK (status IN ('ingesting', 'ready', 'failed')),
  build_stamp     text,
  ingested_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Spec §17.1: databases created before the character profile replaced the voice notes.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS profile jsonb;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS profile_stamp text;
ALTER TABLE personas DROP COLUMN IF EXISTS system_prompt;

-- Spec §18.4: languages from Wikidata or a pinned list; null until fetched.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS languages jsonb;

CREATE TABLE IF NOT EXISTS chunks (
  id              serial PRIMARY KEY,
  persona_id      int NOT NULL REFERENCES personas (id) ON DELETE CASCADE,
  section_heading text NOT NULL,
  ordinal         int NOT NULL,
  content         text NOT NULL,
  embedding       vector(1536) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_persona_id ON chunks (persona_id);
