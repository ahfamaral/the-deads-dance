import type { Verdict } from "@corpus/tool-results";
import type { ToolCall } from "@/lib/chat-types";
import {
  explanationOf,
  GENERAL_KNOWLEDGE_NOTE,
  historicalContextOf,
  passagesIn,
  problemOf,
  queriesOf,
  recalledOf,
  recalledYear,
  toolLabel,
  toolSubject,
  VERDICT_LABELS,
  verdictOf,
} from "@/lib/tool-display";

const VERDICT_CLASSES: Record<Verdict, string> = {
  supported: "bg-emerald-500/15 text-emerald-300",
  contradicted: "bg-rose-500/15 text-rose-300",
  not_mentioned: "bg-neutral-500/20 text-neutral-300",
  known_elsewhere: "bg-amber-500/15 text-amber-300",
};

function ToolRow({ call }: { call: ToolCall }) {
  const subject = toolSubject(call);
  const verdict = verdictOf(call);
  const problem = problemOf(call);
  const queries = queriesOf(call);
  const explanation = explanationOf(call);
  const passages = passagesIn(call.result);
  const recalled = recalledOf(call);
  const world = historicalContextOf(call);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 [&::-webkit-details-marker]:hidden">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="shrink-0 font-medium text-neutral-300">{toolLabel(call.toolName)}</span>
          {subject && <span className="min-w-0 truncate">· “{subject}”</span>}
          {verdict && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 ${VERDICT_CLASSES[verdict]}`}>
              {VERDICT_LABELS[verdict]}
            </span>
          )}
          {/* A search's fallback recall gets the same chip as a known_elsewhere fact check. */}
          {!verdict && recalled && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 ${VERDICT_CLASSES.known_elsewhere}`}>
              {VERDICT_LABELS.known_elsewhere}
            </span>
          )}
          {problem && !recalled && (
            <span className="shrink-0 text-amber-300/80">· {call.status === "error" ? "failed" : "no result"}</span>
          )}
          <span className="ml-auto shrink-0 tabular-nums">
            {call.status === "running" ? (
              <span
                role="status"
                aria-label="Running"
                className="inline-block size-3 animate-spin rounded-full border border-neutral-500 border-t-transparent"
              />
            ) : call.durationMs !== undefined ? (
              `${(call.durationMs / 1000).toFixed(1)}s`
            ) : null}
          </span>
        </summary>
        <div className="space-y-2 px-3 pb-2.5 pl-8 text-xs text-neutral-400">
          {queries.length > 1 && (
            <div>
              <p className="text-neutral-500">Searched as</p>
              <ul className="list-disc pl-4">
                {queries.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {problem && <p className="text-amber-300/80">{problem}</p>}
          {explanation && <p>{explanation}</p>}
          {recalled && (
            <blockquote className="border-l border-amber-300/30 pl-3">
              {recalled.year !== null && <p className="text-neutral-500">{recalledYear(recalled.year)}</p>}
              <p className="whitespace-pre-wrap">{recalled.account}</p>
              <p className="text-amber-300/80">{GENERAL_KNOWLEDGE_NOTE}</p>
            </blockquote>
          )}
          {world && world.events.length > 0 && (
            <div>
              <p className="text-neutral-500">Events</p>
              <ul className="list-disc pl-4">
                {world.events.map((e) => (
                  <li key={e.label}>
                    {e.label} <span className="text-neutral-500">({e.date})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {world && world.leaders.length > 0 && (
            <div>
              <p className="text-neutral-500">Who held power</p>
              <ul className="list-disc pl-4">
                {world.leaders.map((l) => (
                  <li key={`${l.country}|${l.office}|${l.person}`}>
                    {l.person}, {l.office} <span className="text-neutral-500">({l.country})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {passages.map((p) => (
            <blockquote key={p.chunk_id} className="border-l border-white/15 pl-3">
              <p className="text-neutral-500">{p.section_heading}</p>
              <p className="line-clamp-4 whitespace-pre-wrap">{p.content}</p>
            </blockquote>
          ))}
        </div>
      </details>
    </li>
  );
}

/** One row per tool call, collapsed by default; expand for query variants, verdict and passages. */
export default function ToolTrace({ calls }: { calls: ToolCall[] }) {
  return (
    <ol
      aria-label="Tool calls"
      className="max-w-[90%] divide-y divide-white/5 rounded-xl border border-white/10 bg-white/3"
    >
      {calls.map((call) => (
        <ToolRow key={call.id} call={call} />
      ))}
    </ol>
  );
}
