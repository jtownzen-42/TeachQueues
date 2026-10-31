import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { env } from "../env";
import { decryptWithKey, encryptWithKey } from "../crypto";
import { OAuthError, refreshTokens, type TokenResponse } from "./oauth";

const REFRESH_SKEW_MS = 120_000; // refresh 2 minutes before expiry

export class ReconnectRequired extends Error {
  constructor(message = "Please reconnect your Buffer account.") { super(message); }
}

export const enc = (s: string) => encryptWithKey(s, env.tokenEncKey);
export const dec = (s: string) => decryptWithKey(s, env.tokenEncKey);

export function tokenColumns(t: TokenResponse, keepRefreshEnc?: string | null) {
  return {
    accessTokenEnc: enc(t.access_token),
    refreshTokenEnc: t.refresh_token ? enc(t.refresh_token) : keepRefreshEnc ?? null,
    tokenExpiresAt: new Date(Date.now() + Math.max(60, t.expires_in) * 1000),
    tokenScope: t.scope ?? null,
    updatedAt: new Date(),
  };
}

async function clearTokens(userId: string) {
  await getDb().update(users)
    .set({ accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Returns a usable access token, refreshing it if needed.
 * Refresh tokens are single-use and reusing one revokes the whole grant, so:
 *  - the refresh runs inside a transaction holding SELECT ... FOR UPDATE on the user row,
 *  - after taking the lock we re-check expiry (another request may have refreshed already),
 *  - the new pair is written before the transaction commits and before the token is used,
 *  - a failed refresh is never retried with the same token.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db.select({
    accessTokenEnc: users.accessTokenEnc, tokenExpiresAt: users.tokenExpiresAt,
  }).from(users).where(eq(users.id, userId));
  if (!row?.accessTokenEnc) throw new ReconnectRequired();
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() - REFRESH_SKEW_MS > Date.now()) {
    return dec(row.accessTokenEnc);
  }

  let invalidGrant = false;
  const token = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ access_token_enc: string | null; refresh_token_enc: string | null; token_expires_at: Date | string | null }>(
      sql`select access_token_enc, refresh_token_enc, token_expires_at from users where id = ${userId} for update`,
    );
    const r = locked.rows[0];
    if (!r?.access_token_enc) throw new ReconnectRequired();
    const exp = r.token_expires_at ? new Date(r.token_expires_at).getTime() : 0;
    if (exp - REFRESH_SKEW_MS > Date.now()) return dec(r.access_token_enc); // someone else refreshed
    if (!r.refresh_token_enc) return null;
    try {
      const fresh = await refreshTokens(dec(r.refresh_token_enc));
      await tx.update(users).set(tokenColumns(fresh, r.refresh_token_enc)).where(eq(users.id, userId));
      return fresh.access_token;
    } catch (e) {
      if (e instanceof OAuthError && (e.code === "invalid_grant" || e.status === 400 || e.status === 401)) {
        invalidGrant = true;
        return null;
      }
      throw e;
    }
  });
  if (token) return token;
  if (invalidGrant) await clearTokens(userId);
  throw new ReconnectRequired();
}
