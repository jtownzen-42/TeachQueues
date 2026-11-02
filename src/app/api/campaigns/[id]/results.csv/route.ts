// GET /api/campaigns/[id]/results.csv -> the campaign's daily results, owner only.
// Signed out -> 401, unknown / other user's campaign -> 404. Never contacts Buffer.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignSlug } from "@/lib/campaigns/utm";
import { idInput } from "@/lib/lessons/validation";
import { resultsCsv } from "@/lib/results/csv";
import { listResultDays } from "@/lib/results/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const sid = (await getAppSession()).userId;
    const [u] = sid ? await getDb().select({ id: users.id }).from(users).where(eq(users.id, sid)) : [];
    if (!u) return new NextResponse("Sign in to download results.", { status: 401, headers: NO_STORE });
    const cid = idInput.safeParse(id);
    const row = cid.success ? await getCampaign(u.id, cid.data) : null;
    if (!row) return new NextResponse("Not found.", { status: 404, headers: NO_STORE });
    const csv = resultsCsv(await listResultDays(getDb(), u.id, row.campaign.id));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        // filename built only from the validated slug ([a-z0-9-])
        "Content-Disposition": `attachment; filename="teachqueue-${campaignSlug(row.campaign)}-results.csv"`,
      },
    });
  } catch (e) {
    console.error("[teachqueue] results csv failed", (e as Error)?.name);
    return new NextResponse("Couldn't build the CSV right now.", { status: 500, headers: NO_STORE });
  }
}
