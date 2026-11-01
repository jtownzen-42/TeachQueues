// zod input schemas for the Lesson desk. Pure (no server-only imports) so vitest can cover them.
import { z } from "zod";
import { LESSON_FORMATS, LIMITS, NETWORKS, type Network } from "./templates";

export const DEFAULT_BRAND_COLOR = "#2563eb";

const text = (label: string, max: number) =>
  z.string({ error: `${label} is required.` })
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));

/** https only, no embedded credentials, a real-looking public host. */
export const httpsUrl = z.string({ error: "URL is required." }).trim()
  .min(1, "URL is required.")
  .max(500, "URL must be 500 characters or fewer.")
  .refine((s) => !/\s/.test(s), "URL can't contain spaces.")
  .refine((s) => {
    let u: URL;
    try { u = new URL(s); } catch { return false; }
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return false; // bare IPs
    return true;
  }, "Enter a full https:// link to your product page, like https://example.com/product.");

export const brandColor = z.string().trim().toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Brand color must be a hex color like #2563eb.");

export const productInput = z.object({
  name: text("Product name", 80),
  url: httpsUrl,
  brandColor: z.preprocess((v) => (v === undefined || v === null || v === "" ? DEFAULT_BRAND_COLOR : v), brandColor),
});
export type ProductInput = z.infer<typeof productInput>;

export const lessonInput = z.object({
  term: text("Term", 80),
  definition: text("Definition", 600),
  example: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v),
    z.string().max(600, "Example must be 600 characters or fewer.").optional().nullable(),
  ).transform((v) => (v ? v : null)),
  format: z.enum(LESSON_FORMATS, { error: "Pick a lesson format." }),
});
export type LessonInput = z.infer<typeof lessonInput>;

export const idInput = z.uuid({ error: "Not found." });

/** Raw per-network text from the draft editor. Content rules (limits, signature) are
 *  checked against the product with draftProblems(); here we only bound the size. */
const draftText = (n: Network) =>
  z.string({ error: "Text is required." })
    .max(LIMITS[n] * 4, "Text is far too long.")
    .transform((s) => s.replace(/\r\n?/g, "\n").trim());

export const draftInput = z.object({
  lessonId: idInput,
  x: draftText("x"),
  facebook: draftText("facebook"),
  linkedin: draftText("linkedin"),
});

export const DRAFT_FIELDS = ["lessonId", ...NETWORKS] as const;
export type DraftInput = z.infer<typeof draftInput>;

export type FieldErrors = Record<string, string>;

/** First error message per top-level field, for showing next to inputs. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Read string fields from FormData (missing -> undefined, files ignored). */
export function formFields(fd: FormData, keys: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    const v = fd.get(k);
    out[k] = typeof v === "string" ? v : undefined;
  }
  return out;
}
