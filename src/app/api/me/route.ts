import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getChannels } from "@/lib/buffer/sync";
import { ReconnectRequired } from "@/lib/buffer/tokens";
import { BufferApiError } from "@/lib/buffer/api";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** GET /api/me[?refresh=1] -> current user + cached Buffer channels. */
export async function GET(req: NextRequest) {
  const session = await getAppSession();
  if (!session.userId) return NextResponse.json({ connected: false }, { status: 401 });
  const [u] = await getDb().select({
    email: users.email, displayName: users.displayName, tz: users.tz, testMode: users.testMode,
    orgName: users.orgName, hasToken: users.accessTokenEnc,
  }).from(users).where(eq(users.id, session.userId));
  if (!u?.hasToken) return NextResponse.json({ connected: false, reconnect: true }, { status: 401 });
  try {
    const ch = await getChannels(session.userId, req.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json({
      connected: true, email: u.email, displayName: u.displayName, tz: u.tz,
      testMode: env.testMode || u.testMode, orgName: u.orgName, ...ch,
    });
  } catch (e) {
    if (e instanceof ReconnectRequired) return NextResponse.json({ connected: false, reconnect: true }, { status: 401 });
    if (e instanceof BufferApiError) return NextResponse.json({ error: e.message, retryAfter: e.retryAfter }, { status: e.status === 429 ? 429 : 502 });
    throw e;
  }
}
