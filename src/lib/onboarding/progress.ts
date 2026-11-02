// "Getting started" checklist, derived only from real data for the user. Pure.
import type { BufferChannel } from "@/db/schema";
import { networkForService } from "@/lib/buffer/posts";

export type OnboardingFacts = {
  /** users.channels_cache (no Buffer call). */
  channels: BufferChannel[] | null;
  productCount: number;
  sampleProductCount: number;
  lessonCount: number;
  /** Drafts of the user with image_saved_at set. */
  savedImageCount: number;
  /** buffer_posts rows with a Buffer post id on the user's drafts. */
  sentCount: number;
};

export type StepKey = "channel" | "product" | "lesson" | "graphic" | "send";
export type OnboardingStep = { key: StepKey; label: string; done: boolean; hint: string; href: string; sampleOnly?: boolean };
export type Visibility = "open" | "collapsed" | "hidden";
export type OnboardingProgress = { steps: OnboardingStep[]; doneCount: number; total: number; visibility: Visibility; next: OnboardingStep | null };

/** A connected X, Facebook or LinkedIn channel that isn't disconnected or locked. */
export function hasUsableChannel(channels: BufferChannel[] | null | undefined): boolean {
  return (channels ?? []).some((c) => networkForService(c.service) !== null && !c.isDisconnected && !c.isLocked);
}

export function onboardingProgress(f: OnboardingFacts): OnboardingProgress {
  const steps: OnboardingStep[] = [
    {
      key: "channel", label: "Connect a channel in Buffer and re-sync", done: hasUsableChannel(f.channels), href: "/#channels-heading",
      hint: "Connect an X, Facebook or LinkedIn channel in Buffer, then press Re-sync channels.",
    },
    {
      key: "product", label: "Add a product", done: f.productCount > 0, href: "/products",
      hint: "Add what you sell, or load two sample products to try it out.",
      sampleOnly: f.productCount > 0 && f.productCount === f.sampleProductCount,
    },
    { key: "lesson", label: "Add a lesson", done: f.lessonCount > 0, href: "/products", hint: "Open a product and add a short lesson." },
    {
      key: "graphic", label: "Save a lesson graphic", done: f.savedImageCount > 0, href: "/products",
      hint: "On a lesson page, save the draft, then press Save image. (A preview alone isn't recorded.)",
    },
    { key: "send", label: "Send one draft to Buffer", done: f.sentCount > 0, href: "/products", hint: "On a lesson page, send the saved draft to one of your Buffer channels." },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const visibility: Visibility = doneCount === steps.length ? "hidden" : doneCount >= 3 ? "collapsed" : "open";
  return { steps, doneCount, total: steps.length, visibility, next: steps.find((s) => !s.done) ?? null };
}
