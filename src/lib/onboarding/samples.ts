import "server-only";
// Two generic, fictional sample products (one lesson each) a new user can load in one click and
// remove again. Idempotent via the unique (user_id, sample_key) index. Never touches Buffer.
import { and, eq } from "drizzle-orm";
import { lessons, products } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { deleteProductTreeWith } from "@/lib/lessons/data";
import type { LessonFormat } from "@/lib/lessons/templates";

export type SampleProduct = {
  key: "sourdough" | "budget";
  name: string;
  url: string;
  brandColor: string;
  lesson: { format: LessonFormat; term: string; definition: string; example: string | null };
};

/** Fixed sample content. Fictional, generic, example.com links. */
export const SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  {
    key: "sourdough",
    name: "Sourdough Starter Guide (sample)",
    url: "https://example.com/samples/sourdough-starter-guide",
    brandColor: "#b45309",
    lesson: {
      format: "glossary",
      term: "Levain",
      definition: "A levain is a small portion of active sourdough starter mixed with fresh flour and water a few hours before baking, so the dough rises more predictably.",
      example: null,
    },
  },
  {
    key: "budget",
    name: "Budget Spreadsheet Template (sample)",
    url: "https://example.com/samples/budget-spreadsheet-template",
    brandColor: "#047857",
    lesson: {
      format: "misconception",
      term: "A budget means cutting out everything fun",
      definition: "A budget is a plan for where your money goes. You can include fun spending on purpose, so it is planned instead of a surprise.",
      example: "Set a fixed monthly amount for eating out, then spend it without guilt.",
    },
  },
] as const;

export const SAMPLE_NOTE = "Sample links point to example.com. Replace them with your own product to post for real.";

/** Insert the samples the user doesn't have yet (one transaction). Loading twice inserts nothing. */
export async function loadSamples(db: SendDb, userId: string): Promise<{ code: "samples_loaded" | "samples_already_loaded"; inserted: number }> {
  const inserted = await db.transaction(async (tx) => {
    let n = 0;
    for (const s of SAMPLE_PRODUCTS) {
      const [row] = await tx.insert(products)
        .values({ userId, name: s.name, url: s.url, brandColors: [s.brandColor], isSample: true, sampleKey: s.key })
        .onConflictDoNothing({ target: [products.userId, products.sampleKey] })
        .returning({ id: products.id });
      if (!row) continue; // already there: no lesson either
      await tx.insert(lessons).values({ productId: row.id, ...s.lesson });
      n++;
    }
    return n;
  });
  return { code: inserted > 0 ? "samples_loaded" : "samples_already_loaded", inserted };
}

/** True when a sample product and its lessons are exactly as loaded (nothing the user typed). */
export function isPristineSample(
  p: { sampleKey: string | null; name: string; url: string; brandColors: string[] | null },
  ls: { format: string; term: string; definition: string; example: string | null }[],
): boolean {
  const spec = SAMPLE_PRODUCTS.find((x) => x.key === p.sampleKey);
  if (!spec) return false;
  const colors = p.brandColors ?? [];
  if (p.name !== spec.name || p.url !== spec.url || colors.length !== 1 || colors[0] !== spec.brandColor) return false;
  if (ls.length > 1) return false;
  return ls.every((l) => l.format === spec.lesson.format && l.term === spec.lesson.term && l.definition === spec.lesson.definition && (l.example ?? null) === spec.lesson.example);
}

/** Remove this user's sample products with the same rules as deleting any product: a sample a campaign
 *  points at, or with an approved/queued draft, is kept so history is never lost. A sample the user has
 *  edited (product name/link/colour changed, a lesson edited or added) is also kept: it holds their own
 *  text now, so "Remove samples" must not delete it. Check + delete run in one transaction (row lock). */
export async function removeSamples(db: SendDb, userId: string): Promise<{ code: "samples_removed" | "samples_partly_removed" | "no_samples"; removed: number; kept: number }> {
  const rows = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.userId, userId), eq(products.isSample, true)));
  if (rows.length === 0) return { code: "no_samples", removed: 0, kept: 0 };
  let removed = 0;
  let kept = 0;
  for (const r of rows) {
    const result = await db.transaction(async (tx) => {
      const [p] = await tx.select({ sampleKey: products.sampleKey, name: products.name, url: products.url, brandColors: products.brandColors })
        .from(products).where(and(eq(products.id, r.id), eq(products.userId, userId), eq(products.isSample, true))).for("update");
      if (!p) return "not_found" as const;
      const ls = await tx.select({ format: lessons.format, term: lessons.term, definition: lessons.definition, example: lessons.example })
        .from(lessons).where(eq(lessons.productId, r.id));
      if (!isPristineSample(p, ls)) return "in_use" as const;
      return deleteProductTreeWith(tx as unknown as SendDb, userId, r.id);
    });
    if (result === "deleted") removed++;
    else if (result === "in_use") kept++;
  }
  return { code: kept > 0 ? "samples_partly_removed" : "samples_removed", removed, kept };
}
