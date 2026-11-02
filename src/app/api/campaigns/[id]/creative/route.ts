// GET /api/campaigns/[id]/creative?size=square|landscape|story[&download=1] -> PNG, owner only.
// Signed out -> 401, unknown / other user's / product-less campaign -> 404, bad size -> 400.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getCampaign } from "@/lib/campaigns/data";
import { creativeGuard } from "@/lib/campaigns/guard";
import { renderCampaignCreative } from "@/lib/campaigns/render";
import { brandNameFor } from "@/lib/graphics/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function sessionUserId(): Promise<string | null> {
  const id = (await getAppSession()).userId;
  if (!id) return null;
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id));
  return u?.id ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  let g: Awaited<ReturnType<typeof creativeGuard>>;
  try {
    g = await creativeGuard({ getUserId: sessionUserId, loadCampaign: getCampaign, getBrandName: (uid) => brandNameFor(getDb(), uid) }, id, sp.get("size"));
  } catch (e) {
    console.error("[teachqueue] campaign creative failed", (e as Error)?.name);
    return new NextResponse("Couldn't draw the creative right now.", { status: 500, headers: NO_STORE });
  }
  if (g.status === 401) return new NextResponse("Sign in to see this creative.", { status: 401, headers: NO_STORE });
  if (g.status === 404) return new NextResponse("Not found.", { status: 404, headers: NO_STORE });
  if (g.status === 400) return new NextResponse("Unknown size. Use square, landscape or story.", { status: 400, headers: NO_STORE });
  const headers: Record<string, string> = { ...NO_STORE, "Content-Type": "image/png" };
  if (sp.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${g.filename}"`;
  return renderCampaignCreative(g.model, g.size, headers);
}
