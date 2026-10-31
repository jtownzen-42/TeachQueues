import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptWithKey, encryptWithKey } from "@/lib/crypto";

const key = randomBytes(32).toString("base64");

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptWithKey("secret-token", key);
    const b = encryptWithKey("secret-token", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-token");
    expect(decryptWithKey(a, key)).toBe("secret-token");
  });
  it("rejects tampering and wrong keys", () => {
    const a = encryptWithKey("x", key);
    const parts = a.split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(() => decryptWithKey(parts.join("."), key)).toThrow();
    expect(() => decryptWithKey(a, randomBytes(32).toString("base64"))).toThrow();
  });
  it("requires a 32-byte key", () => {
    expect(() => encryptWithKey("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
