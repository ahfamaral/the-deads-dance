"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { languageName } from "@corpus/languages";
import type { SourcePlan } from "@corpus/plan-changes";
import type { EditionScore } from "@corpus/rounds";
import { ALERT, BODY, BTN, BTN_PRIMARY, CARD, H2, MUTED } from "@/components/admin-styles";
import ChooseSources from "@/components/choose-sources";
import RoundProgress from "@/components/round-progress";
import { formatDollars } from "@/lib/money";
import type { CompareResult, ExtraKind, FindResult, RoundEvent } from "@/lib/persona-profile";
import { profileHref } from "@/lib/profile-links";
import { streamRound } from "@/lib/round-client";
import { useBackHandler } from "@/lib/use-back-handler";
import { useStepScroll } from "@/lib/use-step-scroll";

/** Spec §34.7: Cancel and the find step's Back go to the persona picker in configure mode. */
export const PICKER_HREF = "/?manage=1";

const errorOf = async (res: Response, fallback: string) => ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;

type FindFormProps = { title: string; onTitle: (t: string) => void; onFind: () => void; finding: boolean; error: string | null };

/** The free lookup: an English Wikipedia title; its refusal (a living person, already listed…) shows under the field. */
export function FindForm({ title, onTitle, onFind, finding, error }: FindFormProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onFind();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="add-persona-title" className={MUTED}>
        English Wikipedia article about a person
      </label>
      <div className="flex gap-2">
        <input
          id="add-persona-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. Ada Lovelace"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-neutral-950/60 px-3 text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:border-white/40 focus-visible:outline-none"
        />
        <button type="submit" disabled={finding || title.trim() === ""} className={BTN}>
          {finding ? "Finding…" : "Find"}
        </button>
      </div>
      {error && (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      )}
    </form>
  );
}

type FoundProps = {
  found: FindResult;
  comparing: boolean;
  error: string | null;
  onCompare: () => void;
  /** Already compared (Back from choose sources): continue without paying again. */
  compared?: boolean;
};

/** Spec §34.8 (mockup 1a): who was found, the editions in their languages and the languages, then the priced compare. */
export function FoundPersona({ found, comparing, error, onCompare, compared = false }: FoundProps) {
  const sources = [...new Set(found.languages.map((l) => l.source))];
  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        <h2 className={H2}>{found.name}</h2>
        {found.description && <p className={BODY}>{found.description}</p>}
        {found.lifespan && <p className={MUTED}>{found.lifespan}</p>}
        <h3 className={`${BODY} mt-4 mb-2 font-medium`}>Editions in their languages</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {found.editions.map((e) => (
            <li key={e.language} className="rounded-xl border border-white/10 px-3 py-2">
              <span className={`${BODY} block`}>{languageName(e.language)}</span>
              <span className={`${MUTED} block`}>{e.words.toLocaleString("en")} words</span>
            </li>
          ))}
        </ul>
        <h3 className={`${BODY} mt-4 mb-1 font-medium`}>Languages</h3>
        <p className={BODY}>{found.languages.map((l) => (l.native ? `${l.name} (native)` : l.name)).join(", ")}</p>
        <p className={MUTED}>{sources.map((s) => (s === "Wikidata" ? "From Wikidata" : s)).join("; ")}</p>
      </section>
      <button type="button" onClick={onCompare} disabled={comparing} className={`${BTN_PRIMARY} w-full`}>
        {compared ? "Choose sources" : comparing ? "Comparing…" : `Compare editions · ${formatDollars(found.compareEstimated)}`}
      </button>
      {error && (
        <p role="alert" className={ALERT}>
          {error}
        </p>
      )}
    </div>
  );
}

type Step = "find" | "choose" | "progress";

/**
 * Spec §34.8: adding a persona on its own page: find (free) → Compare editions (priced) → choose
 * sources → Add persona → progress → the new profile. The name stays in the URL, so a refresh
 * keeps it. Choose and progress are steps: Back, app or phone, goes to the previous one.
 */
export default function AddPersonaFlow({ initialTitle }: { initialTitle: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("find");
  const [title, setTitle] = useState(initialTitle);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  /** The lookup, and the title it was made with (what compare, candidates and the round are keyed by). */
  const [found, setFound] = useState<{ title: string; result: FindResult } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [scores, setScores] = useState<EditionScore[] | null>(null);
  const [events, setEvents] = useState<RoundEvent[]>([]);

  const leaveChoose = useStepScroll(step, "choose");
  const toFind = useCallback(() => setStep("find"), []);
  const toChoose = useCallback(() => setStep("choose"), []);
  useBackHandler(step === "choose" ? toFind : step === "progress" ? toChoose : null);

  const find = async () => {
    const wanted = title.trim();
    // Spec §34.7: a refresh keeps the name. The native call, so the page isn't fetched again.
    window.history.replaceState(window.history.state, "", `/admin/personas/new?title=${encodeURIComponent(wanted)}`);
    setFinding(true);
    setFindError(null);
    setFound(null);
    setScores(null);
    try {
      const res = await fetch("/api/admin/personas/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: wanted }),
      });
      if (res.ok) setFound({ title: wanted, result: (await res.json()) as FindResult });
      else setFindError(await errorOf(res, "Couldn't look up that article."));
    } catch {
      setFindError("Couldn't reach the server.");
    } finally {
      setFinding(false);
    }
  };

  const compare = async () => {
    if (!found) return;
    if (scores) return setStep("choose");
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/admin/personas/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: found.title }),
      });
      if (res.ok) {
        setScores(((await res.json()) as CompareResult).scores);
        setStep("choose");
      } else setCompareError(await errorOf(res, "Comparing the editions failed."));
    } catch {
      setCompareError("Couldn't reach the server.");
    } finally {
      setComparing(false);
    }
  };

  const add = (plan: SourcePlan) => {
    if (!found) return;
    leaveChoose();
    setEvents([]);
    setStep("progress");
    void streamRound({ title: found.title, plan }, (e) => {
      setEvents((all) => [...all, e]);
      if (e.type === "done") router.replace(`${profileHref(e.slug, { kind: "manage" })}&added=${e.cost}`);
    });
  };

  const candidatesUrl = useCallback(
    (kind: ExtraKind, language: string, offset: number) =>
      `/api/admin/personas/candidates?${new URLSearchParams({ kind, title: found?.title ?? "", language, offset: String(offset) })}`,
    [found?.title],
  );

  const name = found?.result.name ?? "";
  const backButton = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={BTN}>
      Back
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        {step === "find" ? (
          <Link href={PICKER_HREF} className={BTN}>
            Back
          </Link>
        ) : (
          backButton(step === "choose" ? toFind : toChoose)
        )}
      </div>

      {step === "find" && (
        <>
          <h1 className="text-2xl font-semibold">Add persona</h1>
          <FindForm
            title={title}
            onTitle={(t) => {
              setTitle(t);
              setFound(null);
              setScores(null);
            }}
            onFind={() => void find()}
            finding={finding}
            error={findError}
          />
          {found && (
            <FoundPersona found={found.result} compared={scores !== null} comparing={comparing} error={compareError} onCompare={() => void compare()} />
          )}
          <Link href={PICKER_HREF} className={`${BTN} w-full`}>
            Cancel
          </Link>
        </>
      )}

      {found && scores && (
        // Kept mounted under progress, so Back finds the ticks as they were.
        <div hidden={step !== "choose"} className="flex flex-col gap-4">
          <header>
            <h1 className="text-2xl font-semibold">Choose sources</h1>
            <p className={`${BODY} mt-1`}>{name}</p>
          </header>
          <ChooseSources
            mode="new"
            editions={found.result.editions}
            scores={scores}
            languages={found.result.languages.map((l) => l.code)}
            current={[]}
            candidatesUrl={candidatesUrl}
            compareEstimated={found.result.compareEstimated}
            comparing={comparing}
            compareError={compareError}
            onCompare={() => void compare()}
            redraft
            onToggleRedraft={() => {}}
            onSubmit={add}
          />
        </div>
      )}

      {step === "progress" && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">{`Adding ${name}`}</h1>
            <p className={`${MUTED} mt-1`}>Leaving this page doesn&apos;t stop it.</p>
          </header>
          <RoundProgress events={events} />
        </>
      )}
    </div>
  );
}
