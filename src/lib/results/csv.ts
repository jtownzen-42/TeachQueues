// Results CSV with formula-injection neutralization. Pure.
import { centsToCsv } from "./money";
import type { ResultRow } from "./summary";

export const CSV_HEADER = ["day", "visits", "purchases", "revenue", "fees", "refunds", "ad_spend", "net"];

/** Quote a cell; prefix ' to anything a spreadsheet could read as a formula (=, +, -, @, tab, CR). */
export function csvCell(v: string, opts: { numeric?: boolean } = {}): string {
  let s = String(v);
  if (!opts.numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Days newest first; money in dollars with 2 decimals. Our own numeric cells (counts and amounts,
 *  including a negative net like -12.30) are not prefixed: they're generated, not user text. */
export function resultsCsv(rows: ResultRow[]): string {
  const lines = [CSV_HEADER.map((h) => csvCell(h)).join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.day),
      csvCell(String(r.visits), { numeric: true }), csvCell(String(r.purchases), { numeric: true }),
      csvCell(centsToCsv(r.revenue), { numeric: true }), csvCell(centsToCsv(r.fees), { numeric: true }),
      csvCell(centsToCsv(r.refunds), { numeric: true }), csvCell(centsToCsv(r.adSpend), { numeric: true }),
      csvCell(centsToCsv(r.net), { numeric: true }),
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
