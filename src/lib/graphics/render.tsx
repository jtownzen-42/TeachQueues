// 1080x1080 PNG of a lesson card via next/og (Satori). Uses only the font bundled with next/og
// (no remote fetches, no font files). Every multi-child <div> sets display:flex, as Satori requires.
import { ImageResponse } from "next/og";
import type { LessonCardModel } from "./card";

export const CARD_SIZE = 1080;
const PAD = 72;
const INK = "#111111";
const MUTED = "#4b5563";

/** Font steps by length. At the longest allowed text (CARD_LIMITS in card.ts) the smallest steps still fit:
 *  title 3 lines @60px, body 5 lines @32px, example 3 lines @30px, inside 1080px. */
export function cardFontSizes(m: Pick<LessonCardModel, "title" | "body" | "example">) {
  const t = [...m.title].length;
  const b = [...m.body].length;
  const title = t <= 24 ? 84 : t <= 40 ? 72 : 60;
  const body = m.example ? (b > 150 ? 32 : 36) : b > 150 ? 36 : 42;
  return { title, body, example: 30 };
}

export function lessonCardElement(m: LessonCardModel) {
  const f = cardFontSizes(m);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", color: INK }}>
      {/* Accent band with the format label */}
      <div style={{ display: "flex", alignItems: "flex-end", height: 150, padding: `0 ${PAD}px 40px`, backgroundColor: m.accent }}>
        <div style={{ display: "flex", fontSize: 32, letterSpacing: 2, color: m.onAccent }}>{m.formatLabel.toUpperCase()}</div>
      </div>

      {/* Lesson text */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: `56px ${PAD}px 0`, overflow: "hidden" }}>
        <div style={{ display: "flex", fontSize: f.title, lineHeight: 1.12, letterSpacing: -1, wordBreak: "break-word" }}>{m.title}</div>
        <div style={{ display: "flex", marginTop: 36, fontSize: f.body, lineHeight: 1.4, color: "#1f2937", wordBreak: "break-word" }}>{m.body}</div>
        {m.example ? (
          <div style={{ display: "flex", marginTop: 36, padding: "22px 28px", borderLeft: `10px solid ${m.accent}`, backgroundColor: "#f3f4f6", fontSize: f.example, lineHeight: 1.4, color: "#1f2937", wordBreak: "break-word" }}>
            {m.example}
          </div>
        ) : null}
      </div>

      {/* Footer: product name, and the user's brand name in the corner when they set one */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `28px ${PAD}px 52px` }}>
        <div style={{ display: "flex", alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 0, marginRight: m.mark ? 32 : 0 }}>
          <div style={{ display: "flex", flexShrink: 0, width: 28, height: 28, borderRadius: 6, backgroundColor: m.accent, marginRight: 18 }} />
          <div style={{ display: "flex", flexShrink: 1, minWidth: 0, fontSize: 34, lineHeight: 1.2, color: INK, wordBreak: "break-word" }}>{m.productName}</div>
        </div>
        {m.mark ? <div style={{ display: "flex", flexShrink: 0, fontSize: 24, color: MUTED }}>{m.mark}</div> : null}
      </div>
    </div>
  );
}

export function renderLessonCard(m: LessonCardModel, headers?: Record<string, string>): ImageResponse {
  return new ImageResponse(lessonCardElement(m), { width: CARD_SIZE, height: CARD_SIZE, headers });
}

/** PNG bytes, for uploading to Blob (Save image renders directly; it never fetches its own route). */
export async function renderLessonCardPng(m: LessonCardModel): Promise<ArrayBuffer> {
  return renderLessonCard(m).arrayBuffer();
}
