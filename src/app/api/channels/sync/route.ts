import { NextResponse, type NextRequest } from "next/server";
import { getAppSession } from "@/lib/session";
import { getChannels } from "@/lib/buffer/sync";
import { ReconnectRequired } from "@/lib/buffer/tokens";
import { BufferApiError } from "@/lib/buffer/api";
import { homeUrl, isSameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/channels/sync -> force a channel re-sync (60s cooldown in getChannels),
 * then 303 back to the home page with a friendly notice. */
export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (sync: string) => NextResponse.redirect(homeUrl(origin, { sync }), 303);
  if (!isSameOrigin(req.headers, origin)) return new NextResponse("Forbidden", { status: 403 });
  const session = await getAppSession();
  if (!session.userId) return NextResponse.redirect(homeUrl(origin), 303);
  try {
    const { cooldown } = await getChannels(session.userId, true);
    return back(cooldown ? "cooldown" : "ok");
  } catch (e) {
    if (e instanceof ReconnectRequired) return back("reconnect");
    if (e instanceof BufferApiError && e.status === 429) return back("busy");
    console.error("[teachqueue] channel re-sync failed", (e as Error).message);
    return back("error");
  }
}

/** A stray GET (old bookmark, typed URL) just goes home instead of 405. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(homeUrl(req.nextUrl.origin), 303);
}
