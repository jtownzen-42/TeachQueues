import "server-only";
// The brand name drawn on a user's graphics (users.brand_name), loaded with the same user id that
// owns the lesson / campaign. Every card or creative model and hash must use it.
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";

export async function brandNameFor(db: SendDb, userId: string): Promise<string | null> {
  const [u] = await db.select({ brandName: users.brandName }).from(users).where(eq(users.id, userId));
  return u?.brandName ?? null;
}
