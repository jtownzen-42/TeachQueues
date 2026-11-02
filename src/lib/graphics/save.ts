import "server-only";
// "Save image": render the lesson card and store it as a public PNG in Vercel Blob, recording
// image_url / image_hash / image_saved_at on the draft. Deps are injected so it runs on PGlite.
// Order: validate -> ownership -> idempotent skip -> storage configured? -> daily limit -> render -> one upload -> validate URL -> store.
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { drafts, lessons, products } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { cardModelHash, lessonCardModel, type LessonCardModel } from "./card";
import { currentImageUrl, isPublicBlobUrl, lessonImagePathname } from "./blob";

import { IMAGE_SAVE_LIMIT_PER_DAY, IMAGE_WINDOW_MS } from "./limits";

export { IMAGE_SAVE_LIMIT_PER_DAY, IMAGE_WINDOW_MS };

type PutOptions = { access: "public"; addRandomSuffix: true; contentType: "image/png" };
export type SaveImageDeps = {
  db: SendDb;
  /** @vercel/blob put(); reads BLOB_READ_WRITE_TOKEN from the environment itself. */
  put: (pathname: string, body: Buffer, opts: PutOptions) => Promise<{ url: string }>;
  render: (model: LessonCardModel) => Promise<ArrayBuffer | Uint8Array>;
  now: () => Date;
  /** False when Blob storage isn't configured (BLOB_READ_WRITE_TOKEN missing). Checked by name only. Default true. */
  storageReady?: boolean;
};

/** Unknown fields are stripped and never read. */
export const saveImageInput = z.object({ lessonId: z.uuid(), draftId: z.uuid() });

export type SaveImageCode = "image_saved" | "image_limit" | "image_failed" | "image_storage_off" | "not_found";
export type SaveImageResult = { code: SaveImageCode; lessonId?: string; url?: string; uploaded?: boolean };

/** Image saves in the window: drafts of this user whose image_saved_at falls inside it. */
export async function countImageSaves(db: SendDb, userId: string, since: Date): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(drafts)
    .where(and(eq(drafts.userId, userId), gt(drafts.imageSavedAt, since)));
  return Number(r?.n ?? 0);
}

export async function saveLessonImage(deps: SaveImageDeps, userId: string, raw: unknown): Promise<SaveImageResult> {
  const { db } = deps;
  const parsed = saveImageInput.safeParse(raw);
  if (!parsed.success) return { code: "not_found" };
  const { lessonId, draftId } = parsed.data;

  // Ownership: the draft is this user's AND belongs to this lesson, and the lesson's product is this user's.
  const [row] = await db.select({ draft: drafts, lesson: lessons, product: products }).from(drafts)
    .innerJoin(lessons, eq(lessons.id, drafts.lessonId))
    .innerJoin(products, eq(products.id, lessons.productId))
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId), eq(drafts.lessonId, lessonId), eq(products.userId, userId)));
  if (!row) return { code: "not_found" };

  const model = lessonCardModel({ lesson: row.lesson, product: row.product });
  const hash = cardModelHash(model);

  // Same graphic already saved: nothing to upload.
  const existing = currentImageUrl(row.draft, hash);
  if (existing) return { code: "image_saved", lessonId, url: existing, uploaded: false };

  // No Blob store configured: friendly notice, no render, no upload (the preview route still works).
  if (deps.storageReady === false) return { code: "image_storage_off", lessonId };

  const now = deps.now();
  if ((await countImageSaves(db, userId, new Date(now.getTime() - IMAGE_WINDOW_MS))) >= IMAGE_SAVE_LIMIT_PER_DAY) {
    return { code: "image_limit", lessonId };
  }

  let url: string;
  try {
    const png = await deps.render(model);
    const body = Buffer.from(png instanceof Uint8Array ? png : new Uint8Array(png));
    const res = await deps.put(lessonImagePathname(draftId, hash), body, { access: "public", addRandomSuffix: true, contentType: "image/png" });
    url = res?.url;
  } catch (e) {
    // Name/status only: never the token or a response body.
    console.error("[teachqueue] image save failed", (e as { name?: string })?.name, (e as { status?: number })?.status ?? "");
    return { code: "image_failed", lessonId };
  }
  if (!isPublicBlobUrl(url)) {
    console.error("[teachqueue] image save failed", "UnexpectedBlobUrl");
    return { code: "image_failed", lessonId };
  }

  // Metadata only: status and per_channel_text are untouched (a queued draft may get an image too).
  // The previous blob is NOT deleted: a Buffer draft may still point at it until it publishes.
  await db.update(drafts).set({ imageUrl: url, imageHash: hash, imageSavedAt: now })
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)));
  return { code: "image_saved", lessonId, url, uploaded: true };
}
