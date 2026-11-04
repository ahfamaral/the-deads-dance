import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Pool } from "pg";
import { getPool } from "@corpus/db";
import { passageTranslator, type TranslateFn } from "./passage-translations";
import { resolveCosts } from "./pricing";

export type TranslateDeps = {
  pool: Pool;
  /** One translator per request; its ledger handler comes in `callbacks`. */
  translator: (callbacks: BaseCallbackHandler[]) => TranslateFn;
  resolveCosts: typeof resolveCosts;
};

/** The real dependencies for the translate route. Route tests replace this module. */
export function translateDeps(): TranslateDeps {
  return { pool: getPool(), translator: (callbacks) => passageTranslator({ callbacks }), resolveCosts };
}
