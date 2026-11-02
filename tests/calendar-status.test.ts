import { describe, expect, it } from "vitest";
import { calendarStatus, calendarTime, STATUS_LABELS, viewPostHref, type StatusInput } from "@/lib/calendar/status";
import { calendarRange, dayLabel, groupByLocalDay, localDayKey } from "@/lib/calendar/range";

const CT = "America/Chicago";
const post = (o: Partial<NonNullable<StatusInput["post"]>> = {}): NonNullable<StatusInput["post"]> => ({
  bufferPostId: "post_test_1", lastStatus: "draft", error: null, bufferStatus: null, bufferError: null, bufferMissingAt: null, ...o,
});

describe("calendarStatus", () => {
  it.each([
    ["local draft", { draftStatus: "draft", post: null }, "Draft"],
    ["local approved campaign draft", { draftStatus: "approved", post: null }, "Approved"],
    ["queued but no row (edge) -> Draft", { draftStatus: "queued", post: null }, "Draft"],
    ["send failed (error, no Buffer id)", { draftStatus: "approved", post: post({ bufferPostId: null, lastStatus: "failed", error: "Buffer didn't accept the post: too long" }) }, "Send failed"],
    ["send claim in flight", { draftStatus: "draft", post: post({ bufferPostId: null, lastStatus: "sending" }) }, "Sending to Buffer"],
    ["sent, never read back", { draftStatus: "queued", post: post() }, "Draft in Buffer"],
    ["buffer draft", { draftStatus: "queued", post: post({ bufferStatus: "draft" }) }, "Draft in Buffer"],
    ["needs approval", { draftStatus: "queued", post: post({ bufferStatus: "needs_approval" }) }, "Awaiting approval in Buffer"],
    ["scheduled", { draftStatus: "queued", post: post({ bufferStatus: "scheduled" }) }, "Scheduled"],
    ["sending", { draftStatus: "queued", post: post({ bufferStatus: "sending" }) }, "Sending"],
    ["sent", { draftStatus: "queued", post: post({ bufferStatus: "sent" }) }, "Sent"],
    ["error", { draftStatus: "queued", post: post({ bufferStatus: "error", bufferError: "Channel disconnected" }) }, "Failed"],
    ["unknown status -> Draft in Buffer", { draftStatus: "queued", post: post({ bufferStatus: "weird" }) }, "Draft in Buffer"],
    ["missing wins", { draftStatus: "queued", post: post({ bufferStatus: "sent", bufferMissingAt: new Date() }) }, "Not found in Buffer"],
  ] as [string, StatusInput, string][])("%s -> %s", (_n, input, label) => {
    expect(calendarStatus(input).label).toBe(label);
  });
  it("details: failure message sanitized, send error kept, not found explains", () => {
    expect(calendarStatus({ draftStatus: "queued", post: post({ bufferStatus: "error", bufferError: "Bad Bearer tok_FAKE_abcdefghijklmnopqrstuvwxyz0123456789" }) }).detail).not.toContain("tok_FAKE");
    expect(calendarStatus({ draftStatus: "draft", post: post({ bufferPostId: null, error: "Couldn't reach Buffer." }) }).detail).toBe("Couldn't reach Buffer.");
    expect(calendarStatus({ draftStatus: "queued", post: post({ bufferMissingAt: new Date() }) }).detail).toMatch(/too old to read back/);
    expect(Object.keys(STATUS_LABELS)).toHaveLength(11);
  });
});

describe("calendarTime / viewPostHref", () => {
  const c = new Date("2026-11-01T10:00:00Z");
  it("Due, then Sent, then Created (unscheduled)", () => {
    expect(calendarTime({ dueAt: new Date("2026-11-10T15:00:00Z"), sentAt: new Date("2026-11-10T15:01:00Z"), createdAt: c })).toEqual({ iso: "2026-11-10T15:00:00.000Z", label: "Due", scheduled: true });
    expect(calendarTime({ dueAt: null, sentAt: new Date("2026-11-10T15:01:00Z"), createdAt: c }).label).toBe("Sent");
    expect(calendarTime({ dueAt: null, sentAt: null, createdAt: c })).toEqual({ iso: c.toISOString(), label: "Created", scheduled: false });
  });
  it("View post only for https links", () => {
    expect(viewPostHref("https://www.linkedin.com/feed/update/1")).toBe("https://www.linkedin.com/feed/update/1");
    for (const bad of ["http://x.com/p", "javascript:alert(1)", "data:text/html,x", "https://u:p@x.com/", "not a url", "", null, undefined]) expect(viewPostHref(bad)).toBeNull();
  });
});

describe("local days (America/Chicago)", () => {
  it("Nov 1 2026 fall-back: 01:30 CDT and 01:30 CST are the same local day, in order", () => {
    const cdt = "2026-11-01T06:30:00.000Z"; // 01:30 CDT
    const cst = "2026-11-01T07:30:00.000Z"; // 01:30 CST, one hour later
    expect(localDayKey(cdt, CT)).toBe("2026-11-01");
    expect(localDayKey(cst, CT)).toBe("2026-11-01");
    const range = calendarRange({ view: "week", start: "2026-10-26" }, CT, new Date("2026-11-01T12:00:00Z"));
    const g = groupByLocalDay([{ iso: cst, id: "b" }, { iso: cdt, id: "a" }], range, CT);
    expect(g).toEqual([{ day: "2026-11-01", items: [{ iso: cdt, id: "a" }, { iso: cst, id: "b" }] }]);
    // the local day after fall-back starts at 06:00Z (CST), so 05:59Z is still Nov 1
    expect(localDayKey("2026-11-02T05:59:00Z", CT)).toBe("2026-11-01");
    expect(localDayKey("2026-11-02T06:00:00Z", CT)).toBe("2026-11-02");
  });
  it("across a UTC midnight", () => {
    expect(localDayKey("2026-11-10T03:00:00Z", CT)).toBe("2026-11-09"); // 9 PM CST
    expect(localDayKey("2026-11-10T03:00:00Z", "UTC")).toBe("2026-11-10");
    expect(localDayKey("2026-07-01T04:30:00Z", CT)).toBe("2026-06-30"); // 11:30 PM CDT
  });
  it("items outside the range are left out", () => {
    const range = calendarRange({ view: "week", start: "2026-11-02" }, CT, new Date());
    expect(groupByLocalDay([{ iso: "2026-11-01T12:00:00Z" }, { iso: "2026-11-09T12:00:00Z" }], range, CT)).toEqual([]);
    expect(dayLabel("2026-11-02")).toBe("Mon, Nov 2");
  });
});

describe("calendarRange params", () => {
  const now = new Date("2026-11-04T18:00:00Z"); // Wed Nov 4 in Chicago
  it("default = current week starting Monday in the user's zone", () => {
    const r = calendarRange({}, CT, now);
    expect([r.view, r.start, r.days.length, r.days[6], r.prev, r.next, r.isCurrent]).toEqual(["week", "2026-11-02", 7, "2026-11-08", "2026-10-26", "2026-11-09", true]);
  });
  it("week start snaps to Monday; month to the 1st with prev/next months", () => {
    expect(calendarRange({ view: "week", start: "2026-11-08" }, CT, now).start).toBe("2026-11-02");
    const m = calendarRange({ view: "month", start: "2026-02-17" }, CT, now);
    expect([m.start, m.days.length, m.prev, m.next, m.isCurrent]).toEqual(["2026-02-01", 28, "2026-01-01", "2026-03-01", false]);
    expect(calendarRange({ view: "month", start: "2026-12-05" }, CT, now).next).toBe("2027-01-01");
  });
  it("bad params fall back without throwing", () => {
    for (const p of [{ view: "year" }, { start: "2026-02-30" }, { start: "garbage" }, { view: ["month", "week"], start: ["x"] }, { view: 5, start: {} }]) {
      expect(() => calendarRange(p, CT, now)).not.toThrow();
    }
    expect(calendarRange({ view: "year", start: "2026-02-30" }, CT, now)).toMatchObject({ view: "week", start: "2026-11-02" });
    expect(calendarRange({ view: "month", start: "nope" }, CT, now)).toMatchObject({ view: "month", start: "2026-11-01" });
  });
  it("uses the user's zone for 'today' near midnight", () => {
    // Mon Nov 9 02:00Z is still Sun Nov 8 in Chicago -> week of Nov 2
    expect(calendarRange({}, CT, new Date("2026-11-09T02:00:00Z")).start).toBe("2026-11-02");
    expect(calendarRange({}, "UTC", new Date("2026-11-09T02:00:00Z")).start).toBe("2026-11-09");
  });
});
