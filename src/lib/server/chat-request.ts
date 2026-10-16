import { z } from "zod";
import { HISTORY_WINDOW, MAX_MESSAGE_CHARS, type ChatRequest, type HistoryMessage } from "@/lib/chat-types";

/** Re-exported for existing imports; the constant itself lives in chat-types.ts (F1). */
export { HISTORY_WINDOW };

// Strict: the old `messages`, `acts` and `kind` fields are a 400, so a stale client fails loudly
// instead of having its history silently ignored (spec §25.3).
const ChatRequestSchema = z
  .strictObject({
    conversationId: z.uuid("conversationId must be a UUID."),
    personaId: z.string().trim().min(1, "personaId is required.").max(200),
    text: z
      .string()
      .trim()
      .min(1, "Messages can't be empty.")
      .max(MAX_MESSAGE_CHARS, `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`)
      .optional(),
    retry: z.literal(true).optional(),
    first: z.literal(true).optional(),
    languageMode: z.enum(["realistic", "visitor"]).default("realistic"),
    mode: z.enum(["text", "voice"]).optional(),
    voiceLanguage: z.string().regex(/^[a-z]{2,3}$/, "voiceLanguage must be a language code.").optional(),
  })
  .superRefine((req, ctx) => {
    if (req.retry && req.text !== undefined) ctx.addIssue({ code: "custom", message: "Send a message or retry, not both." });
    if (req.retry && req.first) ctx.addIssue({ code: "custom", message: "A first message can't be a retry." });
    if (!req.retry && req.text === undefined) ctx.addIssue({ code: "custom", message: "Send a message." });
    if (req.mode === "voice" && req.voiceLanguage === undefined) ctx.addIssue({ code: "custom", message: "A voice conversation needs a language." });
  });

export function parseChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  const parsed = ChatRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
}

export function toAgentMessages(messages: HistoryMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages.slice(-HISTORY_WINDOW).map((m) => ({
    role: m.role === "persona" ? "assistant" : "user",
    content: m.text,
  }));
}
