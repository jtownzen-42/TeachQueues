// Who may see a lesson graphic: the signed-in owner only. Deps are injected so this is testable.
import { idInput } from "@/lib/lessons/validation";
import { cardModelHash, lessonCardModel, type LessonCardModel } from "./card";

type LessonRow = Parameters<typeof lessonCardModel>[0]["lesson"];
type ProductRow = Parameters<typeof lessonCardModel>[0]["product"];

export type GraphicGuardDeps = {
  /** The session user id if the session is valid and the user row exists, else null. */
  getUserId: () => Promise<string | null>;
  /** The lesson + product only when the lesson belongs to `userId` (getLessonWithProduct). */
  loadLesson: (userId: string, lessonId: string) => Promise<{ lesson: LessonRow; product: ProductRow } | null>;
};

export type GraphicGuardResult =
  | { status: 401 }
  | { status: 404 }
  | { status: 200; model: LessonCardModel; hash: string };

export async function graphicGuard(deps: GraphicGuardDeps, rawLessonId: unknown): Promise<GraphicGuardResult> {
  const userId = await deps.getUserId();
  if (!userId) return { status: 401 };
  const id = idInput.safeParse(rawLessonId);
  if (!id.success) return { status: 404 };
  const row = await deps.loadLesson(userId, id.data);
  if (!row) return { status: 404 };
  const model = lessonCardModel(row);
  return { status: 200, model, hash: cardModelHash(model) };
}
