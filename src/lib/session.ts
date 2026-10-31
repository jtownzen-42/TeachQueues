import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "./env";

export type AppSession = { userId?: string };
export type OAuthSession = { state?: string; verifier?: string; createdAt?: number };

function opts(cookieName: string, maxAge: number): SessionOptions {
  const secure = process.env.NODE_ENV === "production" || env.redirectUri.startsWith("https://");
  return {
    password: env.sessionSecret,
    cookieName,
    ttl: maxAge,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge },
  };
}

/** Long-lived app session: holds only our own user id, never a Buffer token. */
export async function getAppSession() {
  return getIronSession<AppSession>(await cookies(), opts("tq_session", 60 * 60 * 24 * 30));
}

/** Short-lived (10 min) encrypted cookie holding OAuth state + PKCE verifier.
 * Lives in the browser so it survives serverless cold starts between login and callback. */
export async function getOAuthSession() {
  return getIronSession<OAuthSession>(await cookies(), opts("tq_oauth", 600));
}
