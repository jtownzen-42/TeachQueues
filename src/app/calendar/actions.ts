"use server";
// "Refresh from Buffer": Origin check -> session -> (no fields; unknown stripped) -> read-back service
// (cooldown, rate-limit guard, <= 3 read-only queries) -> redirect with a whitelisted notice.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { getValidAccessToken } from "@/lib/buffer/tokens";
import { readBackStatuses } from "@/lib/calendar/readback";
import { requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";

const refreshInput = z.object({});

/** Keep the user's current view (?view=&start=) on redirect, digits/known words only. */
function backQuery(fd: FormData): string {
  const view = fd.get("view");
  const start = fd.get("start");
  const v = view === "month" ? "month" : "week";
  const s = typeof start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start) ? `&start=${start}` : "";
  return `view=${v}${s}`;
}

export async function refreshFromBuffer(fd: FormData): Promise<void> {
  const q = backQuery(fd);
  if (!(await requestIsSameOrigin())) redirect(`/calendar?${q}&n=forbidden`);
  const userId = await requireUserId();
  refreshInput.parse({}); // no fields are read from the form beyond the view echo
  let code: string;
  let wait = "";
  try {
    const r = await readBackStatuses({ db: getDb(), getToken: getValidAccessToken, now: () => new Date() }, userId, { trigger: "manual" });
    code = r.code === "not_due" ? "read_ok" : r.code;
    if (r.code === "busy" && r.retryAfter) wait = `&wait=${Math.max(1, Math.ceil(r.retryAfter / 60))}`;
  } catch (e) {
    console.error("[teachqueue] refresh from Buffer crashed", (e as Error)?.name);
    code = "read_failed";
  }
  revalidatePath("/calendar");
  redirect(`/calendar?${q}&n=${code}${wait}`);
}
