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

-- 2026-10-16: the admin hides a persona from testers' picker; testers can't start new visits with it.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- Spec §18.4 fix (2026-10-08): Wikidata lists Spanish for Max Planck with rank "deprecated", which the
-- old reader didn't skip, so the v1 seed made him a native Spanish speaker. Only that exact value changes.
UPDATE personas SET languages = '[{"code": "de", "name": "German", "native": true}]'::jsonb
 WHERE wikidata_qid = 'Q9021'
   AND languages = '[{"code": "es", "name": "Spanish", "native": true}, {"code": "de", "name": "German", "native": false}]'::jsonb;

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

-- Spec §24.2: Better Auth 1.7.7's tables (emailOTP, admin, database rate limit), camelCase as it expects.
-- Its runtime schema check compares against these, so keep names and types as generated.
CREATE TABLE IF NOT EXISTS "user" (
  "id"              text NOT NULL PRIMARY KEY,
  "name"            text NOT NULL,
  "email"           text NOT NULL UNIQUE,
  "emailVerified"   boolean NOT NULL,
  "image"           text,
  "createdAt"       timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"       timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "role"            text,
  "banned"          boolean DEFAULT false,
  "banReason"       text,
  "banExpires"      timestamptz,
  "status"          text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'blocked')),
  "statusChangedAt" timestamptz,
  "statusChangedBy" text
);

-- Added after the table shipped, so as idempotent constraints (CREATE TABLE IF NOT EXISTS won't
-- add them to an existing table). Better Auth's schema check compares columns only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_role_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK ("role" IN ('user', 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_statusChangedBy_fkey') THEN
    -- A changer who no longer exists would block the key; "nobody we know" is null.
    UPDATE "user" u SET "statusChangedBy" = NULL
    WHERE "statusChangedBy" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "user" b WHERE b.id = u."statusChangedBy");
    ALTER TABLE "user" ADD CONSTRAINT "user_statusChangedBy_fkey"
      FOREIGN KEY ("statusChangedBy") REFERENCES "user" ("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "session" (
  "id"             text NOT NULL PRIMARY KEY,
  "expiresAt"      timestamptz NOT NULL,
  "token"          text NOT NULL UNIQUE,
  "createdAt"      timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"      timestamptz NOT NULL,
  "ipAddress"      text,
  "userAgent"      text,
  "userId"         text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "impersonatedBy" text
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    text NOT NULL PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"             timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt"  timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id"          text NOT NULL PRIMARY KEY,
  "key"         text NOT NULL UNIQUE,
  "count"       integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- Spec §24.4: codes sent per email, for the per-email limit Better Auth doesn't have.
CREATE TABLE IF NOT EXISTS otp_send_log (
  email   text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_send_log_email_sent_at ON otp_send_log (email, sent_at);

-- Spec §25.2: conversations and their messages, owned by the user. Hard delete: deleting a
-- conversation deletes its messages, and deleting a user deletes their conversations.
CREATE TABLE IF NOT EXISTS conversations (
  id           uuid PRIMARY KEY,
  user_id      text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  persona_slug text NOT NULL,
  persona_name text NOT NULL,
  ended        text CHECK (ended IN ('farewell', 'tired', 'offended')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'persona')),
  text            text NOT NULL,
  act             jsonb,
  tool_calls      jsonb,
  sources         jsonb,
  ended           text CHECK (ended IN ('farewell', 'tired', 'offended')),
  stopped         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_id ON messages (conversation_id, id);

-- Spec §26.2: energy in micro-dollars ($1 = 1,000,000). Better Auth extra fields, camelCase like "status".
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "energyBalance" bigint NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "energyFull" bigint NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "energyWarningRead" smallint NOT NULL DEFAULT 100;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_energyWarningRead_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_energyWarningRead_check" CHECK ("energyWarningRead" IN (100, 50, 20, 10, 0));
  END IF;
END $$;

-- Spec §26.2: running totals for the admin, and the one-turn-at-a-time flag (§26.4).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS cost bigint NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tokens integer NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS turn_running_since timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cost bigint;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens integer;

-- Spec §26.2: one row per model call. A deleted conversation keeps its calls (the money was spent).
CREATE TABLE IF NOT EXISTS model_calls (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  message_id      bigint REFERENCES messages (id) ON DELETE SET NULL,
  persona_slug    text,
  role            text NOT NULL CHECK (role IN ('agent', 'classifier', 'helper', 'recall', 'embedding', 'ingest', 'tts')),
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost            bigint NOT NULL,
  cost_source     text NOT NULL CHECK (cost_source IN ('reported', 'estimated')),
  generation_id   text,
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_calls_created_at ON model_calls (created_at);
CREATE INDEX IF NOT EXISTS model_calls_user_created_at ON model_calls (user_id, created_at);
CREATE INDEX IF NOT EXISTS model_calls_conversation_id ON model_calls (conversation_id);
CREATE INDEX IF NOT EXISTS model_calls_message_id ON model_calls (message_id);

-- Spec §26.2: where energy came from, one row per approval grant or top-up.
CREATE TABLE IF NOT EXISTS energy_grants (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  amount     bigint NOT NULL CHECK (amount > 0),
  granted_by text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO settings (key, value) VALUES ('default_starting_energy', '1000000') ON CONFLICT (key) DO NOTHING;

-- Spec §32.2: one rating per conversation, deleted with it (hard delete, §25.2). model and
-- commit_sha are the config at the first save; an edit changes only stars, comment and updated_at.
CREATE TABLE IF NOT EXISTS conversation_feedback (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text NOT NULL DEFAULT '' CHECK (length(comment) <= 200),
  model      text NOT NULL,
  commit_sha text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_feedback_created ON conversation_feedback (created_at DESC);

-- Spec §33.2: model_calls.role gains 'tts'. The inline CHECK above is named model_calls_role_check;
-- databases created before this keep the old list, so replace it (idempotent).
ALTER TABLE model_calls DROP CONSTRAINT IF EXISTS model_calls_role_check;
ALTER TABLE model_calls ADD CONSTRAINT model_calls_role_check
  CHECK (role IN ('agent', 'classifier', 'helper', 'recall', 'embedding', 'ingest', 'tts'));

-- Spec §33.2: one designed voice per persona. No voice row = no voice.
CREATE TABLE IF NOT EXISTS persona_voices (
  persona_slug text PRIMARY KEY REFERENCES personas (slug) ON DELETE CASCADE,
  base_voice   text NOT NULL,             -- a Gemini voice name, e.g. 'Algenib'
  description  text NOT NULL CHECK (length(description) BETWEEN 1 AND 600),
  sample_text  text NOT NULL,             -- what the sample says, in the native language
  sample_audio bytea,                     -- the last generated sample (WAV); null until generated
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- The persona's sex as the draft judged it; picks which base voices the admin sees first. Null for older voices.
ALTER TABLE persona_voices ADD COLUMN IF NOT EXISTS sex text CHECK (sex IN ('male','female'));

-- Spec §33.2: how a conversation is held; set by its first turn, never changed.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'text'
  CHECK (mode IN ('text','voice'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS voice_language text; -- ISO 639-1, voice only
