import { describe, expect, it } from "vitest";
import { draftSafe, isTestMode, TestModeViolation } from "@/lib/testmode";

describe("TEST_MODE enforcement", () => {
  it("global TEST_MODE defaults ON and overrides the user toggle", () => {
    expect(isTestMode(undefined, false)).toBe(true);
    expect(isTestMode("true", false)).toBe(true);
    expect(isTestMode(" TRUE ", false)).toBe(true);
    expect(isTestMode("false", false)).toBe(false);
    expect(isTestMode("false", true)).toBe(true);
    expect(isTestMode("false", null)).toBe(true);
  });
  it("forces saveToDraft in test mode and refuses an explicit publish", () => {
    expect(draftSafe({ text: "hi" }, true)).toEqual({ text: "hi", saveToDraft: true });
    expect(draftSafe({ text: "hi", saveToDraft: true }, true).saveToDraft).toBe(true);
    expect(() => draftSafe({ text: "hi", saveToDraft: false }, true)).toThrow(TestModeViolation);
    expect(draftSafe({ text: "hi" }, false)).toEqual({ text: "hi" });
  });
});
