"use server";
// Results: add/edit a day (form state for inline errors) and delete a day. Origin check -> session ->
// zod -> campaign ownership -> write -> redirect with a whitelisted notice.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { FormState } from "@/app/products/actions";
import { parseId, requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";
import { formFields } from "@/lib/lessons/validation";
import { deleteResultDay as deleteService, saveResultDay as saveService } from "@/lib/results/service";
import { RESULT_FIELDS } from "@/lib/results/validation";
import { safeTimeZone } from "@/lib/tz";

const FORBIDDEN = "That request came from another site, so it was ignored.";
const NOT_FOUND = "That item doesn't exist or isn't yours.";

export async function saveResultDay(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, RESULT_FIELDS);
  const fail = (extra: Partial<FormState>): FormState => ({ nonce: prev.nonce + 1, values, ...extra });
  if (!(await requestIsSameOrigin())) return fail({ error: FORBIDDEN });
  const userId = await requireUserId();
  const [u] = await getDb().select({ tz: users.tz }).from(users).where(eq(users.id, userId));
  let r: Awaited<ReturnType<typeof saveService>>;
  try {
    r = await saveService(getDb(), userId, values, safeTimeZone(u?.tz), new Date());
  } catch (e) {
    console.error("[teachqueue] save result day failed", (e as Error)?.name);
    return fail({ error: "Something went wrong saving that. Please try again." });
  }
  if (r.code === "result_invalid") return fail({ error: "Some numbers need fixing. See the notes below.", fields: r.fields });
  if (r.code === "not_found") return fail({ error: NOT_FOUND });
  revalidatePath(`/campaigns/${r.campaignId}/results`);
  redirect(`/campaigns/${r.campaignId}/results?n=result_saved#days`);
}

export async function deleteResultDay(fd: FormData): Promise<void> {
  const campaignId = parseId(fd.get("campaignId"));
  const back = (code: string) => (campaignId ? `/campaigns/${campaignId}/results?n=${code}#days` : `/campaigns?n=${code}`);
  if (!(await requestIsSameOrigin())) redirect(back("forbidden"));
  const userId = await requireUserId();
  let code: string;
  try {
    code = (await deleteService(getDb(), userId, formFields(fd, ["campaignId", "day"]))).code;
  } catch (e) {
    console.error("[teachqueue] delete result day failed", (e as Error)?.name);
    code = "error";
  }
  if (campaignId) revalidatePath(`/campaigns/${campaignId}/results`);
  redirect(back(code));
}
