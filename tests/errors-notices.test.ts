import { describe, expect, it } from "vitest";
import { errorMessage, errorName } from "@/lib/errors";
import { deskNotice, deskNoticesFrom, noticesFrom } from "@/lib/notices";
import { parseLocalInput } from "@/lib/tz";

describe("errorName / errorMessage", () => {
  it("reads real errors", () => {
    expect(errorName(new TypeError("boom"))).toBe("TypeError");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("never throws on values that aren't errors", () => {
    expect(errorName(null)).toBe("null");
    expect(errorName(undefined)).toBe("undefined");
    expect(errorName("oops")).toBe("string");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage("oops")).toBe("oops");
  });
});

describe("notice lookups only use the tables' own codes", () => {
  it("ignores Object.prototype names in the query string", () => {
    expect(deskNoticesFrom({ n: "toString" })).toEqual([]);
    expect(deskNoticesFrom({ n: "constructor" })).toEqual([]);
    expect(noticesFrom({ sync: "hasOwnProperty" })).toEqual([]);
    expect(deskNotice("__proto__")).toEqual(deskNotice("error"));
  });
  it("still finds known codes", () => {
    expect(deskNoticesFrom({ n: "product_saved" })).toEqual([{ kind: "info", text: "Product saved." }]);
    expect(noticesFrom({ sync: "ok" })).toEqual([{ kind: "info", text: "Channels re-synced from Buffer." }]);
  });
});

describe("parseLocalInput", () => {
  it("splits a datetime-local value into numbers", () => {
    expect(parseLocalInput("2026-11-24T09:05")).toEqual({ y: 2026, mo: 11, d: 24, h: 9, mi: 5 });
  });
  it("rejects anything else", () => {
    expect(parseLocalInput("2026-11-24 09:05")).toBeNull();
    expect(parseLocalInput("")).toBeNull();
  });
});
