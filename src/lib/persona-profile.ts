import { z } from "zod";
import type { Candidate } from "@corpus/extras";
import type { SourcePlan } from "@corpus/plan-changes";
import type { CharacterProfile } from "@corpus/profile";
import type { EditionScore, RoundItem, RoundStatus, StoredSource } from "@corpus/rounds";
import type { FeedbackReport } from "@/lib/feedback";

/**
 * Spec §34.3–§34.5: what the admin persona pages receive and send. Browser-safe: type-only
 * imports from the corpus, and the zod bodies the routes validate with.
 */

/** Spec §34.4: the admin may edit highlights up to this many characters (the drafter stops at 1,200). */
export const HIGHLIGHTS_EDIT_MAX = 1_500;
/** Spec §34.5: candidate lists are fetched 20 at a time. */
export const CANDIDATE_PAGE = 20;
/** The most extras one round may tick. */
export const MAX_PLAN_EXTRAS = 200;

/** Spec §34.4: where a persona's languages came from. */
export type LanguageSource = "Wikidata" | "set by hand" | "none found, English assumed";
export type ProfileLanguage = { code: string; name: string; native: boolean; source: LanguageSource };

export type SourceDto = Omit<StoredSource, "id" | "roundId">;

export type RoundDto = {
  id: number;
  number: number;
  /** A running round older than the stale limit is shown as failed. */
  status: RoundStatus;
  /** "Compared, not ingested" for a draft, "Reingest running" while it runs; else null. */
  note: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Micro-dollars: the sum of its items' recorded costs; null when none is recorded. */
  cost: number | null;
  items: RoundItem[];
};

export type PersonaProfileDto = {
  slug: string;
  name: string;
  description: string;
  lifespan: string;
  origin: "curated" | "user";
  highlights: string | null;
  profile: CharacterProfile | null;
  languages: ProfileLanguage[];
  sources: SourceDto[];
  /** Newest first. */
  rounds: RoundDto[];
  /** Micro-dollars: every recorded item cost of every round. */
  spent: number;
  /** A round is running now. */
  running: boolean;
  /** The latest edition scores, so "Change sources" needn't pay again. */
  comparison: { scores: EditionScore[]; comparedAt: string } | null;
  ratings: FeedbackReport;
};

/** `estimated` is micro-dollars to embed it. */
export type CandidateDto = Candidate & { estimated: number };
export type CandidatesResult = { items: CandidateDto[]; total: number };

export type EditionDto = Omit<EditionScore, "answered" | "total">;

/** Spec §34.3: the free lookup of a new persona; `compareEstimated` is micro-dollars. */
export type FindResult = {
  slug: string;
  name: string;
  description: string;
  lifespan: string;
  languages: ProfileLanguage[];
  editions: EditionDto[];
  compareEstimated: number;
};

export type CompareResult = { scores: EditionScore[]; cost: number };

/** One line of the POST /api/admin/personas/rounds stream. `spent` and `cost` are micro-dollars. */
export type RoundEvent =
  | { type: "progress"; label: string; status: "started" | "finished" | "skipped"; spent: number }
  | { type: "done"; slug: string; cost: number }
  | { type: "error"; message: string; code?: string };

const Title = z.string().trim().min(1).max(255);
/** Wikimedia language codes: "en", "pt", "simple", "zh_min_nan", "be-tarask". */
const Language = z.string().regex(/^[a-z][a-z0-9_-]{1,19}$/);
const Micros = z.number().int().min(0).max(100_000_000);
const Site = z.enum(["wikipedia", "wikiquote", "wikisource"]);

/** Spec §34.6: a round's plan, as the browser sends it. */
export const SourcePlanBody = z.strictObject({
  article: z.strictObject({ kind: z.literal("article"), site: z.literal("wikipedia"), language: Language, title: Title }),
  extras: z
    .array(
      z.strictObject({
        kind: z.enum(["writing", "quotes", "linked", "mention"]),
        site: Site,
        language: Language,
        title: Title,
        estimated: Micros,
      }),
    )
    .max(MAX_PLAN_EXTRAS),
  articleEstimated: Micros,
  redraft: z.boolean(),
  redraftEstimated: Micros,
}) satisfies z.ZodType<SourcePlan>;

const Slug = z.string().min(1).max(200);
/** Titles are checked by prepareUserPersona, so its own messages reach the admin. */
const RawTitle = z.string().max(1_000);

/** An existing persona by slug, or a new one by its English Wikipedia title. */
export const TargetBody = z.union([z.strictObject({ slug: Slug }), z.strictObject({ title: RawTitle })]);
export type TargetBodyInput = z.infer<typeof TargetBody>;

export const FindBody = z.strictObject({ title: RawTitle });

export const RoundBody = z.union([
  z.strictObject({ slug: Slug, plan: SourcePlanBody }),
  z.strictObject({ title: RawTitle, plan: SourcePlanBody }),
]);

export const HighlightsBody = z.strictObject({ highlights: z.string().trim().min(1).max(HIGHLIGHTS_EDIT_MAX) });

export const CandidatesQuery = z
  .object({
    kind: z.enum(["writing", "quotes", "linked", "mention"]),
    slug: Slug.optional(),
    title: RawTitle.optional(),
    language: Language,
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine((q) => (q.slug === undefined) !== (q.title === undefined), { message: "Give a slug or a title." });
