// Money as integer cents everywhere in app code. No floating-point arithmetic: amounts are parsed
// digit by digit; the DB keeps exact numeric(10,2).

/** Largest amount that fits numeric(10,2): 99,999,999.99. */
export const MAX_CENTS = 9_999_999_999;
const MONEY_RE = /^(\d{1,8})(?:\.(\d{1,2}))?$/;

/** "12.30" -> 1230, "$1,234.50" -> 123450, "0.5" -> 50. Returns null for anything else
 *  (negatives, more than 2 decimals, exponents, > 99,999,999.99, letters). `$`, commas and spaces are stripped first. */
export function parseCents(input: string | null | undefined): number | null {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  const m = MONEY_RE.exec(s);
  if (!m) return null;
  const whole = Number(m[1]); // integer digits only
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return whole * 100 + frac; // exact: integers well below 2^53
}

/** numeric(10,2) value from the DB (a string like "12.30", "0", "-5.10") -> cents. Throws on garbage. */
export function numericToCents(v: string | number | null | undefined): number {
  const s = String(v ?? "0").trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error("Not a numeric(10,2) value");
  const cents = Number(m[2]) * 100 + (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
  return m[1] ? -cents : cents;
}

/** 1230 -> "12.30" (for numeric(10,2) columns). */
export function centsToNumeric(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("cents must be a safe integer");
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 1230 -> "$12.30"; 123456789 -> "$1,234,567.89"; -1230 -> "−$12.30" (real minus sign U+2212). */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Cents as plain dollars for CSV: 1230 -> "12.30", -50 -> "-0.50". */
export const centsToCsv = centsToNumeric;
