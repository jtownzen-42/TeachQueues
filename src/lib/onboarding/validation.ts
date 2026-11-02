// "Brand name on your graphics" input. Pure.
import { z } from "zod";
import { MARK_MAX } from "@/lib/graphics/card";

/** Control characters other than ordinary whitespace (tab / newline / CR, which are collapsed). */
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;

/** Trimmed, whitespace collapsed, control characters rejected, max 40 code points; empty -> null. */
export const brandInput = z.object({
  brandName: z.preprocess(
    (v) => (v === undefined || v === null ? "" : v),
    z.string()
      .refine((s) => !CONTROL_RE.test(s), "Brand name can't contain control or invisible characters.")
      .transform((s) => s.replace(/\s+/gu, " ").trim())
      .refine((s) => [...s].length <= MARK_MAX, `Brand name must be ${MARK_MAX} characters or fewer.`),
  ).transform((s) => (s ? s : null)),
});
export type BrandInput = z.infer<typeof brandInput>;

/** Where a "Load sample products" / "Remove samples" form may send the user back to. */
export const ONBOARDING_BACK = ["/", "/products", "/campaigns"] as const;
export const backInput = z.object({ back: z.enum(ONBOARDING_BACK).catch("/") });
