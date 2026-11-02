// Server components for first-run onboarding: checklist, sample buttons, brand form, sample badge.
import Link from "next/link";
import { loadSampleProducts, removeSampleProducts, saveBrandName } from "@/app/onboarding/actions";
import type { OnboardingProgress } from "@/lib/onboarding/progress";
import { MARK_MAX } from "@/lib/graphics/card";
import { DeleteDetails, btn, card, input, label, linkCls, muted, primary } from "./ui";

type Back = "/" | "/products" | "/campaigns";

/** Small "Sample" badge (text, not color alone). */
export function SampleBadge() {
  return <span className="ml-2 inline-block rounded border border-amber-500 px-1.5 py-0.5 align-middle text-xs font-semibold text-amber-800 dark:border-amber-400 dark:text-amber-300">Sample</span>;
}

export function LoadSamplesForm({ back, prominent = false }: { back: Back; prominent?: boolean }) {
  return (
    <form action={loadSampleProducts} className="inline">
      <input type="hidden" name="back" value={back} />
      <button type="submit" className={prominent ? primary : btn}>Load sample products</button>
    </form>
  );
}

export function RemoveSamplesDetails({ back }: { back: Back }) {
  return (
    <DeleteDetails
      summary="Remove samples"
      warning="This removes the sample products and their lessons. Your own products stay."
      action={removeSampleProducts}
      hidden={{ back }}
    />
  );
}

export function GettingStarted({ progress, hasSamples, productCount }: { progress: OnboardingProgress; hasSamples: boolean; productCount: number }) {
  if (progress.visibility === "hidden") return null;
  const list = (
    <>
      <ol className="mt-3 space-y-3">
        {progress.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 text-center font-semibold">{s.done ? "✓" : "○"}</span>
            <div className="min-w-0">
              <p className="break-words">
                <span className="font-medium">{s.label}</span>{" "}
                <span className={`text-sm ${s.done ? "" : muted}`}>({s.done ? "Done" : "To do"})</span>
                {s.done && s.sampleOnly && <span className={`text-sm ${muted}`}> (sample)</span>}
              </p>
              {!s.done && (
                <p className={`text-sm ${muted}`}>
                  {s.hint}{" "}
                  {progress.next?.key === s.key && <Link href={s.href} className={linkCls}>Do this next</Link>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!hasSamples && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <LoadSamplesForm back="/" prominent={productCount === 0} />
          <span className={`text-sm ${muted}`}>Adds two fictional products, each with one lesson, so you can try every step.</span>
        </div>
      )}
    </>
  );
  return (
    <section className={`mt-8 ${card}`} aria-labelledby="getting-started-heading">
      <details open={progress.visibility === "open"}>
        <summary className="cursor-pointer">
          <h2 id="getting-started-heading" className="inline text-xl font-semibold">Getting started</h2>{" "}
          <span className="text-sm">· {progress.doneCount} of {progress.total} done</span>
        </summary>
        {list}
      </details>
    </section>
  );
}

/** "Brand name on your graphics": saved value, or the Buffer organization name as a suggestion. */
export function BrandForm({ saved, suggestion }: { saved: string | null; suggestion: string | null }) {
  const value = saved ?? suggestion ?? "";
  return (
    <section id="brand" className={`scroll-mt-4 ${card}`} aria-labelledby="brand-heading">
      <h2 id="brand-heading" className="text-xl font-semibold">Brand name on your graphics</h2>
      <form action={saveBrandName} className="mt-3 space-y-3">
        <div>
          <label htmlFor="brand-name" className={label}>Brand name</label>
          <input id="brand-name" name="brandName" maxLength={MARK_MAX * 2} defaultValue={value} autoComplete="organization" className={`${input} max-w-md`} aria-describedby="brand-help" />
          <p id="brand-help" className={`mt-1 text-sm ${muted}`}>
            {saved
              ? "Shown in the corner of your lesson graphics and campaign creatives."
              : suggestion
                ? "Suggested from your Buffer organization. Save to use it, or clear it for no name."
                : "Shown in the corner of your graphics. Leave it empty for no name."}{" "}
            Up to {MARK_MAX} characters. Changing it marks saved images as out of date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="submit" className={btn}>Save brand name</button>
          {!saved && <span className={`text-sm ${muted}`}>Nothing is drawn until you save.</span>}
        </div>
      </form>
    </section>
  );
}
