import { describe, expect, it } from "vitest";
import { slugify } from "../../corpus/slug";

describe("slugify", () => {
  it("matches the curated slugs", () => {
    expect(slugify("Alberto Santos-Dumont", "q1")).toBe("alberto-santos-dumont");
    expect(slugify("Chien-Shiung Wu", "q1")).toBe("chien-shiung-wu");
  });

  it("strips diacritics and punctuation", () => {
    expect(slugify("Marie Skłodowska-Curie", "q1")).toBe("marie-sklodowska-curie");
    expect(slugify("Émilie du Châtelet", "q1")).toBe("emilie-du-chatelet");
    expect(slugify("Martin Luther King Jr.", "q1")).toBe("martin-luther-king-jr");
  });

  it("falls back when nothing Latin is left", () => {
    expect(slugify("吳健雄", "q450317")).toBe("q450317");
  });
});
