// Deterministic, template-only post copy for lessons (no AI, no network).
// Pure module: no server-only imports, so it runs in the browser (live counts) and in vitest.

export const NETWORKS = ["x", "facebook", "linkedin"] as const;
export type Network = (typeof NETWORKS)[number];

export const NETWORK_LABELS: Record<Network, string> = { x: "X", facebook: "Facebook", linkedin: "LinkedIn" };

/** Facebook allows far more; 2,000 is TeachQueue's own cap for readable posts. */
export const LIMITS: Record<Network, number> = { x: 280, facebook: 2000, linkedin: 3000 };

export const LESSON_FORMATS = ["glossary", "prompt_demo", "misconception"] as const;
export type LessonFormat = (typeof LESSON_FORMATS)[number];

export const FORMAT_LABELS: Record<LessonFormat, string> = {
  glossary: "Glossary lesson",
  prompt_demo: "Prompt demonstration",
  misconception: "Common misconception",
};

export type LessonFields = { term: string; definition: string; example?: string | null; format: LessonFormat };
export type ProductFields = { name: string; url: string };
export type DraftTexts = Record<Network, string>;

/** X counts every link as 23 characters (t.co). */
export const X_URL_LENGTH = 23;
const URL_RE = /https?:\/\/[^\s]+/g;

/** Code points X weighs as 1; everything else (CJK, emoji, ...) counts as 2.
 *  Ranges follow twitter-text's default config. Emoji sequences are slightly over-counted,
 *  which errs on the safe side. */
function xWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

/** Character count as each network measures it (X: weighted, links = 23; others: code points). */
export function charCount(text: string, network: Network): number {
  const t = text.normalize("NFC");
  if (network !== "x") return [...t].length;
  let n = 0;
  let last = 0;
  for (const m of t.matchAll(URL_RE)) {
    for (const ch of t.slice(last, m.index)) n += xWeight(ch.codePointAt(0)!);
    n += X_URL_LENGTH;
    last = m.index! + m[0].length;
  }
  for (const ch of t.slice(last)) n += xWeight(ch.codePointAt(0)!);
  return n;
}

export function isOverLimit(text: string, network: Network): boolean {
  return charCount(text, network) > LIMITS[network];
}

/** Tidy user text: unify newlines, trim, and collapse blank-line runs. */
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "prompt engineering 101" -> "#PromptEngineering101" (letters/digits only; empty if nothing usable). */
export function hashtagFor(term: string): string {
  const words = term.normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const tag = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("").slice(0, 40);
  return /^\p{N}+$/u.test(tag) || !tag ? "" : `#${tag}`;
}

export function signature(p: ProductFields): string {
  return `${clean(p.name)} — ${p.url.trim()}`;
}

type Parts = { term: string; definition: string; example: string };

function body(format: LessonFormat, network: Network, f: Parts): string {
  const ex = f.example;
  const short = network === "x";
  switch (format) {
    case "glossary":
      return short
        ? [`Word of the day: ${f.term}`, f.definition, ex && `Example: ${ex}`].filter(Boolean).join("\n\n")
        : [
            network === "linkedin" ? `Today's glossary term: ${f.term}` : `Quick lesson: what does "${f.term}" mean?`,
            f.definition,
            ex && `Example: ${ex}`,
            network === "linkedin" ? "Save this for the next time it comes up in a meeting." : "Save this post so you have it handy.",
          ].filter(Boolean).join("\n\n");
    case "prompt_demo":
      return short
        ? [`Prompt to try: ${f.term}`, ex && `"${ex}"`, `Why it works: ${f.definition}`].filter(Boolean).join("\n\n")
        : [
            `Prompt demonstration: ${f.term}`,
            ex ? `Copy this prompt:\n"${ex}"` : null,
            `Why it works: ${f.definition}`,
            network === "linkedin" ? "Try it on your next task and compare the result with your usual prompt." : "Give it a try and tell us how it went in the comments.",
          ].filter(Boolean).join("\n\n");
    case "misconception":
      return short
        ? [`Myth: ${f.term}`, `Reality: ${f.definition}`, ex && `For example: ${ex}`].filter(Boolean).join("\n\n")
        : [
            `Common misconception: ${f.term}`,
            `What's actually true: ${f.definition}`,
            ex && `For example: ${ex}`,
            network === "linkedin" ? "Have you run into this one at work?" : "Did you believe this one too?",
          ].filter(Boolean).join("\n\n");
  }
}

function assemble(lesson: Parts, format: LessonFormat, network: Network, product: ProductFields): string {
  const tag = network === "linkedin" ? hashtagFor(lesson.term) : "";
  return [body(format, network, lesson), tag, signature(product)].filter(Boolean).join("\n\n");
}

/** Shorten `s` by `by` code points, ending with an ellipsis. */
function shorten(s: string, by: number): string {
  const cps = [...s];
  const keep = Math.max(0, cps.length - by - 1);
  return keep === 0 ? "" : cps.slice(0, keep).join("").trimEnd() + "…";
}

/** Draft one network's copy. If it runs over the limit, the example, then the definition,
 *  then the term are trimmed (with "…") so the product name and URL always stay at the end.
 *  If even that can't fit (e.g. a very long product name), the over-limit text is returned
 *  and the UI shows the over-limit error. */
export function draftFor(lesson: LessonFields, product: ProductFields, network: Network): string {
  const parts: Parts = { term: clean(lesson.term), definition: clean(lesson.definition), example: clean(lesson.example) };
  const limit = LIMITS[network];
  const mins: Record<keyof Parts, number> = { example: 12, definition: 20, term: 12 };
  let text = assemble(parts, lesson.format, network, product);
  for (const key of ["example", "definition", "term"] as const) {
    let guard = 0;
    while (charCount(text, network) > limit && parts[key] && guard++ < 50) {
      const over = charCount(text, network) - limit;
      const next = shorten(parts[key], over);
      // Too short to be useful: drop an example entirely, floor the others.
      if ([...next].length < mins[key]) {
        if (key === "example") parts.example = "";
        else { parts[key] = shorten(parts[key], [...parts[key]].length - mins[key]); text = assemble(parts, lesson.format, network, product); break; }
      } else {
        parts[key] = next;
      }
      text = assemble(parts, lesson.format, network, product);
    }
  }
  return text;
}

export function draftAll(lesson: LessonFields, product: ProductFields): DraftTexts {
  return { x: draftFor(lesson, product, "x"), facebook: draftFor(lesson, product, "facebook"), linkedin: draftFor(lesson, product, "linkedin") };
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** Problems that block saving a draft (empty, over limit, or missing the product signature). */
export function draftProblems(texts: DraftTexts, product: ProductFields): Partial<Record<Network, string>> {
  const out: Partial<Record<Network, string>> = {};
  const sig = signature(product);
  for (const n of NETWORKS) {
    const t = (texts[n] ?? "").trim();
    const count = charCount(t, n);
    if (!t) out[n] = `${NETWORK_LABELS[n]} text is empty.`;
    else if (count > LIMITS[n]) out[n] = `${NETWORK_LABELS[n]} text is ${plural(count - LIMITS[n], "character")} over the ${LIMITS[n].toLocaleString("en-US")} limit.`;
    else if (!t.endsWith(sig)) out[n] = `${NETWORK_LABELS[n]} text must end with "${sig}".`;
  }
  return out;
}
