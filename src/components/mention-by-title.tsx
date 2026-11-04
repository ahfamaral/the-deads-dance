"use client";

import { useState, type FormEvent } from "react";
import { languageName } from "@corpus/languages";
import { ALERT, BODY, BTN } from "@/components/admin-styles";
import type { CandidateDto, PageMentionResult } from "@/lib/persona-profile";

/** Wikipedia titles are at most 255 characters. */
const MAX_TITLE = 255;

/**
 * Spec §34.5 (follow-up, 2026-11-04): the free lookup behind "Add a page by title": the page as a
 * mention candidate, or the sentence saying why it can't be one.
 */
export async function fetchPageMention(url: string): Promise<{ candidate: CandidateDto } | { error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as (PageMentionResult & { error?: string }) | null;
    if (!res.ok || !data) return { error: data?.error ?? "Couldn't look up that page. Try again." };
    return data.total === 1 ? { candidate: data.items[0] } : { error: data.message };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

type Props = {
  language: string;
  /** The lookup's URL for a typed title. */
  url: (title: string) => string;
  /** The page was found and names the persona. */
  onFound: (candidate: CandidateDto) => void;
};

/** A field under one language's mentions: a page the list can't find (spec §34's Fluminense paragraph), by its title. */
export default function MentionByTitle({ language, url, onFound }: Props) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `mention-page-${language}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const wanted = title.trim();
    if (!wanted || busy) return;
    setBusy(true);
    setError(null);
    const result = await fetchPageMention(url(wanted));
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setTitle("");
    onFound(result.candidate);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
      <label htmlFor={id} className={BODY}>
        Add a page by title
        <span className="sr-only"> ({languageName(language)})</span>
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          autoComplete="off"
          lang={language}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-neutral-950/60 px-3 text-base text-neutral-100 focus-visible:border-white/40 focus-visible:outline-none"
        />
        <button type="submit" disabled={busy || title.trim() === ""} className={BTN}>
          {busy ? "Adding…" : "Add"}
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
