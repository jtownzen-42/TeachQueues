// Shared look for the Lesson desk, matching the home page's buttons and notices.
import Link from "next/link";
import type { Notice } from "@/lib/notices";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
export const btn = `inline-block rounded border border-neutral-400 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 ${focus}`;
export const primary = `inline-block rounded bg-black px-5 py-2 font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200 ${focus}`;
export const danger = `rounded border border-red-400 px-4 py-2 text-red-800 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950 ${focus}`;
export const muted = "text-neutral-600 dark:text-neutral-400";
export const input = `mt-1 block w-full rounded border border-neutral-400 bg-transparent px-3 py-2 dark:border-neutral-600 ${focus} aria-[invalid=true]:border-red-600 dark:aria-[invalid=true]:border-red-400`;
export const label = "block text-sm font-medium";
export const fieldError = "mt-1 text-sm text-red-700 dark:text-red-400";
export const card = "rounded border border-neutral-300 p-4 dark:border-neutral-700";
export const linkCls = `underline underline-offset-2 ${focus}`;

export function NoticeBox({ n }: { n: Notice }) {
  return n.kind === "error"
    ? <p role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{n.text}</p>
    : <p role="status" className="mt-6 rounded border border-neutral-300 p-3 dark:border-neutral-700">{n.text}</p>;
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className={`text-sm ${muted}`}>
      <ol className="flex flex-wrap gap-x-2">
        {items.map((it, i) => (
          <li key={i} className="flex min-w-0 gap-x-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.href ? <Link href={it.href} className={linkCls}>{it.label}</Link> : <span aria-current="page" className="break-words">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Swatch({ color }: { color: string | null }) {
  if (!color) return null;
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-neutral-400" style={{ backgroundColor: color }} />;
}

/** A delete button behind a disclosure + required confirmation checkbox. */
export function DeleteDetails({ summary, warning, action, hidden }: {
  summary: string; warning: string; action: (fd: FormData) => Promise<void>; hidden: Record<string, string>;
}) {
  return (
    <details className={card}>
      <summary className="cursor-pointer">{summary}</summary>
      <form action={action} className="mt-3 space-y-3">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <p className="text-sm">{warning}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" required className="mt-1" />
          <span>I understand this can&apos;t be undone.</span>
        </label>
        <button type="submit" className={danger}>{summary}</button>
      </form>
    </details>
  );
}
