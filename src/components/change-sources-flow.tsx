"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourcePlan } from "@corpus/plan-changes";
import type { EditionScore } from "@corpus/rounds";
import { ALERT, BODY, BTN, MUTED } from "@/components/admin-styles";
import ChooseSources from "@/components/choose-sources";
import ReingestConfirm from "@/components/reingest-confirm";
import RoundProgress from "@/components/round-progress";
import {
  describeChanges, removedArticleLanguage,
  type CompareResult, type ExtraKind, type FindResult, type PersonaProfileDto, type RoundEvent,
} from "@/lib/persona-profile";
import { streamRound } from "@/lib/round-client";
import { useBackHandler } from "@/lib/use-back-handler";
import { useStepScroll } from "@/lib/use-step-scroll";

type Step = "choose" | "confirm" | "progress";

type Props = {
  dto: PersonaProfileDto;
  /** Opened by Redraft: the redraft tick box starts ticked. */
  initialRedraft: boolean;
  /** Back to the profile (choose's and progress's Back; a round in progress carries on). */
  onExit: () => void;
  /** The round finished, wherever the admin is by then: its cost in micro-dollars, `estimated` when one of its calls' costs is an estimate. */
  onDone: (cost: number, estimated: boolean) => void;
  /** The round failed or was refused. */
  onFailed: () => void;
};

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const errorOf = async (res: Response, fallback: string) => ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;

async function lookUpEditions(slug: string): Promise<FindResult | { error: string }> {
  try {
    const res = await post("/api/admin/personas/find", { slug });
    return res.ok ? ((await res.json()) as FindResult) : { error: await errorOf(res, "Couldn't list the editions.") };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

/**
 * Spec §34.5, §34.7: the profile's Change sources steps, choose → confirm → progress. Each step
 * registers the phone's back with the same handler as its Back. The editions come from the free
 * lookup by slug; the scores from the last comparison, or a new one (priced).
 */
export default function ChangeSourcesFlow({ dto, initialRedraft, onExit, onDone, onFailed }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [found, setFound] = useState<FindResult | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [scores, setScores] = useState<EditionScore[] | null>(dto.comparison?.scores ?? null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [redraft, setRedraft] = useState(initialRedraft);
  const [plan, setPlan] = useState<SourcePlan | null>(null);
  const [events, setEvents] = useState<RoundEvent[]>([]);
  const leaveChoose = useStepScroll(step, "choose");

  const stepRef = useRef(step);
  const mounted = useRef(true);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const toChoose = useCallback(() => setStep("choose"), []);
  useBackHandler(step === "confirm" ? toChoose : onExit);

  const slug = dto.slug;
  /** The free lookup by slug: the editions, priced, and what comparing them costs. */
  const lookUp = useCallback(
    () =>
      lookUpEditions(slug).then((r) => {
        if ("error" in r) setFindError(r.error);
        else setFound(r);
      }),
    [slug],
  );
  useEffect(() => {
    void lookUp();
  }, [lookUp]);

  const compare = async () => {
    setComparing(true);
    setCompareError(null);
    try {
      const res = await post("/api/admin/personas/compare", { slug });
      if (res.ok) setScores(((await res.json()) as CompareResult).scores);
      else setCompareError(await errorOf(res, "Comparing the editions failed."));
    } catch {
      setCompareError("Couldn't reach the server.");
    } finally {
      setComparing(false);
    }
  };

  const reingest = (confirmed: SourcePlan) => {
    setEvents([]);
    setStep("progress");
    void streamRound({ slug, plan: confirmed }, (e) => {
      setEvents((all) => [...all, e]);
      if (e.type === "done") {
        onDone(e.cost, e.costEstimated);
        if (mounted.current && stepRef.current === "progress") onExit();
      } else if (e.type === "error") onFailed();
    });
  };

  const candidatesUrl = useCallback(
    (kind: ExtraKind, language: string, offset: number, page?: string) =>
      `/api/admin/personas/candidates?${new URLSearchParams({ kind, slug, language, offset: String(offset), ...(page ? { page } : {}) })}`,
    [slug],
  );

  const back = step === "confirm" ? toChoose : onExit;
  const confirmed = plan ? { ...plan, redraft } : null;
  const changes = confirmed ? describeChanges(dto.sources, confirmed) : [];
  const total = changes.reduce((sum, c) => sum + c.estimated, 0) + (confirmed?.redraft ? confirmed.redraftEstimated : 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" onClick={back} className={BTN}>
          Back
        </button>
      </div>

      <div hidden={step !== "choose"} className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold">Change sources</h1>
          <p className={`${BODY} mt-1`}>{dto.name}</p>
        </header>
        {found ? (
          <ChooseSources
            mode="reingest"
            editions={found.editions}
            scores={scores}
            languages={dto.languages.map((l) => l.code)}
            current={dto.sources}
            candidatesUrl={candidatesUrl}
            compareEstimated={found.compareEstimated}
            comparing={comparing}
            compareError={compareError}
            onCompare={() => void compare()}
            redraft={redraft}
            onToggleRedraft={() => setRedraft((r) => !r)}
            onSubmit={(p) => {
              leaveChoose();
              setPlan(p);
              setStep("confirm");
            }}
          />
        ) : findError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className={ALERT}>
              {findError}
            </p>
            <button
              type="button"
              onClick={() => {
                setFindError(null);
                void lookUp();
              }}
              className={BTN}
            >
              Try again
            </button>
          </div>
        ) : (
          <p role="status" className={MUTED}>
            Listing the editions…
          </p>
        )}
      </div>

      {step === "confirm" && confirmed && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">{`Reingest ${dto.name}?`}</h1>
            <p className={`${MUTED} mt-1`}>What changes in the memory</p>
          </header>
          <ReingestConfirm
            changes={changes}
            total={total}
            articleLanguageRemoved={removedArticleLanguage(dto.sources, confirmed)}
            redraft={redraft}
            redraftEstimated={confirmed.redraftEstimated}
            onToggleRedraft={() => setRedraft((r) => !r)}
            onConfirm={() => reingest(confirmed)}
            onBack={toChoose}
          />
        </>
      )}

      {step === "progress" && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">{`Reingesting ${dto.name}`}</h1>
            <p className={`${MUTED} mt-1`}>Back returns to the profile; the reingest goes on.</p>
          </header>
          <RoundProgress events={events} />
        </>
      )}
    </div>
  );
}
