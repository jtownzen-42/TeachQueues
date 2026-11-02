"use client";
import { useActionState, useMemo, useState } from "react";
import { saveCampaignVariants } from "@/app/campaigns/actions";
import type { FormState } from "@/app/products/actions";
import {
  CAMPAIGN_LIMITS, CAMPAIGN_NETWORK_LABELS, CAMPAIGN_NETWORKS, campaignCharCount, campaignDraftProblems, REDDIT_NOTE,
  type CampaignNetwork, type CampaignTexts,
} from "@/lib/campaigns/templates";
import type { CampaignLinks } from "@/lib/campaigns/utm";
import { plural } from "@/lib/lessons/templates";
import { CopyButton } from "./CopyButton";
import { btn, card, fieldError, input, muted, primary } from "./ui";

export function CampaignVariantsEditor({ campaignId, productName, links, generated, saved, savedLabel }: {
  campaignId: string; productName: string; links: CampaignLinks; generated: CampaignTexts; saved: CampaignTexts | null; savedLabel: string | null;
}) {
  const [texts, setTexts] = useState<CampaignTexts>(saved ?? generated);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(saveCampaignVariants, { nonce: 0 });
  const problems = useMemo(() => campaignDraftProblems(texts, { name: productName }, links), [texts, productName, links]);
  const blocked = Object.keys(problems).length > 0;
  const serverFields = dirty ? {} : state.fields ?? {};
  const set = (n: CampaignNetwork, v: string) => { setTexts((t) => ({ ...t, [n]: v })); setDirty(true); };

  return (
    <form action={action} onSubmit={(e) => { if (blocked) e.preventDefault(); else setDirty(false); }} className="space-y-4">
      <input type="hidden" name="campaignId" value={campaignId} />
      <p className={`text-sm ${muted}`}>
        {saved ? `Showing your saved variants${savedLabel ? ` (${savedLabel})` : ""}.` : "Not saved yet. These variants come from the campaign brief."}
      </p>
      {CAMPAIGN_NETWORKS.map((n) => {
        const id = `variant-${n}`;
        const count = campaignCharCount(texts[n], n);
        const over = count > CAMPAIGN_LIMITS[n];
        const problem = problems[n] ?? serverFields[n];
        return (
          <section key={n} className={card} aria-labelledby={`${id}-h`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`${id}-h`} className="text-lg font-semibold"><label htmlFor={id}>{CAMPAIGN_NETWORK_LABELS[n]}</label></h3>
              <span id={`${id}-count`} className={`text-sm tabular-nums ${over ? "font-semibold text-red-700 dark:text-red-400" : muted}`}>
                {count.toLocaleString("en-US")} / {CAMPAIGN_LIMITS[n].toLocaleString("en-US")}
              </span>
            </div>
            {n === "reddit" && <p className={`mt-1 text-sm ${muted}`}>{REDDIT_NOTE}</p>}
            <textarea
              id={id} name={n} value={texts[n]} onChange={(e) => set(n, e.target.value)} rows={n === "x" ? 6 : 9} spellCheck
              className={`${input} font-mono text-sm`} aria-invalid={Boolean(problem)} aria-describedby={`${id}-count${problem ? ` ${id}-err` : ""}`}
            />
            {problem && (
              <p id={`${id}-err`} role="alert" className={`${fieldError} break-words`}>
                {over ? `Over the limit by ${plural(count - CAMPAIGN_LIMITS[n], "character")}. Shorten it before saving.` : problem}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <CopyButton text={texts[n]} what={`${CAMPAIGN_NETWORK_LABELS[n].replace(" (copy only)", "")} text`} />
              <button type="button" className={btn} disabled={texts[n] === generated[n]} onClick={() => set(n, generated[n])}>Reset to template</button>
            </div>
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primary} disabled={pending || blocked}>{pending ? "Saving…" : "Save variants"}</button>
        <span role="status" aria-live="polite" className="text-sm">
          {!dirty && state.error ? <span className="text-red-700 dark:text-red-400">{state.error}</span> : dirty ? <span className={muted}>Unsaved changes.</span> : ""}
        </span>
      </div>
      {blocked && <p className={`text-sm ${muted}`}>Fix the notes above to save. Every variant must include its own tracking link and the product name exactly.</p>}
    </form>
  );
}
