import { Pool } from "pg";

// Kept on globalThis so Next.js dev reloads reuse one pool instead of leaking one per reload.
const holder = globalThis as unknown as { personaPool?: Pool };

export function getPool(): Pool {
  if (!holder.personaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Add it to .env.");
    }
    holder.personaPool = new Pool({ connectionString });
  }
  return holder.personaPool;
}

export async function closePool(): Promise<void> {
  const pool = holder.personaPool;
  holder.personaPool = undefined;
  await pool?.end();
}

/** Spec §31.4: the schema step on Vercel uses Neon's direct URL; the pooled one is for the app. */
export function deployDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) throw new Error("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set.");
  return url;
}

/** pgvector's text input format. Pass it as a parameter and cast with `::vector`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function errorCodes(err: unknown): string[] {
  if (typeof err !== "object" || err === null) return [];
  const own = "code" in err && typeof err.code === "string" ? [err.code] : [];
  // Node reports a refused connection to "localhost" as an AggregateError over ::1 and 127.0.0.1.
  const nested = err instanceof AggregateError ? err.errors.flatMap(errorCodes) : [];
  return [...own, ...nested];
}

/** A human hint for the database failures a reviewer is likely to hit, or null for anything else. */
export function describeDbError(err: unknown): string | null {
  const codes = errorCodes(err);
  if (codes.includes("ECONNREFUSED")) {
    return "Can't reach Postgres at DATABASE_URL — is `docker-compose up` running?";
  }
  if (codes.includes("42P01")) {
    return "The database schema is missing — run `npm run db:setup`.";
  }
  if (codes.includes("3D000")) {
    return "The database named in DATABASE_URL doesn't exist — check .env against docker-compose.yml.";
  }
  return null;
}
