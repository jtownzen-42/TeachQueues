"use client";
import { useRef, useState } from "react";
import { btn, muted } from "./ui";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** "Copy" button with a visible, announced status. */
export function CopyButton({ text, label = "Copy text", what = "Text" }: { text: string; label?: string; what?: string }) {
  const [state, setState] = useState<"" | "ok" | "fail">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function onCopy() {
    const ok = await copyText(text);
    setState(ok ? "ok" : "fail");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(""), 2500);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" className={btn} onClick={onCopy}>{label}</button>
      <span role="status" aria-live="polite" className={`text-sm ${muted}`}>
        {state === "ok" ? `${what} copied.` : state === "fail" ? "Couldn't copy. Select the text and press Ctrl+C." : ""}
      </span>
    </span>
  );
}
