import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type BufferChannel } from "@/db/schema";
import { getCampaign, getLatestCampaignDraft, listCampaignBufferPosts } from "@/lib/campaigns/data";
import { approvalState, isApprovalCurrent } from "@/lib/campaigns/approval";
import { creativeAltText, campaignCreativeModel, CREATIVE_SIZE_KEYS, sizeLabel } from "@/lib/campaigns/creative";
import {
  CAMPAIGN_LIMITS, CAMPAIGN_NETWORK_LABELS, CAMPAIGN_NETWORKS, campaignCharCount, campaignDraftAll, campaignTextsFrom,
  isSendableCampaignNetwork, REDDIT_NOTE,
} from "@/lib/campaigns/templates";
import { campaignLinks, campaignSlug, UTM_MEDIUM } from "@/lib/campaigns/utm";
import { listProducts, parseId, requireUserId } from "@/lib/lessons/data";
import { NETWORK_LABELS } from "@/lib/lessons/templates";
import { channelErrorText, deskNoticesFrom, type Notice } from "@/lib/notices";
import { getChannels } from "@/lib/buffer/sync";
import { networkForService } from "@/lib/buffer/posts";
import { isTestMode } from "@/lib/testmode";
import { formatInZone, safeTimeZone } from "@/lib/tz";
import {
  approveCampaignDraft, deleteCampaign, saveCampaignImageAction, sendCampaignToBuffer,
} from "@/app/campaigns/actions";
import { CampaignBriefForm } from "@/components/desk/CampaignBriefForm";
import { CampaignVariantsEditor } from "@/components/desk/CampaignVariantsEditor";
import { CopyButton } from "@/components/desk/CopyButton";
import { PendingButton } from "@/components/desk/PendingButton";
import { SendPanel, type SendOption } from "@/components/desk/SendPanel";
import { SendStatus } from "@/components/desk/SendStatus";
import { card, Crumbs, DeleteDetails, linkCls, muted, NoticeBox } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign · TeachQueue" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Cached channels only: rendering this page makes zero Buffer requests beyond a first-ever sync. */
async function loadChannels(userId: string): Promise<{ channels: BufferChannel[]; error: string | null }> {
  try {
    return { channels: (await getChannels(userId)).channels, error: null };
  } catch (e) {
    return { channels: [], error: channelErrorText(e) };
  }
}

function serviceLabel(service: string): string {
  const n = networkForService(service);
  return n ? NETWORK_LABELS[n] : "Buffer";
}

const sectionCls = "mt-10 scroll-mt-4";

export default async function CampaignPage({ params, searchParams }: Props) {
  const userId = await requireUserId();
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = parseId(rawId);
  if (!id) notFound();
  const row = await getCampaign(userId, id);
  if (!row) notFound();
  const { campaign, product } = row;
  const [draft, posts, productRows, [u]] = await Promise.all([
    getLatestCampaignDraft(userId, campaign.id),
    listCampaignBufferPosts(userId, campaign.id),
    listProducts(userId),
    getDb().select({ tz: users.tz, testMode: users.testMode, hasToken: sql<boolean>`${users.accessTokenEnc} is not null`, cached: users.channelsCache }).from(users).where(eq(users.id, userId)),
  ]);
  const tz = safeTimeZone(u?.tz);
  const now = new Date();
  const fmt = (d: Date) => formatInZone(d.toISOString(), tz);

  // Buffer's sanitized reason after a rejected send (from this user's row, never the query string).
  const latestFailed = sp.n === "rejected"
    ? posts.map((r) => r.post).filter((p) => !p.bufferPostId && p.lastStatus === "failed" && p.error)
        .sort((a, b) => (b.checkedAt ?? b.createdAt).getTime() - (a.checkedAt ?? a.createdAt).getTime())[0]
    : undefined;
  const failureDetail: Notice | null = latestFailed?.error ? { kind: "error", text: `${serviceLabel(latestFailed.service)}: ${latestFailed.error}` } : null;

  const brief = { keyMessage: campaign.keyMessage ?? "", angle: campaign.angle ?? "", audience: campaign.audience ?? "", cta: campaign.cta ?? "" };
  const links = product ? campaignLinks(campaign, product) : null;
  const generated = product && links ? campaignDraftAll(brief, product, links) : null;
  const saved = campaignTextsFrom(draft?.perChannelText);
  const state = draft && product ? approvalState(draft, campaign, product) : null;
  const approvalCurrent = Boolean(draft && state && isApprovalCurrent(draft, state));
  const creative = product ? campaignCreativeModel({ campaign, product }) : null;
  const creativeHash12 = state?.creativeHash.slice(0, 12) ?? "";
  const savedLabel = draft
    ? `${draft.status === "queued" ? "sent version, " : ""}saved ${fmt(draft.createdAt)}${draft.status === "queued" ? "; saving changes makes a new version" : ""}`
    : null;

  // Send panel: approved current version only; X / Facebook / LinkedIn channels with text.
  const { channels, error: channelError } = approvalCurrent && saved && u?.hasToken ? await loadChannels(userId) : { channels: [] as BufferChannel[], error: null };
  const priorByChannel = new Map<string, Date>();
  for (const { post: p, draftId } of posts) {
    if (!draft || draftId === draft.id || !p.bufferPostId) continue;
    const at = p.checkedAt ?? p.createdAt;
    const cur = priorByChannel.get(p.channelId);
    if (!cur || at > cur) priorByChannel.set(p.channelId, at);
  }
  const options: SendOption[] = approvalCurrent && saved
    ? channels.flatMap((c) => {
        const n = networkForService(c.service);
        if (!n || !isSendableCampaignNetwork(n) || c.isDisconnected || c.isLocked || !saved[n]?.trim()) return [];
        const prior = priorByChannel.get(c.id);
        return [{
          id: c.id, name: c.displayName || c.name, networkLabel: NETWORK_LABELS[n], text: saved[n],
          count: campaignCharCount(saved[n], n), limit: CAMPAIGN_LIMITS[n], priorSentLabel: prior ? fmt(prior) : null,
        }];
      })
    : [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { href: "/campaigns", label: "Campaigns" }, { label: campaign.name }]} />
      <h1 className="mt-2 break-words text-3xl font-bold">{campaign.name}</h1>
      <p className={`mt-1 break-words text-sm ${muted}`}>
        For {product ? product.name : "no product"}{campaign.goal ? ` · Goal: ${campaign.goal}` : ""}
      </p>
      <p className="mt-2 text-sm"><Link href={`/campaigns/${campaign.id}/results`} className={linkCls}>Results</Link></p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}
      {failureDetail && <NoticeBox n={failureDetail} />}

      <section id="brief" className={`${sectionCls} ${card}`} aria-labelledby="brief-heading">
        <h2 id="brief-heading" className="mb-4 text-xl font-semibold">Brief</h2>
        <CampaignBriefForm
          campaignId={campaign.id} submitLabel="Save brief"
          products={productRows.map((p) => ({ id: p.id, name: p.name }))}
          initial={{
            productId: campaign.productId, name: campaign.name, goal: campaign.goal, audience: campaign.audience, angle: campaign.angle,
            keyMessage: campaign.keyMessage, cta: campaign.cta, startsOn: campaign.startsOn, endsOn: campaign.endsOn, utmCampaign: campaign.utmCampaign,
          }}
        />
      </section>

      {!product || !links || !generated || !creative ? (
        <p className="mt-10">Pick one of your products in the brief to draft copy and a creative.</p>
      ) : (
        <>
          <section id="links" className={sectionCls} aria-labelledby="links-heading">
            <h2 id="links-heading" className="mb-2 text-xl font-semibold">Tracking links</h2>
            <p className={`mb-4 break-words text-sm ${muted}`}>
              Links point to {product.name}&apos;s page with utm_source per network, utm_medium={UTM_MEDIUM}, utm_campaign={campaignSlug(campaign)}.
            </p>
            <ul className="space-y-3">
              {CAMPAIGN_NETWORKS.map((n) => (
                <li key={n} className={card}>
                  <p className="text-sm font-medium">{CAMPAIGN_NETWORK_LABELS[n]}</p>
                  <p className="mt-1 break-all font-mono text-sm">{links[n]}</p>
                  <div className="mt-2"><CopyButton text={links[n]} label="Copy link" what="Link" /></div>
                </li>
              ))}
            </ul>
          </section>

          <section id="variants" className={sectionCls} aria-labelledby="variants-heading">
            <h2 id="variants-heading" className="mb-4 text-xl font-semibold">Variants</h2>
            <CampaignVariantsEditor
              key={`${draft?.id ?? "new"}:${JSON.stringify(generated)}:${JSON.stringify(saved)}`}
              campaignId={campaign.id} productName={product.name} links={links} generated={generated} saved={saved} savedLabel={savedLabel}
            />
          </section>

          <section id="creative" className={sectionCls} aria-labelledby="creative-heading">
            <h2 id="creative-heading" className="mb-4 text-xl font-semibold">Creative</h2>
            <div className="space-y-6">
              {CREATIVE_SIZE_KEYS.map((size) => (
                <figure key={size} className={`${card} space-y-3`}>
                  {/* Private, no-store per-user PNG route, so next/image optimisation doesn't apply. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/campaigns/${campaign.id}/creative?size=${size}&v=${creativeHash12}`}
                    alt={creativeAltText(creative, size)}
                    className={`h-auto max-w-full rounded border border-neutral-300 dark:border-neutral-700 ${size === "story" ? "mx-auto w-1/2 min-w-40" : "w-full"}`}
                  />
                  <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{size === "square" ? "Square" : size === "landscape" ? "Landscape" : "Story"} · {sizeLabel(size)}</span>
                    <a href={`/api/campaigns/${campaign.id}/creative?size=${size}&download=1`} className={linkCls} download>
                      Download PNG ({sizeLabel(size)})
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="mt-4">
              {draft ? (
                <>
                  {state?.imageUrl && draft.imageSavedAt ? (
                    <p className="mb-3 text-sm">
                      Saved square image ✓ · {fmt(draft.imageSavedAt)} ·{" "}
                      <a href={state.imageUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>Open the saved PNG<span className="sr-only"> (opens in a new tab)</span></a>
                    </p>
                  ) : draft.imageUrl ? (
                    <p role="status" className="mb-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                      The saved image is out of date. Save it again to use the new version.
                    </p>
                  ) : null}
                  <form action={saveCampaignImageAction} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="draftId" value={draft.id} />
                    <PendingButton label="Save square image" pendingLabel="Saving image…" />
                    <span className={`text-sm ${muted}`}>Only the square image is attached to Buffer drafts. Landscape and story are download-only.</span>
                  </form>
                </>
              ) : (
                <p className={`text-sm ${muted}`}>Save the variants first.</p>
              )}
            </div>
          </section>

          <section id="approve" className={sectionCls} aria-labelledby="approve-heading">
            <h2 id="approve-heading" className="mb-4 text-xl font-semibold">Approve exact version</h2>
            {!draft || !saved || !state ? (
              <p className={`text-sm ${muted}`}>Save the variants first.</p>
            ) : (
              <div className={`${card} space-y-4`}>
                {approvalCurrent && draft.approvedAt ? (
                  <p role="status" className="font-medium">Approved ✓ · {fmt(draft.approvedAt)} · version {state.hash?.slice(0, 8)}</p>
                ) : draft.approvedHash ? (
                  <p role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                    This approval is out of date: something changed after you approved. Review and approve again.
                  </p>
                ) : null}
                <p className="text-sm">{approvalCurrent ? "This is exactly what was approved:" : "This is exactly what will be approved:"}</p>
                {CAMPAIGN_NETWORKS.map((n) => (
                  <div key={n}>
                    <h3 className="text-sm font-medium">{CAMPAIGN_NETWORK_LABELS[n]}</h3>
                    {n === "reddit" && <p className={`text-xs ${muted}`}>{REDDIT_NOTE}</p>}
                    <pre tabIndex={0} className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-300 p-3 font-mono text-sm dark:border-neutral-700">{saved[n]}</pre>
                    {state.problems[n] && <p className="mt-1 break-words text-sm text-red-700 dark:text-red-400">{state.problems[n]}</p>}
                  </div>
                ))}
                <div>
                  <h3 className="text-sm font-medium">Links</h3>
                  <ul className="mt-1 space-y-1">
                    {CAMPAIGN_NETWORKS.map((n) => <li key={n} className="break-all font-mono text-xs">{n}: {links[n]}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Image</h3>
                  {state.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={state.imageUrl} alt={creativeAltText(creative, "square")} width={1080} height={1080} className="mt-1 h-auto w-40 max-w-full rounded border border-neutral-300 dark:border-neutral-700" />
                  ) : (
                    <p className={`text-sm ${muted}`}>No image will be attached.</p>
                  )}
                </div>
                {state.hash && Object.keys(state.problems).length === 0 && !approvalCurrent ? (
                  <form action={approveCampaignDraft} className="space-y-3">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="hash" value={state.hash} />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="checkAccurate" value="yes" required className="mt-1" />
                      <span>The offer and every claim in these posts are accurate.</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="checkLink" value="yes" required className="mt-1" />
                      <span>The product name and link are correct (I opened the link).</span>
                    </label>
                    <PendingButton label="Approve exact version" pendingLabel="Approving…" />
                  </form>
                ) : !approvalCurrent ? (
                  <p className={`text-sm ${muted}`}>Fix the variants above, save them, then approve.</p>
                ) : null}
              </div>
            )}
          </section>

          <section id="send" className={sectionCls} aria-labelledby="send-heading">
            <h2 id="send-heading" className="mb-4 text-xl font-semibold">Send to Buffer</h2>
            {!approvalCurrent || !draft ? (
              <p className={`text-sm ${muted}`}>Approve the exact version above to send it.</p>
            ) : !u?.hasToken ? (
              <p className="text-sm">Your Buffer connection has expired. <a href="/api/auth/login" className="underline">Connect with Buffer</a> to send drafts.</p>
            ) : (
              <>
                {channelError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-400">{channelError}</p>}
                {options.length === 0 ? (
                  <p className={`text-sm ${muted}`}>No matching Buffer channels. Connect an X, Facebook or LinkedIn channel in Buffer, then use “Re-sync channels” on the home page.</p>
                ) : (
                  <SendPanel
                    draftId={draft.id} tz={tz} tzLabel={tz.replace(/_/g, " ")} options={options}
                    testMode={isTestMode(process.env.TEST_MODE, u.testMode)}
                    action={sendCampaignToBuffer} hidden={{ campaignId: campaign.id }} subject="campaign"
                    imageReady={Boolean(state?.imageUrl)} imageLabel="the approved square image"
                    note="Sends this approved version to Buffer as a draft, one channel at a time. The 20 sends/day limit is shared with lesson sends."
                  />
                )}
              </>
            )}
            <h3 className="mb-2 mt-6 text-lg font-semibold">Sent to</h3>
            <SendStatus
              rows={posts} channels={channels.length ? channels : u?.cached ?? []} tz={tz} currentDraftId={draft?.id ?? null} now={now}
              action={sendCampaignToBuffer} hidden={{ campaignId: campaign.id }}
            />
          </section>
        </>
      )}

      <div className="mt-10">
        <DeleteDetails
          summary="Delete campaign"
          warning={`This deletes "${campaign.name}" and its unsent drafts. A campaign with an approved or sent version can't be deleted.`}
          action={deleteCampaign} hidden={{ campaignId: campaign.id }}
        />
      </div>
      <p className="mt-8 text-sm"><Link href="/campaigns" className={linkCls}>← All campaigns</Link></p>
    </main>
  );
}
