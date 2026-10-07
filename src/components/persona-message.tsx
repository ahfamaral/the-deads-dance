import { useState } from "react";
import ToolTrace from "@/components/tool-trace";
import type { Message } from "@/lib/chat-types";
import { ENDED_NOTE, STOPPED_NOTE } from "@/lib/message-notes";
import { MIXED_SOURCES_NOTE, passagesById, usesGeneralKnowledge } from "@/lib/tool-display";
import { thinkingLine } from "@/lib/thinking";
import { useRevealedText } from "@/lib/use-revealed-text";
import { spendLabel } from "@/lib/money";

type PersonaMessageProps = {
  personaName: string;
  message: Message;
  /** True while the reply is still arriving: shows "thinking…" or a caret. */
  streaming?: boolean;
  /** Spec §26.6: the admin sees what the reply cost. */
  showCost?: boolean;
};

export default function PersonaMessage({ personaName, message, streaming = false, showCost = false }: PersonaMessageProps) {
  const [openChunk, setOpenChunk] = useState<number | null>(null);
  const toolCalls = message.toolCalls ?? [];
  const sources = message.sources ?? [];
  const openPassage = openChunk === null ? undefined : passagesById(message).get(openChunk);
  const text = useRevealedText(message.text, streaming);
  const line = streaming ? thinkingLine(personaName, message) : null;

  return (
    <li className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">{personaName}</span>
      {toolCalls.length > 0 && <ToolTrace calls={toolCalls} />}
      {line && !text && <p className="animate-pulse text-neutral-500">{line}</p>}
      {(text || (streaming && !line)) && (
        <p className="max-w-[90%] whitespace-pre-wrap leading-relaxed text-neutral-200">
          {text}
          {streaming && (
            <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-neutral-400" />
          )}
        </p>
      )}
      {line && text && <p className="animate-pulse text-xs text-neutral-500">{line}</p>}
      {message.stopped && <p className="text-xs italic text-neutral-500">{STOPPED_NOTE}</p>}
      {message.ended && <p className="text-xs italic text-neutral-500">{ENDED_NOTE}</p>}
      {showCost && message.cost !== undefined && (
        <p className="text-xs tabular-nums text-neutral-500">{spendLabel({ tokens: message.tokens ?? 0, cost: message.cost })}</p>
      )}
      {sources.length > 0 && (
        <div className="flex max-w-[90%] flex-col gap-2">
          <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
            {sources.map((source) => {
              const open = openChunk === source.chunkId;
              return (
                <li key={source.chunkId}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenChunk(open ? null : source.chunkId)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      open
                        ? "border-white/40 text-foreground"
                        : "border-white/10 text-neutral-400 hover:border-white/30 hover:text-neutral-200"
                    }`}
                  >
                    {source.sectionHeading}
                  </button>
                </li>
              );
            })}
          </ul>
          {usesGeneralKnowledge(message) && <p className="text-xs text-amber-300/80">{MIXED_SOURCES_NOTE}</p>}
          {openPassage && (
            <blockquote className="border-l border-white/15 pl-3 text-xs text-neutral-400">
              <p className="whitespace-pre-wrap">{openPassage.content}</p>
            </blockquote>
          )}
        </div>
      )}
    </li>
  );
}
