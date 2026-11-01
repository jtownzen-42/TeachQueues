export const DEFAULT_TZ = "America/Chicago";

/** Returns tz if it's a real IANA zone, else the default (bad zones would throw later). */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

// Local wall-clock time in the user's zone -> UTC ISO string, DST-safe.
import { TZDate } from "@date-fns/tz";

/** `local` is "YYYY-MM-DDTHH:mm" as typed in a datetime-local input. */
export function localToUtcIso(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Expected YYYY-MM-DDTHH:mm, got "${local}"`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const dt = new TZDate(y, mo - 1, d, h, mi, 0, timeZone);
  return new Date(dt.getTime()).toISOString();
}

/** Format a UTC instant for display in the user's zone, e.g. "Tue Nov 10, 9:00 AM CST". */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso)).replace(/,(?= \d{1,2}:)/, ",");
}
