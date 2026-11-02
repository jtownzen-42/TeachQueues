import { describe, expect, it } from "vitest";
import { dueAtPreview, MAX_AHEAD_MS, PAST_GRACE_MS, resolveDueAt, utcToLocalInput } from "@/lib/buffer/schedule";

const CT = "America/Chicago";
const now = new Date("2026-11-01T12:00:00.000Z"); // Sun Nov 1 2026, 6:00 AM CST

describe("resolveDueAt (CT -> UTC)", () => {
  it("standard time: 2026-11-10T09:00 CST -> 15:00Z", () => {
    expect(resolveDueAt("2026-11-10T09:00", CT, now)).toMatchObject({ ok: true, utcIso: "2026-11-10T15:00:00.000Z" });
  });
  it("daylight time: 2027-07-01T09:00 CDT -> 14:00Z (and 2026-07-01 with an earlier clock)", () => {
    expect(resolveDueAt("2027-07-01T09:00", CT, now)).toMatchObject({ ok: true, utcIso: "2027-07-01T14:00:00.000Z" });
    expect(resolveDueAt("2026-07-01T09:00", CT, new Date("2026-06-01T00:00:00Z"))).toMatchObject({ ok: true, utcIso: "2026-07-01T14:00:00.000Z" });
  });
  it("fall-back ambiguity: 2026-11-01T01:30 resolves to the EARLIER instant (CDT, 06:30Z)", () => {
    expect(resolveDueAt("2026-11-01T01:30", CT, new Date("2026-10-31T00:00:00Z")))
      .toMatchObject({ ok: true, utcIso: "2026-11-01T06:30:00.000Z" });
  });
  it("spring-forward gap: 2027-03-14T02:30 doesn't exist and is REJECTED (not shifted)", () => {
    expect(resolveDueAt("2027-03-14T02:30", CT, now)).toEqual({ ok: false, code: "time_gap" });
    expect(resolveDueAt("2027-03-14T03:30", CT, now)).toMatchObject({ ok: true, utcIso: "2027-03-14T08:30:00.000Z" });
  });
  it("past times are rejected after the 2-minute grace", () => {
    const local = (msAgo: number) => utcToLocalInput(new Date(now.getTime() - msAgo).toISOString(), CT);
    expect(resolveDueAt(local(PAST_GRACE_MS - 60_000), CT, now).ok).toBe(true);
    expect(resolveDueAt(local(PAST_GRACE_MS + 60_000), CT, now)).toEqual({ ok: false, code: "time_past" });
    expect(resolveDueAt("2020-01-01T09:00", CT, now)).toEqual({ ok: false, code: "time_past" });
  });
  it("more than about a year out is rejected", () => {
    const tooFar = utcToLocalInput(new Date(now.getTime() + MAX_AHEAD_MS + 3_600_000).toISOString(), CT);
    expect(resolveDueAt(tooFar, CT, now)).toEqual({ ok: false, code: "time_far" });
    expect(resolveDueAt("2027-10-01T09:00", CT, now).ok).toBe(true);
  });
  it("malformed or impossible input is invalid", () => {
    for (const bad of ["", "2026-11-10", "2026-11-10 09:00", "2026-13-01T09:00", "2026-02-30T09:00", "2026-11-10T25:00", "2026-11-10T09:00:00Z"]) {
      expect(resolveDueAt(bad, CT, now)).toEqual({ ok: false, code: "time_invalid" });
    }
    expect(resolveDueAt(null, CT, now)).toEqual({ ok: false, code: "time_invalid" });
  });
  it("uses the user's zone and falls back to America/Chicago for a bad zone", () => {
    expect(resolveDueAt("2026-11-10T09:00", "Europe/London", now)).toMatchObject({ utcIso: "2026-11-10T09:00:00.000Z" });
    expect(resolveDueAt("2026-11-10T09:00", "Not/AZone", now)).toMatchObject({ utcIso: "2026-11-10T15:00:00.000Z" });
  });
});

describe("previews", () => {
  it("shows the zone time and the UTC equivalent", () => {
    expect(dueAtPreview("2026-11-10T15:00:00.000Z", CT)).toBe("Tue, Nov 10, 9:00 AM CST → 2026-11-10T15:00:00.000Z (UTC)");
  });
  it("utcToLocalInput round-trips", () => {
    expect(utcToLocalInput("2026-11-10T15:00:00.000Z", CT)).toBe("2026-11-10T09:00");
    expect(utcToLocalInput("2026-11-01T06:30:00.000Z", CT)).toBe("2026-11-01T01:30");
  });
});
