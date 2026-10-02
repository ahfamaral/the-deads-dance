import { z } from "zod";
import {
  HISTORY_WINDOW,
  MAX_ACTS,
  MAX_MESSAGE_CHARS,
  MAX_PERSONA_MESSAGE_CHARS,
  MAX_REQUEST_MESSAGES,
  type ChatRequest,
  type ChatRequestMessage,
} from "@/lib/chat-types";
import { VisitorActSchema } from "@/lib/visitor-act";

/** Re-exported for existing imports; the constant itself now lives in chat-types.ts (F1). */
export { HISTORY_WINDOW };

// F2: the 4,000-char cap is for the user's own words. A persona message can be one of its own
// earlier replies, which run through a generous cap instead so a long past answer doesn't kill
// the conversation.
const UserMessageSchema = z.object({
  role: z.literal("user"),
  text: z
    .string()
    .trim()
    .min(1, "Messages can't be empty.")
    .max(MAX_MESSAGE_CHARS, `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`),
});

const PersonaMessageSchema = z.object({
  role: z.literal("persona"),
  text: z
    .string()
    .trim()
    .min(1, "Messages can't be empty.")
    .max(MAX_PERSONA_MESSAGE_CHARS, `Messages are limited to ${MAX_PERSONA_MESSAGE_CHARS} characters.`),
});

const ChatRequestSchema = z
  .object({
    personaId: z.string().trim().min(1, "personaId is required.").max(200),
    messages: z
      .array(z.discriminatedUnion("role", [UserMessageSchema, PersonaMessageSchema]))
      .max(MAX_REQUEST_MESSAGES, `Send at most ${MAX_REQUEST_MESSAGES} messages.`),
    acts: z.array(VisitorActSchema.nullable()).max(MAX_ACTS, `Send at most ${MAX_ACTS} acts.`).default([]),
    languageMode: z.enum(["realistic", "visitor"]).default("realistic"),
  })
  .superRefine((req, ctx) => {
    if (req.messages.length === 0) ctx.addIssue({ code: "custom", message: "Send at least one message." });
    else if (req.messages.at(-1)?.role !== "user") ctx.addIssue({ code: "custom", message: "The last message must be the user's." });
  });

export function parseChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  const parsed = ChatRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
}

export function toAgentMessages(messages: ChatRequestMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.slice(-HISTORY_WINDOW).map((m) => ({
    role: m.role === "persona" ? "assistant" : "user",
    content: m.text,
  }));
}
