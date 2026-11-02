// "At a specific time" -> UTC, interpreted in the user's zone. Pure: used by the server
// (which always recomputes UTC itself) and by the client-side live preview.
import { formatInZone, localToUtcIso, safeTimeZone } from "@/lib/tz";

/** Times slightly in the past are allowed (form filled, then a short delay). */
export const PAST_GRACE_MS = 2 * 60_000;
/** Buffer schedules up to about a year out; anything later is refused. */
export const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;

export type DueAtError = "time_invalid" | "time_gap" | "time_past" | "time_far";
export type DueAtResult = { ok: true; utcIso: string; label: string } | { ok: false; code: DueAtError };

export const DUE_AT_ERROR_TEXT: Record<DueAtError, string> = {
  time_invalid: "Pick a date and time.",
  time_gap: "That time doesn't exist on this day because the clocks spring forward. Pick a time after the change.",
  time_past: "That time has already passed. Pick a time in the future.",
  time_far: "That's more than a year away. Pick a time within the next year.",
};

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Wall-clock "YYYY-MM-DDTHH:mm" of a UTC instant in `timeZone`. */
export function utcToLocalInput(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * DST behavior (documented choice):
 *  - Fall-back ambiguity (e.g. 2026-11-01T01:30 in America/Chicago happens twice): the EARLIER
 *    instant (CDT, 06:30Z) is used, which is what localToUtcIso / TZDate resolve to.
 *  - Spring-forward gap (e.g. 2027-03-14T02:30 doesn't exist): REJECTED with time_gap rather than
 *    silently shifted, detected by converting back and comparing the wall-clock time.
 */
export function resolveDueAt(local: string | null | undefined, tz: string | null | undefined, now: Date): DueAtResult {
  const zone = safeTimeZone(tz);
  const m = LOCAL_RE.exec((local ?? "").trim());
  if (!m) return { ok: false, code: "time_invalid" };
  const [, , mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { ok: false, code: "time_invalid" };
  let utcIso: string;
  try {
    utcIso = localToUtcIso(m[0], zone);
  } catch {
    return { ok: false, code: "time_invalid" };
  }
  if (!Number.isFinite(Date.parse(utcIso))) return { ok: false, code: "time_invalid" };
  // Round trip: a nonexistent date (Feb 30) or a spring-forward gap comes back different.
  if (utcToLocalInput(utcIso, zone) !== m[0]) {
    const [y, mm, dd] = [Number(m[1]), mo, d];
    const real = new Date(Date.UTC(y, mm - 1, dd));
    const dateExists = real.getUTCMonth() === mm - 1 && real.getUTCDate() === dd;
    return { ok: false, code: dateExists ? "time_gap" : "time_invalid" };
  }
  const t = Date.parse(utcIso);
  if (t < now.getTime() - PAST_GRACE_MS) return { ok: false, code: "time_past" };
  if (t > now.getTime() + MAX_AHEAD_MS) return { ok: false, code: "time_far" };
  return { ok: true, utcIso, label: formatInZone(utcIso, zone) };
}

/** "Tue Nov 10, 9:00 AM CST → 2026-11-10T15:00:00.000Z (UTC)" */
export function dueAtPreview(utcIso: string, tz: string | null | undefined): string {
  return `${formatInZone(utcIso, safeTimeZone(tz))} → ${new Date(utcIso).toISOString()} (UTC)`;
}
