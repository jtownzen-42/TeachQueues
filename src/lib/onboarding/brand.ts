import "server-only";
// Save the session user's brand name (users.brand_name). Changing it changes the graphics, so saved
// images and campaign approvals become out of date by themselves (the image hash includes the mark).
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { fieldErrors, type FieldErrors } from "@/lib/lessons/validation";
import { brandInput } from "./validation";

export async function saveBrandName(db: SendDb, userId: string, raw: unknown): Promise<{ code: "brand_saved"; brandName: string | null } | { code: "brand_invalid"; fields: FieldErrors }> {
  const parsed = brandInput.safeParse(raw);
  if (!parsed.success) return { code: "brand_invalid", fields: fieldErrors(parsed.error) };
  await db.update(users).set({ brandName: parsed.data.brandName, updatedAt: new Date() }).where(eq(users.id, userId));
  return { code: "brand_saved", brandName: parsed.data.brandName };
}
