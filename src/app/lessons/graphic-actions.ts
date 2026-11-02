"use server";
// Thin wrapper: Origin check -> session -> saveLessonImage() -> redirect with a whitelisted notice.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { saveLessonImage } from "@/lib/graphics/save";
import { renderLessonCardPng } from "@/lib/graphics/render";
import { parseId, requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";
import { formFields } from "@/lib/lessons/validation";

export async function saveLessonImageAction(fd: FormData): Promise<void> {
  const backId = parseId(fd.get("lessonId"));
  const back = (code: string) => (backId ? `/lessons/${backId}?n=${code}#graphic` : `/products?n=${code}`);
  if (!(await requestIsSameOrigin())) redirect(back("forbidden"));
  const userId = await requireUserId();

  let code: string;
  try {
    // put() reads BLOB_READ_WRITE_TOKEN from the environment; it is never passed or logged here.
    const r = await saveLessonImage(
      { db: getDb(), put: (pathname, body, opts) => put(pathname, body, opts), render: renderLessonCardPng, now: () => new Date(),
        storageReady: Boolean(process.env.BLOB_READ_WRITE_TOKEN) },
      userId,
      formFields(fd, ["lessonId", "draftId"]),
    );
    code = r.code;
  } catch (e) {
    console.error("[teachqueue] save image crashed", (e as Error)?.name);
    code = "image_failed";
  }
  if (backId) revalidatePath(`/lessons/${backId}`);
  redirect(back(code));
}
