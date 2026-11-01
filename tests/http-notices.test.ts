import { describe, expect, it } from "vitest";
import { homeUrl, isSameOrigin } from "@/lib/http";
import { channelErrorText, noticesFrom } from "@/lib/notices";

describe("isSameOrigin", () => {
  const self = "https://teachqueue-app.vercel.app";
  it("accepts same origin and missing Origin, rejects others", () => {
    expect(isSameOrigin(new Headers({ origin: self }), self)).toBe(true);
    expect(isSameOrigin(new Headers(), self)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example" }), self)).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "null" }), self)).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "garbage" }), self)).toBe(false);
  });
  it("homeUrl stays on our origin", () => {
    expect(homeUrl("https://a.test", { sync: "ok" }).toString()).toBe("https://a.test/?sync=ok");
  });
});

describe("home notices", () => {
  it("maps known codes and never echoes unknown query text", () => {
    const n = noticesFrom({ auth_error: "<script>alert(1)</script>" });
    expect(n).toHaveLength(1);
    expect(n[0].text).not.toContain("script");
    expect(noticesFrom({ auth_error: "denied" })[0].text).toMatch(/cancelled/);
    expect(noticesFrom({ sync: "bogus" })).toEqual([]);
  });
  it("covers re-sync outcomes", () => {
    expect(noticesFrom({ sync: "ok" })[0]).toMatchObject({ kind: "info" });
    expect(noticesFrom({ sync: "cooldown" })[0].text).toMatch(/less than a minute/);
    expect(noticesFrom({ sync: "busy" })[0]).toMatchObject({ kind: "error" });
    expect(noticesFrom({ sync: "reconnect" })[0].text).toMatch(/connect again/);
  });
  it("handles array params and delete vs disconnect", () => {
    expect(noticesFrom({ sync: ["ok", "busy"] })[0].text).toMatch(/re-synced/);
    expect(noticesFrom({ deleted: "1", disconnected: "1" })).toHaveLength(1);
  });
  it("channel errors are friendly, not raw upstream text", () => {
    expect(channelErrorText(Object.assign(new Error("x"), { name: "ReconnectRequired" }))).toMatch(/connect again/);
    expect(channelErrorText(Object.assign(new Error("raw graphql"), { status: 429 }))).toMatch(/busy/);
    expect(channelErrorText(new Error("raw graphql detail"))).not.toContain("raw");
  });
});
