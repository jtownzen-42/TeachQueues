import { NextResponse } from "next/server";
import { HEALTH_CACHE_CONTROL, healthPayload, pingBufferApi } from "@/lib/health/buffer";

export const dynamic = "force-dynamic";

/** Public liveness check. No auth, no secrets, no user tokens. */
export async function GET() {
  const buffer = await pingBufferApi();
  return NextResponse.json(healthPayload(buffer), {
    headers: { "Cache-Control": HEALTH_CACHE_CONTROL },
  });
}
