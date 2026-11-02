// The preview route's guard with the session and DB injected.
import { describe, expect, it, vi } from "vitest";
import { graphicGuard } from "@/lib/graphics/guard";

const LESSON_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const row = {
  lesson: { term: "Few-shot", definition: "Examples first.", example: null, format: "glossary" as const },
  product: { name: "Prompt Pantry", brandColors: ["#2563eb"] },
};

describe("graphicGuard", () => {
  it("signed out -> 401 without touching the database", async () => {
    const loadLesson = vi.fn();
    expect(await graphicGuard({ getUserId: async () => null, loadLesson }, LESSON_ID)).toEqual({ status: 401 });
    expect(loadLesson).not.toHaveBeenCalled();
  });
  it("another user's (or unknown) lesson -> 404", async () => {
    const loadLesson = vi.fn(async () => null);
    expect(await graphicGuard({ getUserId: async () => "user-b", loadLesson }, LESSON_ID)).toEqual({ status: 404 });
    expect(loadLesson).toHaveBeenCalledWith("user-b", LESSON_ID);
  });
  it("a non-uuid id -> 404 without a query", async () => {
    const loadLesson = vi.fn();
    expect(await graphicGuard({ getUserId: async () => "user-a", loadLesson }, "../../etc")).toEqual({ status: 404 });
    expect(loadLesson).not.toHaveBeenCalled();
  });
  it("owner -> 200 with the model and hash", async () => {
    const g = await graphicGuard({ getUserId: async () => "user-a", loadLesson: async () => row }, LESSON_ID);
    expect(g.status).toBe(200);
    if (g.status === 200) {
      expect(g.model.title).toBe("Few-shot");
      expect(g.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
