import { NextResponse } from "next/server";
import { env, logRedirectUriOnce } from "@/lib/env";
import { codeChallengeS256, generateCodeVerifier, generateState } from "@/lib/pkce";
import { getOAuthSession } from "@/lib/session";
import { buildAuthorizeUrl } from "@/lib/buffer/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  logRedirectUriOnce();
  const state = generateState();
  const verifier = generateCodeVerifier();
  const oauth = await getOAuthSession();
  oauth.state = state;
  oauth.verifier = verifier;
  oauth.createdAt = Date.now();
  await oauth.save();
  const url = buildAuthorizeUrl({
    clientId: env.clientId,
    redirectUri: env.redirectUri,
    scope: env.scopes,
    state,
    codeChallenge: codeChallengeS256(verifier),
  });
  return NextResponse.redirect(url);
}
