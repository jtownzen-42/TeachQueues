// What the 1080x1080 lesson graphic draws, as plain data (no JSX), so it is unit-testable and
// hashable. Text comes only from the user's own lesson/product rows plus fixed labels.
import { createHash } from "node:crypto";
import { primaryColor } from "@/lib/lessons/data";
import { FORMAT_LABELS, type LessonFormat } from "@/lib/lessons/templates";

/** Max lengths in characters (code points), ellipsis included. Chosen so the longest allowed
 *  text still fits the layout in render.tsx at its smallest font step. */
export const CARD_LIMITS = { title: 60, body: 220, example: 140, product: 40 } as const;
/** Used when the product has no valid #rrggbb brand color. */
export const FALLBACK_ACCENT = "#1f4e79";
/** Max code points of the per-user brand name drawn in the corner (users.brand_name). */
export const MARK_MAX = 40;
/** Bump when the drawing changes, so saved images built from the old design read as out of date. */
export const CARD_DESIGN_VERSION = 1;

export type LessonCardModel = {
  title: string;
  body: string;
  /** Short example line (prompt demonstrations and misconceptions only). */
  example: string | null;
  productName: string;
  formatLabel: string;
  accent: string;
  onAccent: "#000000" | "#ffffff";
  /** The user's brand name, or null for no mark (nothing drawn in that corner). */
  mark: string | null;
};

type LessonIn = { term: string; definition: string; example?: string | null; format: LessonFormat };
type ProductIn = { name: string; brandColors: string[] | null | unknown };

/** Collapse all whitespace (including newlines) to single spaces and trim. */
export function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/gu, " ").trim();
}

/** Truncate to at most `max` code points on a word boundary, ending with "…" when cut. */
export function truncateWords(s: string, max: number): string {
  const text = collapse(s);
  const cps = [...text];
  if (cps.length <= max) return text;
  const room = cps.slice(0, max - 1).join(""); // leave one code point for the ellipsis
  const lastSpace = room.lastIndexOf(" ");
  // Cut at the last word boundary unless that throws away more than half the room (one huge word).
  const cut = lastSpace >= Math.floor(room.length / 2) ? room.slice(0, lastSpace) : room;
  return cut.replace(/[\s.,;:!?\-–—(\[{"'“‘]+$/u, "") + "…";
}

// ---- WCAG 2.x contrast ----
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white, whichever contrasts more with the accent. For any sRGB color the better of
 *  the two is at least ~4.58:1, so this always meets WCAG AA (4.5:1) for normal text. */
export function onAccentFor(accent: string): "#000000" | "#ffffff" {
  return contrastRatio(accent, "#000000") >= contrastRatio(accent, "#ffffff") ? "#000000" : "#ffffff";
}

export function accentFor(product: ProductIn): string {
  const c = primaryColor({ brandColors: Array.isArray(product.brandColors) ? product.brandColors : [] });
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : FALLBACK_ACCENT;
}

/** users.brand_name -> the mark to draw: trimmed, whitespace collapsed, word-truncated to MARK_MAX;
 *  null / empty -> null (no mark). */
export function brandMark(brandName: string | null | undefined): string | null {
  const t = truncateWords(brandName ?? "", MARK_MAX);
  return t ? t : null;
}

export function lessonCardModel({ lesson, product, brandName }: { lesson: LessonIn; product: ProductIn; brandName?: string | null }): LessonCardModel {
  const accent = accentFor(product);
  const showExample = lesson.format === "prompt_demo" || lesson.format === "misconception";
  const ex = showExample ? collapse(lesson.example) : "";
  return {
    title: truncateWords(lesson.term, CARD_LIMITS.title),
    body: truncateWords(lesson.definition, CARD_LIMITS.body),
    example: ex ? truncateWords(ex, CARD_LIMITS.example) : null,
    productName: truncateWords(product.name, CARD_LIMITS.product),
    formatLabel: FORMAT_LABELS[lesson.format] ?? FORMAT_LABELS.glossary,
    accent,
    onAccent: onAccentFor(accent),
    mark: brandMark(brandName),
  };
}

/** JSON with object keys sorted at every level, so equal models always serialize the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** SHA-256 hex of the model (plus the design version). Tells when a saved image is out of date. */
export function cardModelHash(model: LessonCardModel): string {
  return createHash("sha256").update(stableJson({ v: CARD_DESIGN_VERSION, model })).digest("hex");
}

/** Alt text for the preview and saved image. */
export function cardAltText(model: LessonCardModel): string {
  return `Lesson graphic: ${model.title} (${model.formatLabel}) for ${model.productName}`;
}
