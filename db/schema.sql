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
