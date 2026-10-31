import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getChannels } from "@/lib/buffer/sync";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  denied: "You cancelled the Buffer consent screen. Nothing was connected.",
  state: "That sign-in link expired or was opened in another browser. Please try again.",
  invalid_grant: "Buffer said the sign-in code was already used or expired. Please try again.",
  invalid_client: "Buffer didn't recognise this app's client. (Check the client ID and secret.)",
};

async function loadUser() {
  try {
    const session = await getAppSession();
    if (!session.userId) return null;
    const [u] = await getDb().select().from(users).where(eq(users.id, session.userId));
    if (!u?.accessTokenEnc) return null;
    let channels = u.channelsCache ?? [];
    let channelError: string | null = null;
    try { channels = (await getChannels(u.id)).channels; } catch (e) { channelError = (e as Error).message; }
    return { u, channels, channelError };
  } catch (e) {
    console.error("[teachqueue] home load failed", (e as Error).message);
    return null;
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const data = await loadUser();
  const err = sp.auth_error ? ERRORS[sp.auth_error] ?? `Connecting to Buffer failed (${sp.auth_error}).` : null;

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-3xl font-bold">TeachQueue</h1>
      <p className="mt-2 text-lg text-neutral-600">Teach what you sell. Queue it in Buffer.</p>

      {err && <p role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-red-800">{err}</p>}
      {sp.disconnected && <p className="mt-6 rounded border p-3">Disconnected. TeachQueue no longer holds your Buffer tokens.</p>}

      {!data ? (
        <section className="mt-8">
          <p>Connect your Buffer account to pick channels and queue lesson posts. New accounts start in <strong>Test mode</strong>: posts land in Buffer as drafts and never publish.</p>
          <a href="/api/auth/login" className="mt-4 inline-block rounded bg-black px-5 py-3 font-medium text-white">Connect with Buffer</a>
        </section>
      ) : (
        <section className="mt-8 space-y-4">
          <p>Connected as <strong>{data.u.displayName || data.u.email}</strong>{data.u.orgName ? <> · organization <strong>{data.u.orgName}</strong></> : null}</p>
          <p className="text-sm">Time zone: {data.u.tz} · Test mode: <strong>{data.u.testMode ? "ON (drafts only)" : "OFF"}</strong></p>
          <h2 className="text-xl font-semibold">Your Buffer channels</h2>
          {data.channelError && <p className="text-red-700">{data.channelError}</p>}
          {data.channels.length === 0 ? (
            <p>No channels yet. Connect a LinkedIn or Facebook page in Buffer, then re-sync.</p>
          ) : (
            <ul className="divide-y rounded border">
              {data.channels.map((c) => (
                <li key={c.id} className="flex items-center justify-between p-3">
                  <span>{c.displayName || c.name}</span>
                  <span className="text-sm text-neutral-500">{c.descriptor || c.service}{c.isLocked ? " · locked" : ""}{c.isDisconnected ? " · disconnected" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-3">
            <a href="/api/me?refresh=1" className="rounded border px-4 py-2">Re-sync channels</a>
            <form action="/api/auth/logout" method="post"><button className="rounded border px-4 py-2">Disconnect</button></form>
          </div>
        </section>
      )}
      <footer className="mt-16 text-sm text-neutral-500">TeachQueue is a #BufferCommit entry. Buffer post metrics aren&apos;t available to third-party apps, so results you see here are numbers you enter.</footer>
    </main>
  );
}
