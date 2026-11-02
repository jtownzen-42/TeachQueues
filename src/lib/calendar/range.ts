// Week / month ranges and local-day grouping in the user's zone. Pure; DST-safe via @date-fns/tz.
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { safeTimeZone } from "@/lib/tz";
import { isCalendarDate } from "@/lib/campaigns/validation";

export type CalendarView = "week" | "month";
export type CalendarRange = {
  view: CalendarView;
  /** First local day (YYYY-MM-DD): Monday for a week, the 1st for a month. */
  start: string;
  /** Local days in the range, in order. */
  days: string[];
  prev: string;
  next: string;
  isCurrent: boolean;
};

const paramsSchema = z.object({
  view: z.enum(["week", "month"]).catch("week"),
  start: z.string().refine(isCalendarDate).optional().catch(undefined),
});

/** "YYYY-MM-DD" of a UTC instant in `tz`. */
export function localDayKey(iso: string | Date, tz: string): string {
  const d = new TZDate(new Date(iso).getTime(), safeTimeZone(tz));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Calendar-date arithmetic on plain dates (no time zone involved).
const toUtc = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => { const d = toUtc(key); d.setUTCDate(d.getUTCDate() + n); return fromUtc(d); };
const addMonths = (key: string, n: number) => { const d = toUtc(key); return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
const mondayOf = (key: string) => { const d = toUtc(key); return addDays(key, -((d.getUTCDay() + 6) % 7)); };
const firstOfMonth = (key: string) => `${key.slice(0, 8)}01`;

/** Parse ?view=week|month&start=YYYY-MM-DD. Bad params fall back to the current week (never an error). */
export function calendarRange(params: { view?: unknown; start?: unknown }, tz: string, now: Date): CalendarRange {
  const raw = { view: Array.isArray(params.view) ? params.view[0] : params.view, start: Array.isArray(params.start) ? params.start[0] : params.start };
  const p = paramsSchema.safeParse(raw);
  const view: CalendarView = p.success ? p.data.view : "week";
  const today = localDayKey(now, tz);
  const anchor = p.success && p.data.start ? p.data.start : today;
  if (view === "month") {
    const start = firstOfMonth(anchor);
    const end = addMonths(start, 1);
    const days: string[] = [];
    for (let k = start; k < end; k = addDays(k, 1)) days.push(k);
    return { view, start, days, prev: addMonths(start, -1), next: end, isCurrent: start === firstOfMonth(today) };
  }
  const start = mondayOf(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { view, start, days, prev: addDays(start, -7), next: addDays(start, 7), isCurrent: start === mondayOf(today) };
}

/** Group items by local day, keeping only days in the range; each day sorted by time. */
export function groupByLocalDay<T extends { iso: string }>(items: T[], range: CalendarRange, tz: string): { day: string; items: T[] }[] {
  const set = new Set(range.days);
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = localDayKey(it.iso, tz);
    if (!set.has(key)) continue;
    (map.get(key) ?? map.set(key, []).get(key)!).push(it);
  }
  return range.days.filter((d) => map.has(d)).map((d) => ({ day: d, items: map.get(d)!.sort((a, b) => a.iso.localeCompare(b.iso)) }));
}

/** "Mon, Nov 2" for a local day key (formatted at noon UTC so the label can't shift a day). */
export function dayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));
}
