/**
 * Spec §34.6: what a round will do to a persona's memory, item by item. Server-free (type-only
 * imports), so the browser's "Review changes" step uses the same rules as the round runner.
 */
import type { SourceRef } from "./rounds";

/** The admin's choice for one round: the main article, the ticked extras and their estimates (micro-dollars). */
export type SourcePlan = {
  article: SourceRef & { kind: "article"; site: "wikipedia" };
  extras: (SourceRef & { estimated: number })[];
  articleEstimated: number;
  redraft: boolean;
  redraftEstimated: number;
};

export type PlannedChange = { action: "added" | "replaced" | "removed" | "kept"; ref: SourceRef; replaces?: SourceRef };

/** One key per source: two refs with the same key are the same page. */
export const sourceKey = (r: SourceRef): string => `${r.kind}:${r.site}:${r.language}:${r.title}`;

const refOf = (r: SourceRef): SourceRef => ({ kind: r.kind, site: r.site, language: r.language, title: r.title });

/**
 * The article first (a different one `replaced`, the same one `kept`, none yet `added`), then the
 * ticked extras in plan order (`kept` when already stored, else `added`), then the stored extras
 * no longer ticked (`removed`). A source ticked twice counts once.
 */
export function planChanges(current: readonly SourceRef[], plan: SourcePlan): PlannedChange[] {
  const changes: PlannedChange[] = [];
  const article = refOf(plan.article);
  const currentArticle = current.find((s) => s.kind === "article");
  if (!currentArticle) changes.push({ action: "added", ref: article });
  else if (sourceKey(currentArticle) === sourceKey(article)) changes.push({ action: "kept", ref: article });
  else changes.push({ action: "replaced", ref: article, replaces: refOf(currentArticle) });

  const stored = new Set(current.filter((s) => s.kind !== "article").map(sourceKey));
  const ticked = new Set<string>();
  for (const extra of plan.extras) {
    const key = sourceKey(extra);
    if (ticked.has(key)) continue;
    ticked.add(key);
    changes.push({ action: stored.has(key) ? "kept" : "added", ref: refOf(extra) });
  }
  for (const source of current) {
    if (source.kind !== "article" && !ticked.has(sourceKey(source))) changes.push({ action: "removed", ref: refOf(source) });
  }
  return changes;
}
