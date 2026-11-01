import { describe, expect, it } from "vitest";
import {
  charCount, draftAll, draftFor, draftProblems, hashtagFor, isOverLimit, LESSON_FORMATS, LIMITS, NETWORKS,
  signature, X_URL_LENGTH, type LessonFields, type LessonFormat, type Network,
} from "@/lib/lessons/templates";

const product = { name: "Prompt Pantry", url: "https://alexxforge.gumroad.com/l/prompt-pantry" };
const sig = signature(product);

const lessonFor = (format: LessonFormat, over: Partial<LessonFields> = {}): LessonFields => ({
  format,
  term: format === "misconception" ? "AI remembers everything you told it last week" : "Few-shot prompting",
  definition: "Showing the model two or three worked examples before your real request so it copies the pattern.",
  example: "Here are two product blurbs I like. Write a third in the same style for my candle shop.",
  ...over,
});

const long = (n: number, word = "lorem") => Array.from({ length: n }, () => word).join(" ");

describe("charCount", () => {
  it("counts code points for Facebook and LinkedIn", () => {
    expect(charCount("héllo", "facebook")).toBe(5);
    expect(charCount("👍👍", "linkedin")).toBe(2);
  });
  it("counts each link as 23 on X regardless of its length", () => {
    expect(charCount("see https://a.co", "x")).toBe(4 + X_URL_LENGTH);
    expect(charCount(`see ${"https://example.com/" + "a".repeat(200)}`, "x")).toBe(4 + X_URL_LENGTH);
  });
  it("weighs emoji and CJK as 2 on X", () => {
    expect(charCount("日本", "x")).toBe(4);
    expect(charCount("a👍", "x")).toBe(3);
  });
});

describe("draftFor: every format × network", () => {
  for (const format of LESSON_FORMATS) {
    for (const network of NETWORKS) {
      it(`${format} / ${network}: fits the limit and ends with the product signature`, () => {
        const lesson = lessonFor(format);
        const text = draftFor(lesson, product, network);
        expect(charCount(text, network)).toBeLessThanOrEqual(LIMITS[network]);
        expect(isOverLimit(text, network)).toBe(false);
        expect(text.endsWith(sig)).toBe(true);
        expect(text).toContain(lesson.term);
        expect(text).toContain(lesson.definition);
      });

      it(`${format} / ${network}: trims long input but keeps the signature`, () => {
        const lesson = lessonFor(format, { term: long(14, "term").slice(0, 80), definition: long(120).slice(0, 600), example: long(120, "ipsum").slice(0, 600) });
        const text = draftFor(lesson, product, network);
        expect(charCount(text, network)).toBeLessThanOrEqual(LIMITS[network]);
        expect(text.endsWith(sig)).toBe(true);
      });

      it(`${format} / ${network}: works without an example`, () => {
        const text = draftFor(lessonFor(format, { example: null }), product, network);
        expect(text.endsWith(sig)).toBe(true);
        expect(text).not.toMatch(/Example: \n|undefined|null/);
      });
    }
  }

  it("is deterministic", () => {
    const l = lessonFor("glossary");
    expect(draftAll(l, product)).toEqual(draftAll(l, product));
  });

  it("uses distinct wording per format", () => {
    const x = (f: LessonFormat) => draftFor(lessonFor(f), product, "x");
    expect(x("glossary")).toMatch(/^Word of the day: /);
    expect(x("prompt_demo")).toMatch(/^Prompt to try: /);
    expect(x("misconception")).toMatch(/^Myth: /);
  });

  it("trims the example before the definition on X", () => {
    const text = draftFor(lessonFor("glossary", { definition: "Short definition here.", example: long(100, "ipsum") }), product, "x");
    expect(text).toContain("Short definition here.");
    expect(charCount(text, "x")).toBeLessThanOrEqual(280);
  });

  it("adds a hashtag on LinkedIn only", () => {
    const l = lessonFor("glossary");
    expect(draftFor(l, product, "linkedin")).toContain("#FewShotPrompting");
    expect(draftFor(l, product, "x")).not.toContain("#");
    expect(draftFor(l, product, "facebook")).not.toContain("#");
  });

  it("returns over-limit text when the signature alone can't fit on X", () => {
    const huge = { name: "N".repeat(300), url: "https://example.com" };
    const text = draftFor(lessonFor("glossary"), huge, "x");
    expect(isOverLimit(text, "x")).toBe(true);
    expect(text.endsWith(signature(huge))).toBe(true);
  });
});

describe("hashtagFor", () => {
  it("camel-cases words and drops punctuation", () => {
    expect(hashtagFor("prompt engineering 101!")).toBe("#PromptEngineering101");
    expect(hashtagFor("café-au-lait")).toBe("#CafeAuLait");
  });
  it("returns empty for unusable terms", () => {
    expect(hashtagFor("!!!")).toBe("");
    expect(hashtagFor("2026")).toBe("");
  });
});

describe("draftProblems", () => {
  const ok = draftAll(lessonFor("glossary"), product);

  it("accepts template output", () => {
    expect(draftProblems(ok, product)).toEqual({});
  });
  it("flags over-limit text per network", () => {
    const n: Network = "x";
    const bad = { ...ok, [n]: `${"a".repeat(300)}\n\n${sig}` };
    expect(draftProblems(bad, product).x).toMatch(/over the 280 limit/);
    expect(draftProblems(bad, product).facebook).toBeUndefined();
  });
  it("flags a missing signature and empty text", () => {
    expect(draftProblems({ ...ok, facebook: "no link here" }, product).facebook).toMatch(/must end with/);
    expect(draftProblems({ ...ok, linkedin: "   " }, product).linkedin).toMatch(/empty/);
  });
  it("enforces Facebook 2,000 and LinkedIn 3,000", () => {
    const fb = `${"b".repeat(2001 - sig.length - 2)}\n\n${sig}`;
    const li = `${"c".repeat(3001 - sig.length - 2)}\n\n${sig}`;
    expect(charCount(fb, "facebook")).toBe(2001);
    expect(draftProblems({ ...ok, facebook: fb, linkedin: li }, product)).toMatchObject({
      facebook: expect.stringMatching(/1 character over the 2,000/),
      linkedin: expect.stringMatching(/1 character over the 3,000/),
    });
  });
});
