import { AlertTriangle, Check, CheckCircle2, Copy, Download, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "./ui";
import { bookingLink, useBranding } from "../branding";
import { fmtFullDate } from "../format";
import type { CityEvent } from "../types";

/**
 * The festival poster exactly as the agents created it. There are no templates here: Agent 1 designs the whole
 * poster (concept, layout, colours, typography, wording) and Agent 2 draws the finished image, which this card
 * only shows, with Regenerate / Download / Copy WhatsApp.
 */
export interface FestivalPosterCardProps {
  event?: CityEvent | null;
  selectedCity: string;
  selectedDateStr: string;
  isIndiaSelected?: boolean;
  /** Ask the poster agent for a brand-new poster (the page shows its progress). */
  onRegenerate?: () => void;
  /** Smaller poster so it sits level with the calendar beside it. */
  compact?: boolean;
  /** Fill the parent's height: the poster shrinks to fit and the actions sit in one row (no page scroll). */
  fill?: boolean;
  /** The festival is over: keep the poster for reference, no regenerate and no offer to copy. */
  completed?: boolean;
}

interface PosterDesign {
  concept?: string;
  headline?: string;
  cta?: string;
  variant?: number;
  attempts?: number;
  poster_prompt_used?: string;
  text_check?: { checked?: boolean; ok?: boolean; problems?: string[] };
}

/** The agents' saved poster design for an event (JSON in poster_palette / poster_theme). */
export function posterDesign(event?: CityEvent | null): PosterDesign {
  const raw = (event as unknown as { poster_palette?: unknown; poster_theme?: unknown }) || {};
  for (const v of [raw.poster_palette, raw.poster_theme]) {
    if (v && typeof v === "object") return v as PosterDesign;
    if (typeof v === "string" && v.trim().startsWith("{")) {
      try {
        return JSON.parse(v) as PosterDesign;
      } catch {
        /* try the next field */
      }
    }
  }
  return {};
}

const btn = {
  borderRadius: "8px",
  padding: "7px 10px",
  fontSize: "11.5px",
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  cursor: "pointer",
} as const;

export function FestivalPosterCard({
  event,
  selectedCity,
  selectedDateStr,
  isIndiaSelected = false,
  onRegenerate,
  compact = false,
  fill = false,
  completed = false,
}: FestivalPosterCardProps) {
  const toast = useToast();
  const branding = useBranding();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const design = useMemo(() => posterDesign(event), [event]);
  const posterUrl = event?.poster_url || "";
  useEffect(() => setFailed(false), [posterUrl]);

  const cityLabel = isIndiaSelected ? "All-India" : selectedCity;
  const discount = event?.suggested_discount ?? 0;
  const code = event?.discount_code || "";
  const check = design.text_check;
  const checkFailed = Boolean(check?.checked && check.ok === false);

  const shareText =
    event?.promo_template ||
    `🎉 *${branding.company_name} ${event?.title || "Festival"} Offer${cityLabel ? ` for ${cityLabel}` : ""}!*
📅 *Date:* ${fmtFullDate(event?.date_start || selectedDateStr)}
🎁 *Discount:* Flat ${discount}% OFF
🎟️ *Coupon Code:* ${code}

👉 *Book Online:* ${bookingLink(branding, cityLabel, code)}`;

  const copy = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  const download = () => {
    if (!posterUrl) return;
    const a = document.createElement("a");
    a.href = `${posterUrl}${posterUrl.includes("?") ? "&" : "?"}download=1`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", ...(fill ? { height: "100%", minHeight: 0 } : {}) }}>
      {posterUrl && !failed ? (
        fill ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "14px", background: "#0f172a", overflow: "hidden",
            boxShadow: "0 18px 45px -12px rgba(15, 23, 42, 0.55)" }}>
            <img
              src={posterUrl}
              alt={`${event?.title || "Festival"} poster`}
              onError={() => setFailed(true)}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
        ) : (
          <img
            src={posterUrl}
            alt={`${event?.title || "Festival"} poster`}
            onError={() => setFailed(true)}
            style={{
              width: "100%",
              maxHeight: compact ? "560px" : undefined,
              objectFit: "contain",
              borderRadius: "14px",
              background: "#0f172a",
              boxShadow: "0 18px 45px -12px rgba(15, 23, 42, 0.55)",
              display: "block",
            }}
          />
        )
      ) : (
        <div style={{ border: "1px dashed #cbd5e1", borderRadius: "14px", padding: "28px 16px", textAlign: "center",
          color: "#64748b", fontSize: "13px", background: "#f8fafc" }}>
          The poster could not be loaded. Click Regenerate Poster to let the agent create it again.
        </div>
      )}

      {checkFailed && (
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.45,
          color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "8px 10px" }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
          <span>
            Check this poster before sharing: {(check?.problems || []).join("; ") || "the text check did not pass"}.
            Regenerate for a new one.
          </span>
        </div>
      )}

      {design.concept && (
        <div title={fill ? design.concept : undefined} style={{ display: "flex", gap: "7px", alignItems: "flex-start", fontSize: "12px", color: "#475569", lineHeight: 1.45, flexShrink: 0 }}>
          <Sparkles size={13} style={{ color: "#7c3aed", flexShrink: 0, marginTop: "2px" }} />
          <span style={fill ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}>
            <b style={{ color: "#0f172a" }}>Agent's idea{design.variant ? ` (poster ${design.variant})` : ""}:</b> {design.concept}
            {check?.checked && check.ok && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", marginLeft: "6px", color: "#15803d", fontWeight: 600 }}>
                <CheckCircle2 size={12} /> text checked
              </span>
            )}
          </span>
        </div>
      )}

      {completed ? (
        <button type="button" onClick={download} disabled={!posterUrl || failed}
          style={{ ...btn, flexShrink: 0, background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
          title="Download the finished poster (JPG)">
          <Download size={13} />
          Download Poster
        </button>
      ) : fill ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", flexShrink: 0 }}>
          <button
        type="button"
        onClick={() => {
          if (!event?.id) {
            toast.error("No Event Selected", "Pick a day with a festival.");
            return;
          }
          onRegenerate?.();
        }}
        style={{ ...btn, width: fill ? undefined : "100%", background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)", color: "#ffffff", border: "none" }}
        title="Agent 1 designs a completely new poster and Agent 2 draws it; the old poster is deleted"
      >
        <RefreshCw size={12} />
        {fill ? "Regenerate" : "Regenerate Poster"}
      </button>
          <button type="button" onClick={download} disabled={!posterUrl || failed}
          style={{ ...btn, background: "#0f172a", color: "#ffffff", border: "1px solid #334155" }}
          title="Download the finished poster (JPG)">
          <Download size={13} />
          {fill ? "Download" : "Download Poster"}
        </button>
        <button type="button" onClick={copy}
          style={{ ...btn, background: copied ? "#15803d" : "#ffffff", color: copied ? "#ffffff" : "#0f172a",
            border: copied ? "1px solid #16a34a" : "1px solid #cbd5e1" }}
          title="Copy the festival offer message for WhatsApp">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied!" : "Copy WhatsApp"}
        </button>
        </div>
      ) : (
        <>
          <button
        type="button"
        onClick={() => {
          if (!event?.id) {
            toast.error("No Event Selected", "Pick a day with a festival.");
            return;
          }
          onRegenerate?.();
        }}
        style={{ ...btn, width: fill ? undefined : "100%", background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)", color: "#ffffff", border: "none" }}
        title="Agent 1 designs a completely new poster and Agent 2 draws it; the old poster is deleted"
      >
        <RefreshCw size={12} />
        {fill ? "Regenerate" : "Regenerate Poster"}
      </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button type="button" onClick={download} disabled={!posterUrl || failed}
          style={{ ...btn, background: "#0f172a", color: "#ffffff", border: "1px solid #334155" }}
          title="Download the finished poster (JPG)">
          <Download size={13} />
          {fill ? "Download" : "Download Poster"}
        </button>
        <button type="button" onClick={copy}
          style={{ ...btn, background: copied ? "#15803d" : "#ffffff", color: copied ? "#ffffff" : "#0f172a",
            border: copied ? "1px solid #16a34a" : "1px solid #cbd5e1" }}
          title="Copy the festival offer message for WhatsApp">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied!" : "Copy WhatsApp"}
        </button>
          </div>
        </>
      )}
    </div>
  );
}
