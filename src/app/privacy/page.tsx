import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · TeachQueue" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <div className="mt-6 space-y-4">
        <p>TeachQueue stores only what it needs to work, and nothing is shared or sold.</p>
        <h2 className="text-xl font-semibold">What we store</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>From Buffer: your account id, email, name, time zone, organization, and the list of channels you connected in Buffer.</li>
          <li>Your Buffer access and refresh tokens, encrypted (AES-256-GCM). They never reach your browser.</li>
          <li>Products, lessons, campaigns, drafts and result numbers that you type in.</li>
          <li>One encrypted session cookie holding only your TeachQueue user id, plus a short-lived sign-in cookie.</li>
        </ul>
        <h2 className="text-xl font-semibold">What we don&apos;t do</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>No ads, analytics or tracking scripts.</li>
          <li>In Test mode (on by default) TeachQueue only creates Buffer drafts; nothing publishes.</li>
        </ul>
        <h2 className="text-xl font-semibold">Your controls</h2>
        <p><strong>Disconnect</strong> deletes your Buffer tokens and ends your session. <strong>Delete my data</strong> removes your TeachQueue account and everything stored for it. You can also revoke TeachQueue&apos;s access from your Buffer account settings at any time.</p>
      </div>
      <p className="mt-10"><Link href="/" className="underline">← Back to TeachQueue</Link></p>
    </main>
  );
}
