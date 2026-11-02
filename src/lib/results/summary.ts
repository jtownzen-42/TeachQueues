// Results maths on integer cents and integer counts only. Pure.
import { numericToCents } from "./money";

export type ResultRowDb = { day: string; visits: number; purchases: number; revenue: string; fees: string; refunds: string; adSpend: string };
export type ResultRow = { day: string; visits: number; purchases: number; revenue: number; fees: number; refunds: number; adSpend: number; net: number };

export function toResultRow(r: ResultRowDb): ResultRow {
  const revenue = numericToCents(r.revenue), fees = numericToCents(r.fees), refunds = numericToCents(r.refunds), adSpend = numericToCents(r.adSpend);
  return { day: r.day, visits: r.visits, purchases: r.purchases, revenue, fees, refunds, adSpend, net: revenue - fees - refunds - adSpend };
}

/** Integer division rounding half up (a >= 0, b > 0). */
export function divRoundHalfUp(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

export type ResultsSummary = {
  totals: Omit<ResultRow, "day">;
  /** revenue - fees - refunds - ad spend (may be negative). */
  net: number;
  sentPosts: number;
  /** total revenue / sent posts in cents, rounded half up; null when no posts were read back as sent. */
  revenuePerSentPost: number | null;
  /** purchases / visits as "4.2%" (one decimal, half up); null when visits = 0. */
  conversion: string | null;
};

export function summarizeResults(rows: ResultRow[], sentPostCount: number): ResultsSummary {
  const t = { visits: 0, purchases: 0, revenue: 0, fees: 0, refunds: 0, adSpend: 0, net: 0 };
  for (const r of rows) {
    t.visits += r.visits; t.purchases += r.purchases; t.revenue += r.revenue; t.fees += r.fees; t.refunds += r.refunds; t.adSpend += r.adSpend;
  }
  t.net = t.revenue - t.fees - t.refunds - t.adSpend;
  let conversion: string | null = null;
  if (t.visits > 0) {
    const tenths = divRoundHalfUp(t.purchases * 1000, t.visits); // percent with one decimal, in tenths
    conversion = `${Math.floor(tenths / 10)}.${tenths % 10}%`;
  }
  return {
    totals: t, net: t.net, sentPosts: sentPostCount,
    revenuePerSentPost: sentPostCount > 0 ? divRoundHalfUp(t.revenue, sentPostCount) : null,
    conversion,
  };
}
