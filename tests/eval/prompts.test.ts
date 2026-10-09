import { describe, expect, it } from "vitest";
import { buildPromptF, CLOSING, OPENER_RULE, SUICIDE_RULE } from "../../eval/prompts/f";
import { withoutLines } from "../../eval/prompts/sections";
import { buildPromptV3, HARD_RULES_BLOCK, RECAP } from "../../eval/prompts/v3";
import { buildPromptV4, EXAMPLES_V4 } from "../../eval/prompts/v4";
import { buildPromptV5With, VOICE_CARD_RULE } from "../../eval/prompts/v5";
import { buildPersonaPrompt } from "@/lib/server/persona-prompt";

const santos = { displayName: "Alberto Santos-Dumont", description: "Aviation pioneer", lifespan: "1873–1932", profile: null };
const on = { toolsAvailable: true };

describe("withoutLines", () => {
  it("drops the lines that start with a prefix, keeps the rest", () => {
    expect(withoutLines("a\n- drop me\nb", ["- drop"])).toBe("a\nb");
  });
});

describe("F (spec §30.3)", () => {
  const f = buildPromptF(santos, on);
  it("adds the suicide rule, the opener rule and the closing reminder, last", () => {
    expect(f).toContain(SUICIDE_RULE);
    expect(f).toContain(OPENER_RULE);
    expect(f.endsWith(CLOSING)).toBe(true);
  });
  it("no longer says 'search your memory', which primes the opener", () => {
    expect(buildPersonaPrompt(santos, on)).toContain("search your memory");
    expect(f).not.toMatch(/search your memory/i);
  });
  it("keeps everything else of today's prompt", () => {
    expect(f).toContain("<persona_facts>");
    expect(f).toContain("Never describe how a suicide was carried out");
  });
});

describe("V3 (spec §30.3)", () => {
  const v3 = buildPromptV3(santos, on);
  it("puts the hard rules right after the persona's blocks and closes with the recap", () => {
    expect(v3.indexOf(HARD_RULES_BLOCK)).toBeGreaterThan(v3.indexOf("</persona_facts>"));
    expect(v3.indexOf(HARD_RULES_BLOCK)).toBeLessThan(v3.indexOf("Your memory:"));
    expect(v3.endsWith(RECAP)).toBe(true);
  });
  it("doesn't repeat what the block already says", () => {
    expect(v3).not.toContain(SUICIDE_RULE);
    expect(v3).not.toContain(OPENER_RULE);
    expect(v3).not.toContain(CLOSING);
    expect(v3).not.toMatch(/search your memory/i);
  });
});

describe("V4 (spec §30.3)", () => {
  const v4 = buildPromptV4(santos, on);
  it("shows the failure cases in the keeper's examples", () => {
    expect(v4).toContain(EXAMPLES_V4);
    expect(EXAMPLES_V4).toMatch(/moon/i); // after his death
    expect(EXAMPLES_V4).toMatch(/How did you die\?/);
  });
  it("cuts the manner rules the examples show, keeps F's fixes", () => {
    expect(v4).not.toContain("Don't tell the same story twice");
    expect(v4).not.toContain("When a story is long, tell the first part");
    expect(v4).toContain(SUICIDE_RULE);
    expect(v4.endsWith(CLOSING)).toBe(true);
  });
});

describe("V5 (spec §30.3)", () => {
  const v5 = buildPromptV5With({ "Alberto Santos-Dumont": "Courteous, <quick> French-tinged phrasing." });
  it("puts the persona's card right after the facts, as data", () => {
    const p = v5(santos, on);
    expect(p).toContain("<voice_card>\nCourteous, quick French-tinged phrasing.\n</voice_card>");
    expect(p.indexOf("<voice_card>")).toBeGreaterThan(p.indexOf("</persona_facts>"));
    expect(p).toContain(VOICE_CARD_RULE);
    expect(p.endsWith(CLOSING)).toBe(true);
  });
  it("drops the generic manners line the card replaces", () => {
    expect(v5(santos, on)).not.toContain("- Your manners are your own and of your time");
  });
  it("falls back to F for a persona without a card", () => {
    expect(v5({ ...santos, displayName: "Getúlio Vargas" }, on)).toBe(buildPromptF({ ...santos, displayName: "Getúlio Vargas" }, on));
  });
  it("V3's block keeps F's exact wording for suicide and openers (final review #9)", () => {
    expect(HARD_RULES_BLOCK).toContain("say so in a few words at most, or not at all. Never the means, the place or the object, not even in passing.");
    expect(HARD_RULES_BLOCK).toContain("Never announce that you are remembering, searching or thinking.");
  });
});
