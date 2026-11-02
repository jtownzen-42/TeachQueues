// Renders real PNGs with next/og (bundled font, no network) and checks size and format.
// Set CARD_PREVIEW_DIR to also write the PNGs to disk for a visual check.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_LIMITS, lessonCardModel } from "@/lib/graphics/card";
import { cardFontSizes, renderLessonCard, renderLessonCardPng } from "@/lib/graphics/render";

const words = (n: number, w = "lorem") => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(" ");

const cases = {
  short_glossary: lessonCardModel({
    lesson: { term: "Few-shot prompting", definition: "Show the model two or three worked examples first so it copies the pattern.", example: "ignored for glossary", format: "glossary" },
    product: { name: "Prompt Pantry", brandColors: ["#2563eb"] },
  }),
  max_prompt_demo: lessonCardModel({
    lesson: { term: words(20, "Wording"), definition: words(80), example: words(60, "ipsum"), format: "prompt_demo" },
    product: { name: words(10, "Productname"), brandColors: ["#fde047"] },
  }),
  max_glossary_fallback: lessonCardModel({
    lesson: { term: "W".repeat(70), definition: "Wide ".repeat(60) + "WWWWWWWWWW MMMMMMMMMM", format: "glossary" },
    product: { name: "M".repeat(50), brandColors: ["not-a-color"] },
  }),
  misconception: lessonCardModel({
    lesson: { term: "AI remembers everything you told it last week", definition: "Most chat tools only see the current conversation unless memory is switched on.", example: "Ask it about last Tuesday's chat and it won't know.", format: "misconception" },
    product: { name: "Stele Studio", brandColors: ["#111827"] },
  }),
};

function pngSize(buf: Uint8Array) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...buf.slice(0, 8)]).toEqual(sig);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

describe("renderLessonCard", () => {
  for (const [name, model] of Object.entries(cases)) {
    it(`${name}: 1080x1080 PNG`, async () => {
      const png = new Uint8Array(await renderLessonCardPng(model));
      expect(pngSize(png)).toEqual({ w: 1080, h: 1080 });
      expect(png.byteLength).toBeGreaterThan(5_000);
      const dir = process.env.CARD_PREVIEW_DIR;
      if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${name}.png`), png); }
    }, 30_000);
  }

  it("route response carries image/png and private, no-store", async () => {
    const res = renderLessonCard(cases.short_glossary, { "Cache-Control": "private, no-store", "Content-Type": "image/png" });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await res.arrayBuffer();
  }, 30_000);

  it("max-length text uses the smallest font steps", () => {
    expect([...cases.max_prompt_demo.title].length).toBeLessThanOrEqual(CARD_LIMITS.title);
    expect(cardFontSizes(cases.max_prompt_demo)).toEqual({ title: 60, body: 32, example: 30 });
    expect(cardFontSizes(cases.short_glossary).title).toBe(84);
  });
});
