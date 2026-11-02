"use server";
// Onboarding Server Actions: Origin check -> session -> zod -> user-scoped write -> redirect with a
// whitelisted notice. No Buffer calls.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";
import { formFields } from "@/lib/lessons/validation";
import { loadSamples, removeSamples } from "@/lib/onboarding/samples";
import { saveBrandName as saveBrandService } from "@/lib/onboarding/brand";
import { backInput } from "@/lib/onboarding/validation";

const backTo = (fd: FormData) => backInput.parse(formFields(fd, ["back"])).back;
const go = (back: string, code: string, anchor = "") => redirect(`${back}?n=${code}${anchor}`);

export async function loadSampleProducts(fd: FormData): Promise<void> {
  const back = backTo(fd);
  if (!(await requestIsSameOrigin())) go(back, "forbidden");
  const userId = await requireUserId();
  let code: string;
  try {
    code = (await loadSamples(getDb(), userId)).code;
  } catch (e) {
    console.error("[teachqueue] load samples failed", (e as Error)?.name);
    code = "error";
  }
  revalidatePath("/"); revalidatePath("/products"); revalidatePath("/campaigns");
  go(back, code);
}

export async function removeSampleProducts(fd: FormData): Promise<void> {
  const back = backTo(fd);
  if (!(await requestIsSameOrigin())) go(back, "forbidden");
  const userId = await requireUserId();
  let code: string;
  try {
    code = (await removeSamples(getDb(), userId)).code;
  } catch (e) {
    console.error("[teachqueue] remove samples failed", (e as Error)?.name);
    code = "error";
  }
  revalidatePath("/"); revalidatePath("/products"); revalidatePath("/campaigns");
  go(back, code);
}

export async function saveBrandName(fd: FormData): Promise<void> {
  if (!(await requestIsSameOrigin())) go("/", "forbidden", "#brand");
  const userId = await requireUserId();
  let code: string;
  try {
    code = (await saveBrandService(getDb(), userId, formFields(fd, ["brandName"]))).code;
  } catch (e) {
    console.error("[teachqueue] save brand failed", (e as Error)?.name);
    code = "error";
  }
  revalidatePath("/");
  go("/", code, "#brand");
}
