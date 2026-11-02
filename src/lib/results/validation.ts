// zod for one Results day. Pure. Money is validated and converted to integer cents here.
import { z } from "zod";
import { idInput } from "@/lib/lessons/validation";
import { isCalendarDate } from "@/lib/campaigns/validation";
import { addDays, localDayKey } from "@/lib/calendar/range";
import { parseCents } from "./money";

export const MAX_COUNT = 10_000_000;
export const RESULT_FIELDS = ["campaignId", "day", "visits", "purchases", "revenue", "fees", "refunds", "adSpend"] as const;

const count = (label: string) => z.preprocess(
  (v) => (typeof v === "string" ? v.trim().replace(/,/g, "") : v) || "0",
  z.string().regex(/^\d{1,8}$/, `${label} must be a whole number.`)
    .transform(Number).refine((n) => n <= MAX_COUNT, `${label} can be at most 10,000,000.`),
);
const money = (label: string) => z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v) || "0",
  z.string().transform((s, ctx) => {
    const c = parseCents(s);
    if (c === null) {
      ctx.addIssue({ code: "custom", message: `${label} must be an amount like 12.30 (no negatives, at most 99,999,999.99).` });
      return z.NEVER;
    }
    return c;
  }),
);

/** Built per request: `day` may be at most 1 day after today in the user's zone. */
export function resultInput(tz: string, now: Date) {
  const latest = addDays(localDayKey(now, tz), 1);
  return z.object({
    campaignId: idInput,
    day: z.string().trim().refine(isCalendarDate, "Day must be a real date (YYYY-MM-DD).")
      .refine((d) => d <= latest, "Day can't be more than one day in the future."),
    visits: count("Visits"),
    purchases: count("Purchases"),
    revenue: money("Revenue"),
    fees: money("Fees"),
    refunds: money("Refunds"),
    adSpend: money("Ad spend"),
  });
}

export const deleteResultInput = z.object({
  campaignId: idInput,
  day: z.string().trim().refine(isCalendarDate),
});
