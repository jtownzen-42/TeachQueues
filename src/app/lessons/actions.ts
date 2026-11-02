"use server";
// Thin wrapper: Origin check -> session -> sendDraftToBuffer() -> redirect with a whitelisted notice.
// All the rules (ownership, idempotency, daily limit, drafts-only) live in src/lib/buffer/send.ts.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getValidAccessToken } from "@/lib/buffer/tokens";
import { sendDraftToBuffer } from "@/lib/buffer/send";
import { parseId, requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";
import { formFields } from "@/lib/lessons/validation";

export async function sendToBuffer(fd: FormData): Promise<void> {
  const backId = parseId(fd.get("lessonId"));
  const back = (code: string, extra = "") => (backId ? `/lessons/${backId}?n=${code}${extra}` : `/products?n=${code}`);
  if (!(await requestIsSameOrigin())) redirect(back("forbidden"));
  const userId = await requireUserId();

  // Only these four fields are read; anything else in the form (e.g. saveToDraft) is ignored.
  const raw = formFields(fd, ["draftId", "channelId", "mode", "local"]);
  let result: Awaited<ReturnType<typeof sendDraftToBuffer>>;
  try {
    result = await sendDraftToBuffer(
      { db: getDb(), getToken: getValidAccessToken, now: () => new Date(), envTestMode: process.env.TEST_MODE },
      userId,
      { ...raw, local: raw.mode === "custom" ? raw.local : undefined },
    );
  } catch (e) {
    console.error("[teachqueue] send to Buffer crashed", (e as Error)?.name);
    redirect(back("error"));
  }

  const lessonId = result.lessonId ?? backId;
  if (lessonId) revalidatePath(`/lessons/${lessonId}`);
  const wait = result.code === "busy" && result.retryAfter ? `&wait=${Math.max(1, Math.ceil(result.retryAfter / 60))}` : "";
  redirect(lessonId ? `/lessons/${lessonId}?n=${result.code}${wait}#send` : `/products?n=${result.code}`);
}
