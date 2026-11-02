import "server-only";
// Best-effort removal of a user's lesson images from Vercel Blob during "Delete my data".
// Never throws: any failure is logged by name only and the account deletion goes ahead.
import { and, eq, isNotNull } from "drizzle-orm";
import { drafts } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { isPublicBlobUrl } from "./blob";

export async function deleteUserImages(db: SendDb, userId: string, del: (urls: string[]) => Promise<void>): Promise<number> {
  try {
    const rows = await db.select({ url: drafts.imageUrl }).from(drafts)
      .where(and(eq(drafts.userId, userId), isNotNull(drafts.imageUrl)));
    const urls = [...new Set(rows.map((r) => r.url).filter(isPublicBlobUrl))];
    if (urls.length > 0) await del(urls);
    return urls.length;
  } catch (e) {
    console.error("[teachqueue] blob cleanup on delete failed", (e as Error)?.name);
    return 0;
  }
}
