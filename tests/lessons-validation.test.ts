import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_COLOR, draftInput, fieldErrors, formFields, httpsUrl, idInput, lessonInput, productInput } from "@/lib/lessons/validation";

describe("httpsUrl", () => {
  it.each([
    "https://example.com",
    "https://shop.example.co.uk/p/thing?ref=tq#buy",
    "  https://alexxforge.gumroad.com/l/prompt-pantry  ",
  ])("accepts %s", (u) => expect(httpsUrl.safeParse(u).success).toBe(true));

  it.each([
    ["http://example.com", "plain http"],
    ["javascript:alert(1)", "script url"],
    ["ftp://example.com", "other scheme"],
    ["example.com", "no scheme"],
    ["https://user:pw@example.com", "credentials"],
    ["https://localhost:3000", "localhost"],
    ["https://intranet", "no dot"],
    ["https://127.0.0.1/x", "bare IPv4"],
    ["https://[::1]/", "bare IPv6"],
    ["https://exa mple.com", "spaces"],
    ["", "empty"],
    [`https://example.com/${"a".repeat(500)}`, "too long"],
  ])("rejects %s (%s)", (u) => expect(httpsUrl.safeParse(u).success).toBe(false));

  it("trims surrounding whitespace", () => {
    expect(httpsUrl.parse("  https://example.com/x ")).toBe("https://example.com/x");
  });
});

describe("productInput", () => {
  it("parses a valid product and lowercases the color", () => {
    expect(productInput.parse({ name: "  Prompt Pantry ", url: "https://example.com", brandColor: "#AABBCC" }))
      .toEqual({ name: "Prompt Pantry", url: "https://example.com", brandColor: "#aabbcc" });
  });
  it("defaults the brand color when missing or blank", () => {
    expect(productInput.parse({ name: "A", url: "https://example.com" }).brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(productInput.parse({ name: "A", url: "https://example.com", brandColor: "" }).brandColor).toBe(DEFAULT_BRAND_COLOR);
  });
  it("rejects bad colors, blank and long names", () => {
    const r = productInput.safeParse({ name: "   ", url: "http://x.com", brandColor: "red" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = fieldErrors(r.error);
      expect(Object.keys(f).sort()).toEqual(["brandColor", "name", "url"]);
      expect(f.name).toMatch(/required/);
    }
    expect(productInput.safeParse({ name: "x".repeat(81), url: "https://example.com" }).success).toBe(false);
  });
});

describe("lessonInput", () => {
  const base = { term: "Few-shot", definition: "Show examples first.", example: "Two blurbs, then a third.", format: "glossary" };

  it("accepts all three formats", () => {
    for (const format of ["glossary", "prompt_demo", "misconception"]) {
      expect(lessonInput.safeParse({ ...base, format }).success).toBe(true);
    }
  });
  it("rejects unknown formats", () => {
    expect(lessonInput.safeParse({ ...base, format: "essay" }).success).toBe(false);
    expect(lessonInput.safeParse({ ...base, format: undefined }).success).toBe(false);
  });
  it("turns a blank or missing example into null", () => {
    expect(lessonInput.parse({ ...base, example: "   " }).example).toBeNull();
    expect(lessonInput.parse({ ...base, example: undefined }).example).toBeNull();
  });
  it("normalises CRLF and trims", () => {
    expect(lessonInput.parse({ ...base, definition: "  line one\r\nline two  " }).definition).toBe("line one\nline two");
  });
  it("enforces lengths", () => {
    expect(lessonInput.safeParse({ ...base, term: "" }).success).toBe(false);
    expect(lessonInput.safeParse({ ...base, term: "t".repeat(81) }).success).toBe(false);
    expect(lessonInput.safeParse({ ...base, definition: "d".repeat(601) }).success).toBe(false);
    expect(lessonInput.safeParse({ ...base, example: "e".repeat(601) }).success).toBe(false);
    expect(lessonInput.safeParse({ ...base, definition: "d".repeat(600), example: "e".repeat(600) }).success).toBe(true);
  });
});

describe("draftInput / idInput", () => {
  const id = "3f1b8f5e-2c4d-4a6b-9e8f-0123456789ab";
  it("requires a uuid lesson id and all three texts", () => {
    expect(draftInput.safeParse({ lessonId: id, x: "a", facebook: "b", linkedin: "c" }).success).toBe(true);
    expect(draftInput.safeParse({ lessonId: "1; drop table", x: "a", facebook: "b", linkedin: "c" }).success).toBe(false);
    expect(draftInput.safeParse({ lessonId: id, x: "a", facebook: "b" }).success).toBe(false);
  });
  it("bounds absurd sizes", () => {
    expect(draftInput.safeParse({ lessonId: id, x: "a".repeat(281 * 4), facebook: "b", linkedin: "c" }).success).toBe(false);
  });
  it("idInput rejects non-uuids", () => {
    expect(idInput.safeParse("abc").success).toBe(false);
    expect(idInput.safeParse(id).success).toBe(true);
  });
});

describe("formFields", () => {
  it("reads strings and ignores files and missing keys", () => {
    const fd = new FormData();
    fd.set("name", "A");
    fd.set("file", new Blob(["x"]), "x.txt");
    expect(formFields(fd, ["name", "file", "nope"])).toEqual({ name: "A", file: undefined, nope: undefined });
  });
});
