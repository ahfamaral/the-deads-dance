import type { Pool } from "pg";
import { isStaleIngest, type PersonaEntry } from "./ingest";
import { findPersona, toSummary, type PersonaSummary } from "./personas";
import { slugify } from "./slug";
import { WikipediaError, type Article, type PersonFacts } from "./wikipedia";

export const MAX_TITLE_LENGTH = 200;
/** Caps embedding cost per added persona. Einstein's article is well under this. */
export const MAX_ARTICLE_CHARS = 300_000;

export type AddPersonaErrorCode =
  | "invalid_title"
  | "not_found"
  | "disambiguation"
  | "not_a_person"
  | "not_deceased"
  | "too_large"
  | "conflict"
  | "unreachable";

export class AddPersonaError extends Error {
  constructor(
    readonly code: AddPersonaErrorCode,
    message: string,
    readonly existing?: PersonaSummary,
  ) {
    super(message);
    this.name = "AddPersonaError";
  }
}

export type PrepareDeps = {
  pool: Pool;
  fetchArticle: (title: string) => Promise<Article>;
  fetchPersonFacts: (qid: string) => Promise<PersonFacts>;
};
export type PreparedPersona = { entry: PersonaEntry; article: Article };

async function wiki<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof WikipediaError) throw new AddPersonaError(err.code, err.message);
    throw err;
  }
}

/** Every check runs before anything is embedded, so a rejected title costs nothing. */
export async function prepareUserPersona(rawTitle: string, deps: PrepareDeps): Promise<PreparedPersona> {
  const title = rawTitle.trim();
  if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
    throw new AddPersonaError("invalid_title", `Enter a Wikipedia title of 1–${MAX_TITLE_LENGTH} characters.`);
  }

  const article = await wiki(() => deps.fetchArticle(title));
  if (!article.qid) {
    throw new AddPersonaError("not_a_person", `"${article.title}" has no Wikidata entry, so it can't be confirmed as a person.`);
  }
  if (article.text.length > MAX_ARTICLE_CHARS) {
    throw new AddPersonaError("too_large", `"${article.title}" is too long to add (over ${MAX_ARTICLE_CHARS.toLocaleString("en")} characters).`);
  }

  const qid = article.qid;
  const facts = await wiki(() => deps.fetchPersonFacts(qid));
  if (!facts.isHuman) {
    throw new AddPersonaError("not_a_person", `"${article.title}" isn't an article about a person.`);
  }
  if (!facts.isDeceased) {
    throw new AddPersonaError(
      "not_deceased",
      `"${article.title}" is about a living person. Only people who have died can be added.`,
    );
  }

  const slug = slugify(article.title, qid);
  const existing = await findPersona(deps.pool, slug);
  if (existing?.origin === "curated" && existing.status !== "ready") {
    // A ready curated row is handled by the check below, which keeps the "already in the list" message.
    throw new AddPersonaError("conflict", `${existing.displayName} is built in — run \`npm run ingest\` to restore it.`);
  }
  if (existing?.status === "ready") {
    throw new AddPersonaError("conflict", `${existing.displayName} is already in the list.`, toSummary(existing));
  }
  if (existing?.status === "ingesting" && !isStaleIngest(existing)) {
    throw new AddPersonaError("conflict", `${existing.displayName} is already being added.`);
  }

  return {
    entry: {
      slug,
      wikipediaTitle: article.title,
      displayName: article.title,
      description: facts.description,
      lifespan: facts.lifespan,
      origin: "user",
    },
    article,
  };
}
