// Campaign creative PNGs via next/og (Satori), one layout in three sizes. Only the font bundled
// with next/og; every multi-child <div> sets display:flex, as Satori requires.
import { ImageResponse } from "next/og";
import { CREATIVE_SIZES, type CampaignCreativeModel, type CreativeSize } from "./creative";

const INK = "#111111";
const MUTED = "#4b5563";

type Steps = { pad: number; band: number; headline: number; sub: number; cta: number; product: number; mark: number; gap: number };

/** Font steps per size, stepped down by text length. At the longest allowed text (CREATIVE_LIMITS:
 *  headline 90, sub 140, cta 40, product 40) the smallest steps fit with word wrapping:
 *  square    headline 76/64/54, sub 38/32, cta 34  (1080×1080)
 *  landscape headline 56/48/40, sub 28/24, cta 26  (1200×628)
 *  story     headline 96/84/72, sub 48/42, cta 42  (1080×1920) */
export function creativeSteps(m: Pick<CampaignCreativeModel, "headline" | "sub">, size: CreativeSize): Steps {
  const h = [...m.headline].length;
  const s = [...m.sub].length;
  const pick = (big: number, mid: number, small: number) => (h <= 40 ? big : h <= 65 ? mid : small);
  switch (size) {
    case "square":
      return { pad: 72, band: 520, headline: pick(76, 64, 54), sub: s <= 80 ? 38 : 32, cta: 34, product: 30, mark: 22, gap: 32 };
    case "landscape":
      return { pad: 56, band: 330, headline: pick(56, 48, 40), sub: s <= 80 ? 28 : 24, cta: 26, product: 24, mark: 18, gap: 20 };
    case "story":
      return { pad: 88, band: 900, headline: pick(96, 84, 72), sub: s <= 80 ? 48 : 42, cta: 42, product: 36, mark: 26, gap: 48 };
  }
}

export function campaignCreativeElement(m: CampaignCreativeModel, size: CreativeSize) {
  const st = creativeSteps(m, size);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", color: INK }}>
      {/* Accent block with the headline (onAccent text meets WCAG 4.5:1) */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: st.band, padding: `${st.pad}px`, backgroundColor: m.accent, overflow: "hidden" }}>
        <div style={{ display: "flex", fontSize: st.headline, lineHeight: 1.12, letterSpacing: -1, color: m.onAccent, wordBreak: "break-word" }}>{m.headline}</div>
      </div>

      {/* Offer / angle and the call to action */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", padding: `${st.gap}px ${st.pad}px 0`, overflow: "hidden" }}>
        {m.sub ? <div style={{ display: "flex", fontSize: st.sub, lineHeight: 1.35, color: "#1f2937", wordBreak: "break-word" }}>{m.sub}</div> : null}
        <div style={{ display: "flex", marginTop: m.sub ? st.gap : 0 }}>
          <div style={{ display: "flex", padding: `${Math.round(st.cta * 0.45)}px ${Math.round(st.cta * 0.8)}px`, borderRadius: 999, backgroundColor: m.accent, color: m.onAccent, fontSize: st.cta, lineHeight: 1.2, wordBreak: "break-word" }}>
            {m.cta}
          </div>
        </div>
      </div>

      {/* Footer: product name, and the user's brand name in the corner when they set one */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${Math.round(st.gap * 0.8)}px ${st.pad}px ${Math.round(st.pad * 0.7)}px` }}>
        <div style={{ display: "flex", alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 0, marginRight: m.mark ? 24 : 0 }}>
          <div style={{ display: "flex", flexShrink: 0, width: st.product * 0.8, height: st.product * 0.8, borderRadius: 6, backgroundColor: m.accent, marginRight: 14 }} />
          <div style={{ display: "flex", flexShrink: 1, minWidth: 0, fontSize: st.product, lineHeight: 1.2, color: INK, wordBreak: "break-word" }}>{m.productName}</div>
        </div>
        {m.mark ? <div style={{ display: "flex", flexShrink: 0, fontSize: st.mark, color: MUTED }}>{m.mark}</div> : null}
      </div>
    </div>
  );
}

export function renderCampaignCreative(m: CampaignCreativeModel, size: CreativeSize, headers?: Record<string, string>): ImageResponse {
  const [width, height] = CREATIVE_SIZES[size];
  return new ImageResponse(campaignCreativeElement(m, size), { width, height, headers });
}

export async function renderCampaignCreativePng(m: CampaignCreativeModel, size: CreativeSize): Promise<ArrayBuffer> {
  return renderCampaignCreative(m, size).arrayBuffer();
}
