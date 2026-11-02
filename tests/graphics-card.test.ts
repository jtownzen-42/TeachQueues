import { describe, expect, it } from "vitest";
import {
  accentFor, CARD_LIMITS, CARD_MARK, cardAltText, cardModelHash, collapse, contrastRatio, FALLBACK_ACCENT,
  lessonCardModel, onAccentFor, stableJson, truncateWords,
} from "@/lib/graphics/card";
import { currentImageUrl, isPublicBlobUrl, lessonImagePathname } from "@/lib/graphics/blob";

const product = { name: "Prompt Pantry", brandColors: ["#2563eb"] };
const lesson = { term: "Few-shot prompting", definition: "Show two or three worked examples first.", example: "Two blurbs, then a third.", format: "prompt_demo" as const };
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("truncateWords", () => {
  it("leaves short text alone (after collapsing whitespace)", () => {
    expect(truncateWords("  a\n\n b\t c  ", 10)).toBe("a b c");
  });
  for (const max of [CARD_LIMITS.title, CARD_LIMITS.body, CARD_LIMITS.example, CARD_LIMITS.product]) {
    it(`cuts on a word boundary, never over ${max}, ending with "…"`, () => {
      const out = truncateWords(words(200), max);
      expect([...out].length).toBeLessThanOrEqual(max);
      expect(out.endsWith("…")).toBe(true);
      expect(out.slice(0, -1)).toMatch(/word\d+$/); // ends on a whole word
      expect(words(200).startsWith(out.slice(0, -1))).toBe(true);
    });
  }
  it("hard-cuts a single huge word and still fits", () => {
    const out = truncateWords("W".repeat(500), 60);
    expect([...out].length).toBe(60);
    expect(out.endsWith("…")).toBe(true);
  });
  it("drops dangling punctuation before the ellipsis", () => {
    expect(truncateWords("alpha beta, gamma delta epsilon", 14)).toBe("alpha beta…");
  });
  it("counts code points (emoji) not UTF-16 units", () => {
    const out = truncateWords("😀 ".repeat(100), 20);
    expect([...out].length).toBeLessThanOrEqual(20);
  });
  it("collapse trims and squashes all whitespace", () => {
    expect(collapse(" a \n b ")).toBe("a b");
    expect(collapse(null)).toBe("");
  });
});

describe("lessonCardModel", () => {
  it("draws the lesson and product, with the mark", () => {
    const m = lessonCardModel({ lesson, product });
    expect(m).toEqual({
      title: "Few-shot prompting", body: "Show two or three worked examples first.", example: "Two blurbs, then a third.",
      productName: "Prompt Pantry", formatLabel: "Prompt demonstration", accent: "#2563eb", onAccent: "#ffffff", mark: "Alexx Forge",
    });
    expect(m.mark).toBe(CARD_MARK);
  });
  it("glossary cards have no example line; misconception cards do", () => {
    expect(lessonCardModel({ lesson: { ...lesson, format: "glossary" }, product }).example).toBeNull();
    expect(lessonCardModel({ lesson: { ...lesson, format: "misconception" }, product }).example).toBe("Two blurbs, then a third.");
    expect(lessonCardModel({ lesson: { ...lesson, example: "   " }, product }).example).toBeNull();
  });
  it("enforces every limit", () => {
    const m = lessonCardModel({ lesson: { term: words(50), definition: words(200), example: words(200), format: "prompt_demo" }, product: { name: words(30), brandColors: [] } });
    expect([...m.title].length).toBeLessThanOrEqual(CARD_LIMITS.title);
    expect([...m.body].length).toBeLessThanOrEqual(CARD_LIMITS.body);
    expect([...(m.example ?? "")].length).toBeLessThanOrEqual(CARD_LIMITS.example);
    expect([...m.productName].length).toBeLessThanOrEqual(CARD_LIMITS.product);
  });
  it.each([
    [["not-a-color"]], [["#abc"]], [["#12345g"]], [[]], [null], [undefined], ["#2563eb"], [[42]],
  ])("invalid or missing brand color %j -> fallback", (brandColors) => {
    expect(accentFor({ name: "P", brandColors })).toBe(FALLBACK_ACCENT);
  });
  it("normalises a valid color to lower case", () => {
    expect(accentFor({ name: "P", brandColors: ["#ABCDEF", "#000000"] })).toBe("#abcdef");
  });
});

describe("onAccent contrast (WCAG)", () => {
  it.each(["#000000", "#ffffff", "#777777", "#808080", "#767676", FALLBACK_ACCENT, "#fde047", "#2563eb", "#ff0000", "#00ff00"])(
    "%s -> text with >= 4.5:1", (accent) => {
      const on = onAccentFor(accent);
      expect(["#000000", "#ffffff"]).toContain(on);
      expect(contrastRatio(accent, on)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("picks the obvious one at the extremes", () => {
    expect(onAccentFor("#000000")).toBe("#ffffff");
    expect(onAccentFor("#ffffff")).toBe("#000000");
    expect(onAccentFor(FALLBACK_ACCENT)).toBe("#ffffff");
  });
  it("contrastRatio matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

describe("cardModelHash", () => {
  it("is stable for equal input and key order", () => {
    const a = lessonCardModel({ lesson, product });
    const b = lessonCardModel({ lesson: { ...lesson }, product: { ...product } });
    expect(cardModelHash(a)).toBe(cardModelHash(b));
    expect(cardModelHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stableJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });
  it("changes when the term, product or color changes", () => {
    const base = cardModelHash(lessonCardModel({ lesson, product }));
    expect(cardModelHash(lessonCardModel({ lesson: { ...lesson, term: "Zero-shot prompting" }, product }))).not.toBe(base);
    expect(cardModelHash(lessonCardModel({ lesson, product: { ...product, name: "Other" } }))).not.toBe(base);
    expect(cardModelHash(lessonCardModel({ lesson, product: { ...product, brandColors: ["#000000"] } }))).not.toBe(base);
  });
  it("whitespace-only edits don't make the image stale", () => {
    const base = cardModelHash(lessonCardModel({ lesson, product }));
    expect(cardModelHash(lessonCardModel({ lesson: { ...lesson, term: "  Few-shot \n prompting " }, product }))).toBe(base);
  });
  it("alt text names the title and product", () => {
    expect(cardAltText(lessonCardModel({ lesson, product }))).toBe("Lesson graphic: Few-shot prompting (Prompt demonstration) for Prompt Pantry");
  });
});

describe("Blob URL rules", () => {
  const good = "https://fake.public.blob.vercel-storage.com/teachqueue/lessons/x.png";
  it("accepts only https public Blob hosts", () => {
    expect(isPublicBlobUrl(good)).toBe(true);
    for (const bad of [
      "http://fake.public.blob.vercel-storage.com/x.png", "https://public.blob.vercel-storage.com/x.png",
      "https://.public.blob.vercel-storage.com/x.png", "https://evil.com/fake.public.blob.vercel-storage.com/x.png",
      "https://fake.public.blob.vercel-storage.com.evil.com/x.png", "https://u:p@fake.public.blob.vercel-storage.com/x.png",
      "https://fake.public.blob.vercel-storage.com:8443/x.png", "javascript:alert(1)", "", null, 42,
    ]) expect(isPublicBlobUrl(bad)).toBe(false);
  });
  it("pathname uses the draft id and 12 hash chars", () => {
    expect(lessonImagePathname("d-1", "abcdef0123456789")).toBe("teachqueue/lessons/d-1-abcdef012345.png");
  });
  it("currentImageUrl requires a matching hash and a valid URL", () => {
    expect(currentImageUrl({ imageUrl: good, imageHash: "h1" }, "h1")).toBe(good);
    expect(currentImageUrl({ imageUrl: good, imageHash: "h1" }, "h2")).toBeNull();
    expect(currentImageUrl({ imageUrl: "https://evil.com/x.png", imageHash: "h1" }, "h1")).toBeNull();
    expect(currentImageUrl({ imageUrl: null, imageHash: null }, "h1")).toBeNull();
  });
});
