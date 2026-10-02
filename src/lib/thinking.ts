import type { Message } from "@/lib/chat-types";

/** Spec §18.6: what the persona is doing while the reply is on its way; the display name, never a pronoun. */
export function thinkingLine(name: string, message: Message): string | null {
  const running = (message.toolCalls ?? []).find((c) => c.status === "running");
  if (running?.toolName === "search_biography") return `${name} is remembering…`;
  if (running?.toolName === "fact_check_claim") return `${name} is weighing that…`;
  if (running?.toolName === "get_historical_context") return `${name} is casting back to those days…`;
  if (running || !message.text) return `${name} is thinking…`;
  return null;
}
