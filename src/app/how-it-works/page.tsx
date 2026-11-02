import type { Metadata } from "next";
import Link from "next/link";
import { LANDING } from "@/lib/onboarding/landing";

export const metadata: Metadata = { title: "How it works · TeachQueue", description: LANDING.headline };

/** Public, static: no sign-in, no database. Same styling as /privacy. */
export default function HowItWorks() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <h1 className="text-3xl font-bold">How it works</h1>
      <div className="mt-6 space-y-4">
        <p>{LANDING.intro}</p>

        <h2 className="text-xl font-semibold">What you need</h2>
        <p>A Buffer account with at least one X, Facebook or LinkedIn channel. TeachQueue also drafts a Reddit version you can copy, but it never sends that one to Buffer.</p>

        <h2 className="text-xl font-semibold">Lesson desk</h2>
        <p>Add a product you sell and a few short lessons it teaches: a glossary term, a common misconception, or a prompt demonstration. TeachQueue drafts a post for each network from fixed templates (no AI writing), plus a branded graphic. You edit the copy, save it, and send it.</p>

        <h2 className="text-xl font-semibold">Marketing desk</h2>
        <p>Write a short campaign brief for one of your products. TeachQueue adds tracking (UTM) links per network, drafts the posts, and makes a creative in three sizes. You tick the honesty checks and approve the exact version; only that version can be sent.</p>

        <h2 className="text-xl font-semibold">Calendar &amp; Results</h2>
        <p>The Calendar shows your posts by day and reads their status back from Buffer when you open it or press Refresh. Results are numbers you type in, because Buffer doesn&apos;t share post metrics with third-party apps.</p>

        <h2 className="text-xl font-semibold">Test mode &amp; drafts</h2>
        <p>{LANDING.testMode}</p>

        <h2 className="text-xl font-semibold">Your data</h2>
        <p>See <Link href="/privacy" className="underline">Privacy</Link> for what is stored. When you&apos;re signed in, the home page has <strong>Disconnect</strong> (forget your Buffer tokens) and <strong>Delete my data</strong> (remove everything TeachQueue saved for you).</p>
      </div>
      <p className="mt-10"><Link href="/" className="underline">← Back to TeachQueue</Link></p>
    </main>
  );
}
