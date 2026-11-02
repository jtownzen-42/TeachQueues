// GET /api/lessons/[id]/graphic -> 1080x1080 PNG preview of the lesson card, owner only.
// Signed out -> 401, someone else's (or unknown) lesson -> 404. Per-user preview: never cached.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getLessonWithProduct } from "@/lib/lessons/data";
import { graphicGuard } from "@/lib/graphics/guard";
import { renderLessonCard } from "@/lib/graphics/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function sessionUserId(): Promise<string | null> {
  const id = (await getAppSession()).userId;
  if (!id) return null;
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id));
  return u?.id ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let g: Awaited<ReturnType<typeof graphicGuard>>;
  try {
    g = await graphicGuard({ getUserId: sessionUserId, loadLesson: getLessonWithProduct }, id);
  } catch (e) {
    console.error("[teachqueue] graphic preview failed", (e as Error)?.name);
    return new NextResponse("Couldn't draw the graphic right now.", { status: 500, headers: NO_STORE });
  }
  if (g.status === 401) return new NextResponse("Sign in to see this graphic.", { status: 401, headers: NO_STORE });
  if (g.status === 404) return new NextResponse("Not found.", { status: 404, headers: NO_STORE });
  return renderLessonCard(g.model, { ...NO_STORE, "Content-Type": "image/png" });
}
