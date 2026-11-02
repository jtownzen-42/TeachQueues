import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { homeUrl, isSameOrigin } from "@/lib/http";
import { del as deleteBlobs } from "@vercel/blob";
import { deleteUserImages } from "@/lib/graphics/cleanup";

export const dynamic = "force-dynamic";

async function wantsDelete(req: NextRequest): Promise<boolean> {
  if (req.nextUrl.searchParams.get("delete") === "1") return true;
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) return false;
  try {
    return (await req.formData()).get("delete") === "1";
  } catch {
    return false;
  }
}

/** POST /api/auth/logout             -> disconnect: forget Buffer tokens + end session.
 *  POST /api/auth/logout (delete=1)  -> also delete every row we hold for this user (R16).
 *  delete=1 may come from the query string or the form body. */
export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!isSameOrigin(req.headers, origin)) return new NextResponse("Forbidden", { status: 403 });
  const del = await wantsDelete(req);
  const session = await getAppSession();
  const userId = session.userId;
  if (userId) {
    const db = getDb();
    if (del) {
      await deleteUserImages(db, userId, (urls) => deleteBlobs(urls)); // best effort; never blocks the delete
      await db.delete(users).where(eq(users.id, userId)); // cascades to products, lessons, drafts...
    } else {
      await db.update(users).set({
        accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, tokenScope: null,
        channelsCache: null, channelsSyncedAt: null, updatedAt: new Date(),
      }).where(eq(users.id, userId));
    }
  }
  session.destroy();
  if (!userId) return NextResponse.redirect(homeUrl(origin), 303); // nothing to disconnect
  return NextResponse.redirect(homeUrl(origin, del ? { deleted: "1" } : { disconnected: "1" }), 303);
}

/** GET never changes state; send the visitor home. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(homeUrl(req.nextUrl.origin), 303);
}
