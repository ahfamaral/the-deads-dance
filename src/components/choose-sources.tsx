"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { languageName } from "@corpus/languages";
import { sourceKey, type SourcePlan } from "@corpus/plan-changes";
import type { EditionScore, SourceRef } from "@corpus/rounds";
import { about, ALERT, BODY, BTN, BTN_PRIMARY, CARD, H2, MUTED, TAG, TAG_CHANGE } from "@/components/admin-styles";
import MentionByTitle from "@/components/mention-by-title";
import { formatDollars } from "@/lib/money";
import {
  CANDIDATE_PAGE, describeChanges, MAX_PLAN_EXTRAS,
  type CandidateDto, type CandidatesResult, type EditionDto, type ExtraKind, type SourceDto,
} from "@/lib/persona-profile";

const KINDS: { kind: ExtraKind; label: string; hint: string }[] = [
  { kind: "writing", label: "Own writings", hint: "Works on Wikisource." },
  { kind: "quotes", label: "Real quotes", hint: "Sourced quotes from Wikiquote." },
  { kind: "linked", label: "Linked articles", hint: "Pages the main article links to, most relevant first." },
  { kind: "mention", label: "Where others mention them", hint: "Only the paragraphs that name them are kept, most relevant first." },
];

/** A rough size for an estimate's sake: about six characters a word, spaces included. */
const wordsOf = (chars: number) => Math.max(1, Math.round(chars / 6));

/** Spec §34.5: the languages each list is grouped by: the main edition's first, then the persona's, English, and any others in use. */
export function languageGroups(main: string, languages: readonly string[], others: readonly string[] = []): string[] {
  return [...new Set([main, ...languages, "en", ...others])];
}

type Option = {
  /** The radio's value: the language, or the stored article's own when no listed edition is it. */
  value: string;
  language: string;
  title: string;
  words: number | null;
  badge: EditionDto["badge"];
  estimated: number;
  redraftEstimated: number;
  score: EditionScore | null;
  inUse: boolean;
};

/** The editions, best scored first when compared, plus the stored article when no edition is it (a renamed page). */
function editionOptions(editions: readonly EditionDto[], scores: readonly EditionScore[] | null, inUse: SourceDto | undefined): Option[] {
  const scoreOf = (e: EditionDto) => scores?.find((s) => s.language === e.language) ?? null;
  const options: Option[] = editions.map((e) => ({
    value: e.language,
    language: e.language,
    title: e.title,
    words: e.words,
    badge: e.badge,
    estimated: e.estimated,
    redraftEstimated: e.redraftEstimated,
    score: scoreOf(e),
    inUse: inUse !== undefined && inUse.language === e.language && inUse.title === e.title,
  }));
  if (scores) {
    const rank = (o: Option) => (o.score ? scores.indexOf(o.score) : scores.length);
    options.sort((a, b) => rank(a) - rank(b));
  }
  if (inUse && !options.some((o) => o.inUse)) {
    const edition = editions.find((e) => e.language === inUse.language);
    options.push({
      value: `${inUse.language}:in-use`,
      language: inUse.language,
      title: inUse.title,
      words: null,
      badge: null,
      estimated: 0,
      redraftEstimated: edition?.redraftEstimated ?? 0,
      score: null,
      inUse: true,
    });
  }
  return options;
}

type List = { items: CandidateDto[]; total: number; next: number; loading: boolean; error: string | null };
const EMPTY_LIST: List = { items: [], total: 0, next: 0, loading: false, error: null };

type ItemProps = {
  candidate: CandidateDto;
  checked: boolean;
  /** Ticked here, not in the memory today (reingest). */
  isNew: boolean;
  /** In the memory today: costs nothing to keep. */
  kept: boolean;
  disabled: boolean;
  onToggle: () => void;
  passages?: number;
};

/** Spec §34.5: one candidate: its size and price; a mention shows the paragraphs that will be kept. */
export function ExtraItem({ candidate, checked, isNew, kept, disabled, onToggle, passages }: ItemProps) {
  const paragraphs = candidate.kind === "mention" && candidate.preview ? candidate.preview.split(/\n{2,}/).filter((p) => p.trim()) : [];
  let detail: string | null = null;
  if (kept && passages !== undefined) detail = `${passages.toLocaleString("en")} passages in memory`;
  else if (candidate.kind === "quotes" && candidate.count !== undefined) detail = `${candidate.count.toLocaleString("en")} quotes`;
  else if (paragraphs.length === 0 && candidate.chars > 0) detail = `about ${wordsOf(candidate.chars).toLocaleString("en")} words`;
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="mt-1 size-5 shrink-0 accent-lime-400" />
      <span className="min-w-0 flex-1">
        <span className={`${BODY} block break-words`}>
          {candidate.title}
          {isNew && <span className={`${TAG_CHANGE} ml-2`}>new</span>}
        </span>
        {detail && <span className={`${MUTED} block`}>{detail}</span>}
        {paragraphs.map((p, i) => (
          <p key={i} className={`${MUTED} mt-1 break-words`}>
            <q>{p}</q>
          </p>
        ))}
      </span>
      <span className={`${BODY} shrink-0 whitespace-nowrap tabular-nums`}>{kept ? "kept" : about(candidate.estimated)}</span>
    </label>
  );
}

type Props = {
  mode: "new" | "reingest";
  /** The free lookup's editions, priced. */
  editions: EditionDto[];
  /** The comparison's scores, best first; null when not compared yet. */
  scores: EditionScore[] | null;
  /** The persona's language codes. */
  languages: string[];
  /** The memory today (reingest); empty for a new persona. */
  current: SourceDto[];
  /** One page of candidates; with `page`, that one page by title (mentions only). */
  candidatesUrl: (kind: ExtraKind, language: string, offset: number, page?: string) => string;
  compareEstimated: number;
  comparing: boolean;
  compareError: string | null;
  onCompare: () => void;
  /** Reingest: the redraft tick box, shared with the confirm step. */
  redraft: boolean;
  onToggleRedraft: () => void;
  onSubmit: (plan: SourcePlan) => void;
};

/**
 * Spec §34.5: one screen for both flows: the main article as radios (score, badge, price) and the
 * four extras as checkboxes, each list grouped by language, then the profile line (new) or the
 * redraft tick box (reingest), the total and the button. Reingest starts from the memory today.
 */
export default function ChooseSources(props: Props) {
  const { mode, editions, scores, languages, current, candidatesUrl, compareEstimated, comparing, compareError, onCompare, redraft, onToggleRedraft, onSubmit } = props;
  const storedArticle = current.find((s) => s.kind === "article");
  const storedExtras = useMemo(() => current.filter((s) => s.kind !== "article"), [current]);
  const storedKeys = useMemo(() => new Set(storedExtras.map(sourceKey)), [storedExtras]);
  const options = useMemo(() => editionOptions(editions, scores, mode === "reingest" ? storedArticle : undefined), [editions, scores, mode, storedArticle]);
  const mostComplete = scores?.[0] && scores[0].answered > 0 ? scores[0] : null;

  const [articleValue, setArticleValue] = useState(() => (options.find((o) => o.inUse) ?? options[0])?.value ?? "");
  const [open, setOpen] = useState<Set<ExtraKind>>(() => new Set(storedExtras.map((s) => s.kind as ExtraKind)));
  const [selected, setSelected] = useState<Map<string, SourcePlan["extras"][number]>>(
    () => new Map(storedExtras.map((s) => [sourceKey(s), { kind: s.kind, site: s.site, language: s.language, title: s.title, estimated: 0 }])),
  );
  const [lists, setLists] = useState<Record<string, List>>({});
  const requested = useRef(new Set<string>());

  const option = options.find((o) => o.value === articleValue) ?? options[0];
  const groups = languageGroups(option?.language ?? "en", languages, storedExtras.map((s) => s.language));

  const load = useCallback(
    async (kind: ExtraKind, language: string, offset: number) => {
      const id = `${kind}:${language}`;
      requested.current.add(id);
      setLists((l) => ({ ...l, [id]: { ...(l[id] ?? EMPTY_LIST), loading: true, error: null } }));
      let error: string;
      try {
        const res = await fetch(candidatesUrl(kind, language, offset), { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as (CandidatesResult & { error?: string }) | null;
        if (res.ok && data) {
          setLists((l) => {
            const prev = l[id] ?? EMPTY_LIST;
            const seen = new Set(prev.items.map(sourceKey));
            const items = [...prev.items, ...data.items.filter((c) => !seen.has(sourceKey(c)))];
            return { ...l, [id]: { items, total: data.total, next: offset + CANDIDATE_PAGE, loading: false, error: null } };
          });
          return;
        }
        error = data?.error ?? "Couldn't load this list. Try again.";
      } catch {
        error = "Couldn't reach the server.";
      }
      setLists((l) => ({ ...l, [id]: { ...(l[id] ?? EMPTY_LIST), loading: false, error } }));
    },
    [candidatesUrl],
  );

  // Each ticked extra lists its first page in every language, once.
  const groupsKey = groups.join(",");
  useEffect(() => {
    for (const kind of open) {
      for (const language of groupsKey.split(",")) {
        if (!requested.current.has(`${kind}:${language}`)) void load(kind, language, 0);
      }
    }
  }, [open, groupsKey, load]);

  if (!option) return <p className={MUTED}>No Wikipedia edition was found.</p>;

  const extras = [...selected.values()].filter((e) => open.has(e.kind as ExtraKind));
  const isStored = (e: SourceRef) => storedKeys.has(sourceKey(e));
  const extrasCost = extras.reduce((sum, e) => sum + (isStored(e) ? 0 : e.estimated), 0);
  const articleCost = option.inUse ? 0 : option.estimated;
  const redraftCost = option.redraftEstimated;
  const profileCost = mode === "new" || redraft ? redraftCost : 0;
  const total = articleCost + extrasCost + profileCost;
  const plan: SourcePlan = {
    article: { kind: "article", site: "wikipedia", language: option.language, title: option.title },
    extras,
    articleEstimated: articleCost,
    redraft: mode === "new" || redraft,
    redraftEstimated: redraftCost,
  };
  const unchanged = mode === "reingest" && !redraft && describeChanges(current, plan).length === 0;
  const full = selected.size >= MAX_PLAN_EXTRAS;

  const toggleKind = (kind: ExtraKind) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const toggleItem = (c: CandidateDto | SourcePlan["extras"][number]) =>
    setSelected((s) => {
      const next = new Map(s);
      const key = sourceKey(c);
      if (next.has(key)) next.delete(key);
      else next.set(key, { kind: c.kind, site: c.site, language: c.language, title: c.title, estimated: isStored(c) ? 0 : c.estimated });
      return next;
    });
  /** A page added by title: first in its language's list, ticked (unless the plan is full). */
  const addByTitle = (c: CandidateDto) => {
    const id = `${c.kind}:${c.language}`;
    const key = sourceKey(c);
    setLists((l) => {
      const prev = l[id] ?? EMPTY_LIST;
      return { ...l, [id]: { ...prev, items: [c, ...prev.items.filter((p) => sourceKey(p) !== key)] } };
    });
    setSelected((s) => {
      if (s.has(key) || s.size >= MAX_PLAN_EXTRAS) return s;
      return new Map(s).set(key, { kind: c.kind, site: c.site, language: c.language, title: c.title, estimated: isStored(c) ? 0 : c.estimated });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className={MUTED}>{mode === "new" ? "Nothing is spent until you press Add persona." : "Nothing is spent until you press Reingest."}</p>

      <section className={CARD}>
        <h2 className={H2}>Main article</h2>
        {scores ? (
          <p className={`${MUTED} mb-1`}>Scored on 30 typical visitor questions.</p>
        ) : (
          <div className="mb-2 flex flex-col gap-2">
            <p className={MUTED}>Not compared yet. Comparing scores each edition on 30 typical visitor questions.</p>
            <button type="button" onClick={onCompare} disabled={comparing} className={`${BTN} w-full sm:w-auto sm:self-start`}>
              {comparing ? "Comparing…" : `Compare editions · ${formatDollars(compareEstimated)}`}
            </button>
            {compareError && (
              <p role="alert" className={ALERT}>
                {compareError}
              </p>
            )}
          </div>
        )}
        <fieldset>
          <legend className="sr-only">Main article</legend>
          {options.map((o) => (
            <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 border-t border-white/10 py-3 first-of-type:border-t-0">
              <input
                type="radio"
                name="main-article"
                value={o.value}
                checked={o.value === option.value}
                onChange={() => setArticleValue(o.value)}
                className="mt-1 size-5 shrink-0 accent-lime-400"
              />
              <span className="min-w-0 flex-1">
                <span className={`${BODY} block font-medium`}>{languageName(o.language)}</span>
                <span className={`${MUTED} flex flex-wrap gap-x-3`}>
                  {o.score && (
                    <span>
                      {o.score.answered} of {o.score.total}
                    </span>
                  )}
                  {o.words !== null && <span>{o.words.toLocaleString("en")} words</span>}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  {mostComplete && o.score === mostComplete && <span className={TAG}>Most complete</span>}
                  {o.badge === "featured" && <span className={TAG}>Featured</span>}
                  {o.badge === "good" && <span className={TAG}>Good article</span>}
                  {o.inUse && <span className={TAG_CHANGE}>In use now</span>}
                </span>
              </span>
              <span className={`${BODY} shrink-0 whitespace-nowrap tabular-nums`}>{o.inUse ? "kept" : about(o.estimated)}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className={CARD}>
        <h2 className={H2}>Extra sources</h2>
        {KINDS.map(({ kind, label, hint }) => {
          const isOpen = open.has(kind);
          const ofKind = extras.filter((e) => e.kind === kind);
          const newCost = ofKind.reduce((sum, e) => sum + (isStored(e) ? 0 : e.estimated), 0);
          const price = newCost > 0 ? about(newCost) : ofKind.length > 0 ? "kept" : "";
          return (
            <div key={kind} className="border-t border-white/10 first-of-type:border-t-0">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-3">
                <input type="checkbox" checked={isOpen} aria-label={label} onChange={() => toggleKind(kind)} className="mt-1 size-5 shrink-0 accent-lime-400" />
                <span className="min-w-0 flex-1">
                  <span className={`${BODY} block font-medium`}>{label}</span>
                  <span className={`${MUTED} block`}>{hint}</span>
                  {isOpen && ofKind.length > 0 && <span className={`${MUTED} block`}>{ofKind.length} chosen</span>}
                </span>
                <span className={`${BODY} shrink-0 whitespace-nowrap tabular-nums`}>{price}</span>
              </label>
              {isOpen && (
                <div className="mb-3 ml-8 flex flex-col gap-3">
                  {groups.map((language) => {
                    const list = lists[`${kind}:${language}`];
                    const stored = storedExtras.filter((s) => s.kind === kind && s.language === language);
                    const items = (list?.items ?? []).filter((c) => !storedKeys.has(sourceKey(c)));
                    const more = list && !list.loading && list.next < list.total ? Math.min(CANDIDATE_PAGE, list.total - list.next) : 0;
                    return (
                      <div key={language}>
                        <h3 className="text-base font-medium text-neutral-300 sm:text-sm">{languageName(language)}</h3>
                        {stored.map((s) => (
                          <ExtraItem
                            key={sourceKey(s)}
                            candidate={{ kind: kind, site: s.site, language: s.language, title: s.title, chars: 0, estimated: 0 }}
                            checked={selected.has(sourceKey(s))}
                            isNew={false}
                            kept
                            passages={s.passages}
                            disabled={false}
                            onToggle={() => toggleItem({ ...s, estimated: 0 })}
                          />
                        ))}
                        {items.map((c) => {
                          const checked = selected.has(sourceKey(c));
                          return (
                            <ExtraItem
                              key={sourceKey(c)}
                              candidate={c}
                              checked={checked}
                              isNew={mode === "reingest" && checked}
                              kept={false}
                              disabled={!checked && full}
                              onToggle={() => toggleItem(c)}
                            />
                          );
                        })}
                        {(!list || list.loading) && <p className={`${MUTED} py-2`}>Loading…</p>}
                        {list?.error && (
                          <div className="flex flex-col items-start gap-2 py-2">
                            <p role="alert" className={ALERT}>
                              {list.error}
                            </p>
                            <button type="button" onClick={() => void load(kind, language, list.next)} className={BTN}>
                              Try again
                            </button>
                          </div>
                        )}
                        {list && !list.loading && !list.error && items.length === 0 && stored.length === 0 && more === 0 && (
                          <p className={`${MUTED} py-2`}>None found.</p>
                        )}
                        {more > 0 && (
                          <button type="button" onClick={() => void load(kind, language, list!.next)} className={`${BTN} mt-1`}>
                            Show {more} more
                          </button>
                        )}
                        {kind === "mention" && (
                          <MentionByTitle language={language} url={(page) => candidatesUrl(kind, language, 0, page)} onFound={addByTitle} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {mode === "new" ? (
        <div className="flex justify-between gap-3 px-1">
          <span className={MUTED}>Character profile and highlights</span>
          <span className={`${BODY} whitespace-nowrap tabular-nums`}>{about(redraftCost)}</span>
        </div>
      ) : (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 px-1">
          <input type="checkbox" checked={redraft} onChange={onToggleRedraft} className="mt-1 size-5 shrink-0 accent-lime-400" />
          <span className={`${BODY} min-w-0 flex-1`}>Also redraft highlights and character from the new sources</span>
          <span className={`${BODY} shrink-0 whitespace-nowrap tabular-nums`}>{about(redraftCost)}</span>
        </label>
      )}

      <div className="flex justify-between gap-3 border-t border-white/15 px-1 pt-3 text-base font-semibold sm:text-sm">
        <span>Total</span>
        <span className="tabular-nums">{about(total)}</span>
      </div>
      <button type="button" onClick={() => onSubmit(plan)} disabled={unchanged} className={`${BTN_PRIMARY} w-full`}>
        {mode === "new" ? `Add persona · ${formatDollars(total)}` : "Review changes"}
      </button>
    </div>
  );
}
