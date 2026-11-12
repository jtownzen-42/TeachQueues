import { NextResponse } from "next/server";
import { BADGE_CACHE_CONTROL, badgePayload, pingBufferApi } from "@/lib/health/buffer";

export const dynamic = "force-dynamic";

/** shields.io endpoint badge for Buffer API reachability. No auth, no secrets. */
export async function GET() {
  const buffer = await pingBufferApi();
  return NextResponse.json(badgePayload(buffer), {
    headers: { "Cache-Control": BADGE_CACHE_CONTROL },
  });
}
