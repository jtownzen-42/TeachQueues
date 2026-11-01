import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession, getOAuthSession } from "@/lib/session";
import { exchangeCode, OAuthError } from "@/lib/buffer/oauth";
import { ACCOUNT_QUERY, bufferGraphQL, type AccountData } from "@/lib/buffer/api";
import { tokenColumns } from "@/lib/buffer/tokens";
import { getChannels } from "@/lib/buffer/sync";
import { safeTimeZone } from "@/lib/tz";

export const dynamic = "force-dynamic";

function home(req: NextRequest, params: Record<string, string>) {
  const u = new URL("/", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const code = q.get("code");
  const state = q.get("state");
  const error = q.get("error");

  const oauth = await getOAuthSession();
  const expected = oauth.state;
  const verifier = oauth.verifier;
  oauth.destroy(); // one-shot: state + verifier can't be replayed

  if (!expected || !state || !safeEqual(expected, state) || !verifier) {
    return home(req, { auth_error: "state" });
  }
  if (error) return home(req, { auth_error: error === "access_denied" ? "denied" : "buffer" });
  if (!code) return home(req, { auth_error: "missing_code" });

  try {
    const tokens = await exchangeCode(code, verifier);
    const { account } = await bufferGraphQL<AccountData>(tokens.access_token, ACCOUNT_QUERY);
    const org = account.organizations[0];
    const db = getDb();
    const cols = tokenColumns(tokens);
    const [u] = await db.insert(users).values({
      bufferAccountId: account.id,
      email: account.email ?? null,
      displayName: account.name ?? null,
      tz: safeTimeZone(account.timezone),
      orgId: org?.id ?? null,
      orgName: org?.name ?? null,
      ...cols,
    }).onConflictDoUpdate({
      target: users.bufferAccountId,
      set: { email: account.email ?? null, displayName: account.name ?? null, orgId: org?.id ?? null, orgName: org?.name ?? null, channelsCache: null, channelsSyncedAt: null, ...cols },
    }).returning({ id: users.id });

    const session = await getAppSession();
    session.userId = u.id;
    await session.save();

    try { await getChannels(u.id, true); } catch (e) { console.warn("[teachqueue] channel sync after connect failed", (e as Error).message); }
    return home(req, { connected: "1" });
  } catch (e) {
    const codeName = e instanceof OAuthError ? e.code : "exchange_failed";
    console.error("[teachqueue] OAuth callback failed:", codeName, (e as Error).message);
    return home(req, { auth_error: codeName });
  }
}
