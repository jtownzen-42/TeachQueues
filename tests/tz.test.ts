import { describe, expect, it } from "vitest";
import { formatInZone, localToUtcIso } from "@/lib/tz";

// US DST ends Sun Nov 1, 2026 at 2:00 AM CDT -> 1:00 AM CST.
describe("Chicago local time -> UTC across the Nov 1 2026 DST change", () => {
  const tz = "America/Chicago";
  it("before the change uses CDT (UTC-5)", () => {
    expect(localToUtcIso("2026-10-31T09:00", tz)).toBe("2026-10-31T14:00:00.000Z");
  });
  it("after the change uses CST (UTC-6)", () => {
    expect(localToUtcIso("2026-11-01T09:00", tz)).toBe("2026-11-01T15:00:00.000Z");
    expect(localToUtcIso("2026-11-10T09:00", tz)).toBe("2026-11-10T15:00:00.000Z");
  });
  it("same wall time on either side of the change differs by 25h, not 24h", () => {
    const a = Date.parse(localToUtcIso("2026-10-31T12:00", tz));
    const b = Date.parse(localToUtcIso("2026-11-01T12:00", tz));
    expect((b - a) / 3_600_000).toBe(25);
  });
  it("displays the zone abbreviation", () => {
    expect(formatInZone("2026-11-10T15:00:00.000Z", tz)).toContain("CST");
    expect(formatInZone("2026-10-31T14:00:00.000Z", tz)).toContain("CDT");
  });
  it("works for other zones (judges anywhere)", () => {
    expect(localToUtcIso("2026-11-10T09:00", "Europe/London")).toBe("2026-11-10T09:00:00.000Z");
    expect(localToUtcIso("2026-11-10T09:00", "Asia/Tokyo")).toBe("2026-11-10T00:00:00.000Z");
  });
  it("rejects malformed input", () => {
    expect(() => localToUtcIso("2026-11-10 9am", tz)).toThrow();
  });
});
