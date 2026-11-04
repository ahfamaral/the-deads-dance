"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BODY, BTN, BTN_PRIMARY, CARD, H2, MUTED, ROW } from "@/components/admin-styles";
import ChangeSourcesFlow from "@/components/change-sources-flow";
import IngestionHistory from "@/components/ingestion-history";
import PersonaRatings from "@/components/persona-ratings";
import VoicePanel from "@/components/voice-panel";
import { HIGHLIGHTS_EDIT_MAX, reingestedBanner, type LanguageSource, type PersonaProfileDto, type SourceDto } from "@/lib/persona-profile";

/** Spec §34.4: how often a running round's page reloads while it runs. */
export const RUNNING_POLL_MS = 5_000;

const TRAITS = [
  ["temperament", "Temperament"],
  ["humour", "Humour"],
  ["passions", "Passions"],
  ["indifferences", "Indifferences"],
  ["speech", "Speech"],
  ["sore_points", "Sore points"],
] as const;

const KIND_LABEL = { article: "", writing: "Own writings", quotes: "Real quotes", linked: "Linked articles", mention: "Where others mention them" } as const;
const SITE_LABEL = { wikipedia: "Wikipedia", wikiquote: "Wikiquote", wikisource: "Wikisource" } as const;

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className={H2}>{title}</h2>
      {children}
    </section>
  );
}

function sourceHead(s: SourceDto): string {
  const site = `${SITE_LABEL[s.site]} (${languageName(s.language)})`;
  return s.kind === "article" ? site : `${KIND_LABEL[s.kind]}, ${site}`;
}

const SOURCE_NOTE: Record<LanguageSource, string> = {
  Wikidata: "Wikidata",
  "set by hand": "set by hand",
  "none found, English assumed": "none found, English assumed",
};

/** Spec §34.4: the biography highlights, with Edit (saved as typed) and Redraft (priced, in Change sources). */
function Highlights({ slug, text, onSaved, onRedraft }: { slug: string; text: string | null; onSaved: (t: string) => void; onRedraft: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = draft.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= HIGHLIGHTS_EDIT_MAX;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/personas/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ highlights: trimmed }),
    }).catch(() => null);
    setSaving(false);
    if (res?.status === 204) {
      onSaved(trimmed);
      setEditing(false);
    } else setError(`Couldn't save. Enter 1 to ${HIGHLIGHTS_EDIT_MAX.toLocaleString("en")} characters and try again.`);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor="highlights" className="sr-only">
          Biography highlights
        </label>
        <textarea
          id="highlights"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          className="w-full resize-y rounded-xl border border-white/15 bg-neutral-900/80 p-3 text-base text-neutral-100"
        />
        <p className={MUTED}>
          {trimmed.length} of {HIGHLIGHTS_EDIT_MAX.toLocaleString("en")} characters
        </p>
        {error && (
          <p role="alert" className="text-base text-red-300 sm:text-sm">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => void save()} disabled={!valid || saving} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={`${BTN} flex-1 sm:flex-none`}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {text ? (
        text.split(/\n{2,}/).map((p, i) => (
          <p key={i} className={`${BODY} whitespace-pre-wrap break-words`}>
            {p}
          </p>
        ))
      ) : (
        <p className={MUTED}>No highlights yet.</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(text ?? "");
            setError(null);
            setEditing(true);
          }}
          className={`${BTN} flex-1 sm:flex-none`}
        >
          Edit
        </button>
        <button type="button" onClick={onRedraft} className={`${BTN} flex-1 sm:flex-none`}>
          Redraft
        </button>
      </div>
    </div>
  );
}

type Props = {
  slug: string;
  initial: PersonaProfileDto;
  backHref: string;
  /** "{name} added, cost {price}" or "Reingested, cost {price}", from the page's query. */
  banner: string | null;
  /** After adding a persona: offer to create a voice. */
  offerVoice: boolean;
};

/**
 * Spec §34.4: the admin's profile of one persona, one column, top to bottom. Change sources (and
 * Redraft, with the redraft tick box on) opens the steps of spec §34.7 in its place.
 */
export default function PersonaProfile({ slug, initial, backHref, banner, offerVoice }: Props) {
  const [dto, setDto] = useState(initial);
  const [voiceOffer, setVoiceOffer] = useState(offerVoice);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [shownBanner, setShownBanner] = useState(banner);
  const [changing, setChanging] = useState<{ redraft: boolean } | null>(null);
  // Back from the steps returns to where the profile was scrolled.
  const profileScroll = useRef<number | null>(null);
  const openSources = (redraft: boolean) => {
    profileScroll.current = window.scrollY;
    setChanging({ redraft });
  };

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/personas/${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDto((await res.json()) as PersonaProfileDto);
  }, [slug]);

  // A running round: reload every 5 s until it ends.
  useEffect(() => {
    if (!dto.running) return;
    const timer = setInterval(() => void reload(), RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [dto.running, reload]);

  useEffect(() => {
    if (changing || profileScroll.current === null) return;
    window.scrollTo({ top: profileScroll.current });
    profileScroll.current = null;
  }, [changing]);

  const closeSources = useCallback(() => {
    setChanging(null);
    void reload();
  }, [reload]);

  if (changing) {
    return (
      <ChangeSourcesFlow
        dto={dto}
        initialRedraft={changing.redraft}
        onExit={closeSources}
        onDone={(cost, estimated) => {
          setShownBanner(reingestedBanner(cost, estimated));
          void reload();
        }}
        onFailed={() => void reload()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={backHref} className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-base text-neutral-200 hover:bg-white/10 sm:text-sm">
          Back
        </Link>
      </div>
      <header>
        <h1 className="text-2xl font-semibold">{dto.name}</h1>
        <p className={`${BODY} mt-1`}>{dto.description}</p>
        <p className={MUTED}>{dto.lifespan}</p>
      </header>

      {shownBanner && (
        <p role="status" className="rounded-xl border border-lime-400/40 bg-lime-400/10 px-3 py-2 text-base text-lime-300 sm:text-sm">
          {shownBanner}
        </p>
      )}
      {dto.running && (
        <p role="status" className="rounded-xl border border-white/10 bg-neutral-900/70 px-3 py-2 text-base text-neutral-200 sm:text-sm">
          Reingest running
        </p>
      )}
      {voiceOffer && (
        <div className={`${CARD} flex flex-col gap-3`}>
          <p className={`${BODY} font-medium`}>{`Create a voice for ${dto.name}?`}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setVoiceOpen(true)} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
              Create voice
            </button>
            <button type="button" onClick={() => setVoiceOffer(false)} className={`${BTN} flex-1 sm:flex-none`}>
              Not now
            </button>
          </div>
        </div>
      )}
      {voiceOpen && (
        <VoicePanel
          persona={{ id: dto.slug, name: dto.name }}
          open
          onClose={() => {
            setVoiceOpen(false);
            setVoiceOffer(false);
          }}
          onChanged={() => {}}
        />
      )}

      <Section title="Biography highlights">
        <Highlights slug={slug} text={dto.highlights} onSaved={(t) => setDto((d) => ({ ...d, highlights: t }))} onRedraft={() => openSources(true)} />
      </Section>

      <Section title="Character">
        {dto.profile ? (
          <dl className="flex flex-col">
            {TRAITS.map(([key, label]) => (
              <div key={key} className={`${ROW} flex-col gap-0 sm:flex-row sm:gap-3`}>
                <dt className={MUTED}>{label}</dt>
                <dd className={`${BODY} break-words sm:text-right`}>{dto.profile?.[key]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={MUTED}>No character profile yet.</p>
        )}
      </Section>

      <Section title="Languages">
        <ul>
          {dto.languages.map((l) => (
            <li key={l.code} className={`${ROW} text-base sm:text-sm`}>
              <span className="text-neutral-200">
                {l.name}
                {l.native && <span className="ml-2 text-lime-400">native</span>}
              </span>
              <span className="text-right text-neutral-400">{SOURCE_NOTE[l.source]}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Memory sources">
        {dto.sources.length === 0 ? (
          <p className={MUTED}>Nothing ingested yet.</p>
        ) : (
          <ul>
            {dto.sources.map((s) => (
              <li key={`${s.kind}:${s.site}:${s.language}:${s.title}`} className={`${ROW} text-base sm:text-sm`}>
                <span className="min-w-0 text-neutral-200">
                  {sourceHead(s)}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center break-words text-neutral-400 underline underline-offset-2 hover:text-neutral-100"
                  >
                    {s.revid !== null ? `${s.title}, revision ${s.revid}` : s.title}
                  </a>
                </span>
                <span className="shrink-0 whitespace-nowrap text-neutral-400">{s.passages} passages</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ingestion history">
        <IngestionHistory rounds={dto.rounds} spent={dto.spent} />
      </Section>

      <Section title="Testers' ratings">
        <PersonaRatings report={dto.ratings} />
      </Section>

      <button type="button" onClick={() => openSources(false)} className={`${BTN} w-full`}>
        Change sources
      </button>
    </div>
  );
}
