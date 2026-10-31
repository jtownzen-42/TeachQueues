import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout            -> disconnect: forget Buffer tokens + end session.
 *  POST /api/auth/logout?delete=1   -> also delete every row we hold for this user (R16). */
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  const userId = session.userId;
  if (userId) {
    const db = getDb();
    if (req.nextUrl.searchParams.get("delete") === "1") {
      await db.delete(users).where(eq(users.id, userId)); // cascades to products, lessons, drafts...
    } else {
      await db.update(users).set({
        accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, tokenScope: null,
        channelsCache: null, channelsSyncedAt: null, updatedAt: new Date(),
      }).where(eq(users.id, userId));
    }
  }
  session.destroy();
  return NextResponse.redirect(new URL("/?disconnected=1", req.nextUrl.origin), 303);
}
