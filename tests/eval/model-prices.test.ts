import { describe, expect, it } from "vitest";
import { describeModels, fetchModelPrices, isFixedPrice, PRICE_REFERENCE, priceScale } from "../../eval/model-prices";

const list = { data: [
  { id: "deepseek/deepseek-v4-pro", pricing: { prompt: "0.00000096", completion: "0.00000191" } },
  { id: "anthropic/claude-haiku-5.5", pricing: { prompt: "0.0000001", completion: "0.0000005" } },
  { id: "typesafe/jev-router", pricing: { prompt: "-1", completion: "-1" } },
  { id: "someone/free-model", pricing: { prompt: "0", completion: "0" } },
] };
const fakeFetch = (async () => new Response(JSON.stringify(list))) as typeof fetch;

describe("model prices (spec §30.6)", () => {
  it("reads OpenRouter's list as micro-dollars per token", async () => {
    const prices = await fetchModelPrices(fakeFetch);
    const haiku = prices.get("anthropic/claude-haiku-5.5")!;
    expect(haiku.prompt).toBeCloseTo(0.1, 9); // 1e-7 × 1e6 is 0.0999… in floating point
    expect(haiku.completion).toBeCloseTo(0.5, 9);
  });
  it("scales by the cost of a baseline-sized answer against v4-pro, whatever the app's model", async () => {
    expect(PRICE_REFERENCE).toBe("deepseek/deepseek-v4-pro");
    const prices = await fetchModelPrices(fakeFetch);
    expect(priceScale(prices, "deepseek/deepseek-v4-pro")).toBe(1);
    const expected = (9_119 * 0.1 + 2_221 * 0.5) / (9_119 * 0.96 + 2_221 * 1.91);
    expect(priceScale(prices, "anthropic/claude-haiku-5.5")).toBeCloseTo(expected, 6);
  });
  it("refuses a model OpenRouter doesn't list, rather than guess", async () => {
    expect(() => priceScale(new Map(), "nobody/model")).toThrow(/not on OpenRouter's price list/);
  });
  it("refuses a variable or zero price, which would give a negative or empty estimate", async () => {
    const prices = await fetchModelPrices(fakeFetch);
    expect(() => priceScale(prices, "typesafe/jev-router")).toThrow(/no fixed price/);
    expect(() => priceScale(prices, "someone/free-model")).toThrow(/no fixed price/);
    expect(isFixedPrice(prices.get("anthropic/claude-haiku-5.5"))).toBe(true);
    expect(isFixedPrice({ prompt: Number.NaN, completion: 1 })).toBe(false);
    expect(isFixedPrice(undefined)).toBe(false);
  });
  it("names each model and its scale for the dry run", () => {
    expect(describeModels([{ setupId: "m-haiku", model: "anthropic/claude-haiku-5.5", scale: 0.21 }]))
      .toBe("Models: m-haiku anthropic/claude-haiku-5.5 (×0.21 v4-pro's price per answer)");
  });
});
