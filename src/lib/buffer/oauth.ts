import "server-only";
import { env } from "../env";

export const BUFFER_AUTH_URL = "https://auth.buffer.com/auth";
export const BUFFER_TOKEN_URL = "https://auth.buffer.com/token";

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

export function buildAuthorizeUrl(params: {
  clientId: string; redirectUri: string; scope: string; state: string; codeChallenge: string;
}): string {
  const u = new URL(BUFFER_AUTH_URL);
  u.searchParams.set("client_id", params.clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", params.scope);
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(BUFFER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok || typeof json.access_token !== "string") {
    // Never include request bodies (secret, codes, tokens) in errors.
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    const desc = typeof json.error_description === "string" ? json.error_description : "Token request failed";
    throw new OAuthError(code, desc, res.status);
  }
  return json as unknown as TokenResponse;
}

export function exchangeCode(code: string, codeVerifier: string) {
  return postToken({
    client_id: env.clientId,
    client_secret: env.clientSecret, // confidential client: secret AND PKCE verifier
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
    code_verifier: codeVerifier,
  });
}

/** Single-use refresh tokens: callers MUST persist the new pair before using it,
 * and must never call this twice with the same refresh token. */
export function refreshTokens(refreshToken: string) {
  return postToken({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
