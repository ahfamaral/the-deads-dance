import { afterAll, expect, it } from "vitest";
import { closePool, getPool } from "@corpus/db";
import { embeddingModel } from "@corpus/embeddings";
import { chatModel } from "@corpus/models";
import { expandQueryWith, retrieve, type RetrievalDeps } from "../../mcp-server/biography/retrieval";
import { loadDevEnv } from "./live-env";

// Opt-in (`npm run test:live`). The evidence for "advanced RAG" (spec §11): multi-query +
// RRF must recall at least as many expected sections as single-query retrieval.
loadDevEnv();
afterAll(() => closePool());

/** Question → the section of the dev database that answers it. Worded unlike the section on purpose. */
const GOLDEN = [
  { persona: "albert-einstein", question: "What did you do while working as a clerk examining inventions?", section: "Assistant at the Swiss Patent Office (1902–1909)" },
  { persona: "albert-einstein", question: "Why did you leave Germany for America?", section: "Immigration to the US (1933)" },
  { persona: "chien-shiung-wu", question: "How did you show that nature can tell left from right?", section: "Parity experiment" },
  { persona: "chien-shiung-wu", question: "What secret wartime work did you do at Columbia?", section: "World War II and the Manhattan Project" },
  { persona: "george-washington-carver", question: "What did you make out of peanuts?", section: "Peanut products" },
  { persona: "george-washington-carver", question: "Why did Booker T. Washington bring you to Alabama?", section: "Tuskegee Institute" },
  { persona: "katherine-johnson", question: "How did you help John Glenn orbit the Earth?", section: "Career" },
  { persona: "alberto-santos-dumont", question: "Which of your airships flew around the Eiffel Tower to win a prize?", section: "No. 5 and No. 6" },
];

async function recall(deps: RetrievalDeps): Promise<{ hits: number; missed: string[] }> {
  let hits = 0;
  const missed: string[] = [];
  for (const g of GOLDEN) {
    const result = await retrieve(deps, { query: g.question, personaSlug: g.persona, topK: 3 });
    if (result.status === "ok" && result.passages.some((p) => p.section_heading === g.section)) hits++;
    else missed.push(g.question);
  }
  return { hits, missed };
}

it("multi-query + RRF recalls at least as many golden sections as single-query", async () => {
  const base = { pool: getPool(), embeddings: embeddingModel() };
  const single = await recall({ ...base, expandQuery: async () => [] });
  const multi = await recall({ ...base, expandQuery: expandQueryWith(chatModel("helper")) });
  console.log(
    `golden recall@3: single-query ${single.hits}/${GOLDEN.length}, multi-query + RRF ${multi.hits}/${GOLDEN.length}`,
    { singleMissed: single.missed, multiMissed: multi.missed },
  );
  expect(multi.hits).toBeGreaterThanOrEqual(single.hits);
}, 300_000);
