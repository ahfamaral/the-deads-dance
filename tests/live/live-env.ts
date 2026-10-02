import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Live tests use .env — the dev database (with the curated personas) and the real
 * OpenRouter key — overriding vitest's persona_test DATABASE_URL.
 */
export function loadDevEnv(): void {
  let text: string;
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    throw new Error("tests/live needs a .env with OPENROUTER_API_KEY and DATABASE_URL — copy .env.example to .env and fill it in.");
  }
  Object.assign(process.env, parseEnv(text));
}
