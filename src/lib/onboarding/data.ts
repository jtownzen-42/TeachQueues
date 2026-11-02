import "server-only";
// Facts for the "Getting started" checklist and the empty states: one query, user-scoped, no Buffer calls.
// The subqueries filter by the bound user id (a bare column reference would bind to the inner table).
import { eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import type { OnboardingFacts } from "./progress";

export async function loadOnboardingFacts(db: SendDb, userId: string): Promise<OnboardingFacts> {
  const [r] = await db.select({
    channels: users.channelsCache,
    productCount: sql<number>`(select count(*)::int from products p where p.user_id = ${userId}::uuid)`,
    sampleProductCount: sql<number>`(select count(*)::int from products p where p.user_id = ${userId}::uuid and p.is_sample)`,
    lessonCount: sql<number>`(select count(*)::int from lessons l join products p on p.id = l.product_id where p.user_id = ${userId}::uuid)`,
    savedImageCount: sql<number>`(select count(*)::int from drafts d where d.user_id = ${userId}::uuid and d.image_saved_at is not null)`,
    sentCount: sql<number>`(select count(*)::int from buffer_posts b join drafts d on d.id = b.draft_id where d.user_id = ${userId}::uuid and b.buffer_post_id is not null)`,
  }).from(users).where(eq(users.id, userId));
  return {
    channels: r?.channels ?? null,
    productCount: Number(r?.productCount ?? 0),
    sampleProductCount: Number(r?.sampleProductCount ?? 0),
    lessonCount: Number(r?.lessonCount ?? 0),
    savedImageCount: Number(r?.savedImageCount ?? 0),
    sentCount: Number(r?.sentCount ?? 0),
  };
}

/** Same query plus the number of saved drafts, for the Calendar's empty-state next step. */
export async function loadCalendarFacts(db: SendDb, userId: string): Promise<{ productCount: number; draftCount: number; sentCount: number }> {
  const [r] = await db.select({
    productCount: sql<number>`(select count(*)::int from products p where p.user_id = ${userId}::uuid)`,
    draftCount: sql<number>`(select count(*)::int from drafts d where d.user_id = ${userId}::uuid)`,
    sentCount: sql<number>`(select count(*)::int from buffer_posts b join drafts d on d.id = b.draft_id where d.user_id = ${userId}::uuid and b.buffer_post_id is not null)`,
  }).from(users).where(eq(users.id, userId));
  return { productCount: Number(r?.productCount ?? 0), draftCount: Number(r?.draftCount ?? 0), sentCount: Number(r?.sentCount ?? 0) };
}
