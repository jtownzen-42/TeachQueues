import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { campaigns, drafts, lessons, products, users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/http";
import { idInput } from "./validation";

/** The signed-in user's id, or a redirect home. Buffer tokens aren't needed for the desk,
 *  so an expired Buffer connection still lets the user manage products and lessons. */
export async function requireUserId(): Promise<string> {
  const session = await getAppSession();
  const id = session.userId;
  if (!id) redirect("/");
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!u) redirect("/");
  return u.id;
}

/** Same Origin check as the route handlers (src/lib/http.ts), for Server Actions. */
export async function requestIsSameOrigin(): Promise<boolean> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  if (!host) return false;
  return isSameOrigin(h as unknown as Headers, `https://${host}`);
}

/** Validated uuid or null (bad ids are "not found", never a database error). */
export function parseId(v: unknown): string | null {
  const r = idInput.safeParse(v);
  return r.success ? r.data : null;
}

export type ProductRow = typeof products.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;

export function primaryColor(p: Pick<ProductRow, "brandColors">): string | null {
  const c = Array.isArray(p.brandColors) ? p.brandColors[0] : undefined;
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

/** Ids of the user's products, as a subquery (keeps every lesson query user-scoped). */
const ownedProductIds = (userId: string) =>
  getDb().select({ id: products.id }).from(products).where(eq(products.userId, userId));

export async function listProducts(userId: string) {
  const db = getDb();
  const rows = await db.select().from(products).where(eq(products.userId, userId)).orderBy(products.name);
  if (rows.length === 0) return [];
  const counts = await db.select({ productId: lessons.productId, id: lessons.id }).from(lessons)
    .where(inArray(lessons.productId, ownedProductIds(userId)));
  const byProduct = new Map<string, number>();
  for (const c of counts) byProduct.set(c.productId, (byProduct.get(c.productId) ?? 0) + 1);
  return rows.map((p) => ({ ...p, lessonCount: byProduct.get(p.id) ?? 0 }));
}

export async function getProduct(userId: string, productId: string): Promise<ProductRow | null> {
  const [p] = await getDb().select().from(products).where(and(eq(products.id, productId), eq(products.userId, userId)));
  return p ?? null;
}

export async function listLessons(userId: string, productId: string): Promise<LessonRow[]> {
  return getDb().select().from(lessons)
    .where(and(eq(lessons.productId, productId), inArray(lessons.productId, ownedProductIds(userId))))
    .orderBy(lessons.term);
}

export async function getLessonWithProduct(userId: string, lessonId: string) {
  const [row] = await getDb().select({ lesson: lessons, product: products }).from(lessons)
    .innerJoin(products, eq(lessons.productId, products.id))
    .where(and(eq(lessons.id, lessonId), eq(products.userId, userId)));
  return row ?? null;
}

/** The lesson's editable draft (newest row still in status `draft`), if any. */
export async function getLessonDraft(userId: string, lessonId: string) {
  const [d] = await getDb().select().from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.lessonId, lessonId), eq(drafts.status, "draft")))
    .orderBy(desc(drafts.createdAt)).limit(1);
  return d ?? null;
}

export type DeleteResult = "deleted" | "not_found" | "in_use";

/** Delete a product, its lessons (FK cascade) and their unsent drafts. Refuses when a lesson
 *  has an approved/queued draft or a campaign points at the product, so history is never lost. */
export async function deleteProductTree(userId: string, productId: string): Promise<DeleteResult> {
  return getDb().transaction(async (tx) => {
    const [p] = await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId))).for("update");
    if (!p) return "not_found";
    const lessonIds = tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.productId, productId));
    const [sent] = await tx.select({ id: drafts.id }).from(drafts)
      .where(and(inArray(drafts.lessonId, lessonIds), ne(drafts.status, "draft"))).limit(1);
    const [camp] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.productId, productId)).limit(1);
    if (sent || camp) return "in_use";
    await tx.delete(drafts).where(and(eq(drafts.userId, userId), inArray(drafts.lessonId, lessonIds)));
    await tx.delete(products).where(and(eq(products.id, productId), eq(products.userId, userId)));
    return "deleted";
  });
}

/** Delete one lesson and its unsent drafts (refuses if it has approved/queued drafts). */
export async function deleteLessonTree(userId: string, lessonId: string): Promise<{ result: DeleteResult; productId?: string }> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ id: lessons.id, productId: lessons.productId }).from(lessons)
      .where(and(eq(lessons.id, lessonId), inArray(lessons.productId, tx.select({ id: products.id }).from(products).where(eq(products.userId, userId)))))
      .for("update");
    if (!row) return { result: "not_found" as const };
    const [sent] = await tx.select({ id: drafts.id }).from(drafts)
      .where(and(eq(drafts.lessonId, lessonId), ne(drafts.status, "draft"))).limit(1);
    if (sent) return { result: "in_use" as const, productId: row.productId };
    await tx.delete(drafts).where(and(eq(drafts.userId, userId), eq(drafts.lessonId, lessonId)));
    await tx.delete(lessons).where(eq(lessons.id, lessonId));
    return { result: "deleted" as const, productId: row.productId };
  });
}

/** Postgres error code, whether drizzle wrapped the pg error or not. */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } };
  const c = typeof err?.code === "string" ? err.code : err?.cause?.code;
  return typeof c === "string" ? c : undefined;
}
