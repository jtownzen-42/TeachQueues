// Fixed copy for the public landing page and /how-it-works. Plain and accurate: no stats, no
// testimonials, no claims beyond what the app does.

export const LANDING = {
  product: "TeachQueue",
  headline: "Teach what you sell. Queue it in Buffer.",
  intro: "TeachQueue turns lessons about the products you sell into ready-to-review posts for X, Facebook and LinkedIn, and sends the version you approve to your Buffer account as drafts.",
  steps: [
    { title: "Add a product and a few lessons", body: "Tell TeachQueue what you sell and a few short things it teaches." },
    { title: "Review the exact posts and graphic", body: "Check the template-drafted copy for each network and a branded image, then tick the honesty checks: the post is accurate and the product name and link are correct." },
    { title: "Send to Buffer", body: "The post lands in your Buffer account as a draft. In Test mode, which is on by default, it is always a draft and never publishes." },
  ],
  testMode: "Test mode is on for every new account. Everything TeachQueue sends to Buffer is saved as a draft, so nothing is published from TeachQueue. You review, schedule and publish inside Buffer.",
  signIn: "Sign in with Buffer",
  expiredLead: "Your Buffer connection has expired or was revoked. Sign in again to continue.",
  footer: "TeachQueue is a #BufferCommit entry.",
  metricsNote: "Buffer post metrics aren't available to third-party apps, so results you see here are numbers you enter.",
} as const;
