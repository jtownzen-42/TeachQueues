// zod input schemas for the Marketing desk. Pure (no server-only imports) so vitest can cover them.
import { z } from "zod";
import { idInput } from "@/lib/lessons/validation";
import { CAMPAIGN_NETWORKS, CAMPAIGN_LIMITS } from "./templates";

/** Trim + normalise newlines, then 1..max (same pattern as text() in src/lib/lessons/validation.ts). */
const text = (label: string, max: number) =>
  z.string({ error: `${label} is required.` })
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`));

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A real calendar date "YYYY-MM-DD" (2026-02-30 is rejected). */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const optionalDate = (label: string) => z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v),
  z.string().refine(isCalendarDate, `${label} must be a real date (YYYY-MM-DD).`).optional().nullable(),
).transform((v) => v ?? null);

export const briefInput = z.object({
  productId: z.uuid({ error: "Pick one of your products." }),
  name: text("Campaign name", 80),
  goal: text("Goal", 200),
  audience: text("Audience", 200),
  angle: text("Offer / angle", 300),
  keyMessage: text("Key message", 280),
  cta: text("Call to action", 60),
  startsOn: optionalDate("Start date"),
  endsOn: optionalDate("End date"),
  /** Blank -> null: links then use slugify(name). */
  utmCampaign: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(60, "UTM campaign must be 60 characters or fewer.")
      .refine((s) => s === "" || SLUG_RE.test(s), "Use lower-case letters, numbers and single dashes, like spring-launch.")
      .optional().nullable(),
  ).transform((v) => (v ? v : null)),
}).superRefine((v, ctx) => {
  if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) {
    ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date can't be before the start date." });
  }
});
export type BriefInput = z.infer<typeof briefInput>;
export const BRIEF_FIELDS = ["productId", "name", "goal", "audience", "angle", "keyMessage", "cta", "startsOn", "endsOn", "utmCampaign"] as const;

const variantText = (max: number) =>
  z.string({ error: "Text is required." }).max(max * 4, "Text is far too long.").transform((s) => s.replace(/\r\n?/g, "\n").trim());

/** Raw texts from the variants editor. Content rules (limits, link, product name) are checked
 *  against the campaign with campaignDraftProblems(); here we only bound the size. */
export const variantsInput = z.object({
  campaignId: idInput,
  x: variantText(CAMPAIGN_LIMITS.x),
  facebook: variantText(CAMPAIGN_LIMITS.facebook),
  linkedin: variantText(CAMPAIGN_LIMITS.linkedin),
  reddit: variantText(CAMPAIGN_LIMITS.reddit),
});
export const VARIANT_FIELDS = ["campaignId", ...CAMPAIGN_NETWORKS] as const;

export const approveInput = z.object({
  campaignId: idInput,
  draftId: idInput,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  checkAccurate: z.string().max(8).optional().nullable(),
  checkLink: z.string().max(8).optional().nullable(),
});
export const APPROVE_FIELDS = ["campaignId", "draftId", "hash", "checkAccurate", "checkLink"] as const;

export const campaignImageInput = z.object({ campaignId: idInput, draftId: idInput });
