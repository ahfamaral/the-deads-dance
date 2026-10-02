import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@/lib/chat-types";
import { thinkingLine } from "@/lib/thinking";

const msg = (text: string, toolCalls: ToolCall[] = []): Message => ({ id: "m", role: "persona", text, toolCalls });
const call = (toolName: string, status: ToolCall["status"]): ToolCall => ({ id: toolName, toolName, arguments: {}, status });

describe("thinkingLine", () => {
  it("thinks before anything arrives", () => {
    expect(thinkingLine("Albert Einstein", msg(""))).toBe("Albert Einstein is thinking…");
  });

  it("remembers while search_biography runs, and weighs while fact_check_claim runs", () => {
    expect(thinkingLine("Albert Einstein", msg("", [call("search_biography", "running")]))).toBe("Albert Einstein is remembering…");
    expect(thinkingLine("Albert Einstein", msg("Hm.", [call("fact_check_claim", "running")]))).toBe("Albert Einstein is weighing that…");
  });

  it("casts back to the times while get_historical_context runs", () => {
    expect(thinkingLine("Albert Einstein", msg("", [call("get_historical_context", "running")]))).toBe("Albert Einstein is casting back to those days…");
  });

  it("is quiet once text is flowing and no tool runs", () => {
    expect(thinkingLine("Albert Einstein", msg("Well,", [call("search_biography", "ok")]))).toBeNull();
  });

  it("thinks again between a finished tool and the first words", () => {
    expect(thinkingLine("Albert Einstein", msg("", [call("search_biography", "ok")]))).toBe("Albert Einstein is thinking…");
  });
});
