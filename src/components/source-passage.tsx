import { useEffect, useState, useSyncExternalStore } from "react";
import { languageName } from "@corpus/languages";
import type { Passage } from "@corpus/tool-results";

export type Translation = { status: "idle" } | { status: "loading" } | { status: "done"; heading: string; content: string } | { status: "failed" };

type SourcePassageViewProps = { passage: Passage; translation: Translation };

/** Spec §34.6: the open chip's passage; translated when asked, the original dimmed while it loads and on failure. */
export function SourcePassageView({ passage, translation }: SourcePassageViewProps) {
  if (translation.status === "done") {
    return (
      <blockquote className="border-l border-white/15 pl-3 text-xs text-neutral-400">
        <p className="whitespace-pre-wrap">{translation.content}</p>
        <p className="mt-1 text-neutral-500">Translated from {languageName(passage.language ?? "en")}</p>
      </blockquote>
    );
  }
  return (
    <blockquote className={`border-l border-white/15 pl-3 text-xs text-neutral-400 ${translation.status === "loading" ? "opacity-50" : ""}`}>
      <p className="whitespace-pre-wrap">{passage.content}</p>
    </blockquote>
  );
}

const done = new Map<string, { heading: string; content: string }>();

/** No request when the passage already is in the visitor's language ("en" when the result carries none). */
export function needsTranslation(passageLanguage: string | undefined, to: string | null | undefined): boolean {
  return Boolean(to) && to !== (passageLanguage ?? "en");
}

/** The visitor's language when the classifier couldn't tell: the browser's primary subtag. */
function browserLanguage(): string | null {
  const code = (typeof navigator === "undefined" ? "" : (navigator.language ?? "")).split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

/** Spec §34.6: asks the server to translate when the passage's language isn't the visitor's. Nothing is requested when they match. */
export function usePassageTranslation(passage: Passage | undefined, conversationId: string | undefined, visitorLanguage: string | undefined): Translation {
  const browser = useSyncExternalStore(() => () => {}, browserLanguage, () => null);
  const to = visitorLanguage && visitorLanguage !== "und" ? visitorLanguage : browser;
  const needed = Boolean(conversationId) && passage !== undefined && needsTranslation(passage.language, to);
  const key = `${conversationId}:${passage?.chunk_id}:${to}`;
  const [state, setState] = useState<{ key: string; translation: Translation }>({ key: "", translation: { status: "idle" } });

  useEffect(() => {
    if (!needed || done.has(key)) return;
    const controller = new AbortController();
    fetch(`/api/conversations/${conversationId}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkId: passage?.chunk_id, to }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { heading: string; content: string };
        done.set(key, body);
        setState({ key, translation: { status: "done", ...body } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, translation: { status: "failed" } });
      });
    return () => controller.abort();
  }, [needed, key, conversationId, passage?.chunk_id, to]);

  const cached = done.get(key);
  const translation: Translation = !needed
    ? { status: "idle" }
    : cached
      ? { status: "done", ...cached }
      : state.key === key
        ? state.translation
        : { status: "loading" };
  return translation;
}
