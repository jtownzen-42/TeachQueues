// AES-256-GCM for Buffer tokens at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFrom(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded");
  return key;
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export function encryptWithKey(plaintext: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

export function decryptWithKey(payload: string, keyB64: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Bad ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), fromB64u(iv));
  decipher.setAuthTag(fromB64u(tag));
  return Buffer.concat([decipher.update(fromB64u(ct)), decipher.final()]).toString("utf8");
}
