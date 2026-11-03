import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { fmtFullDate, fmtShortDate } from "../format";
import type { CityEvent } from "../types";

export interface FestivalPosterCardProps {
  event?: CityEvent | null;
  selectedCity: string;
  selectedDateStr: string;
  isIndiaSelected?: boolean;
}

interface PosterTheme {
  name: string;
  gradient: string;
  accentColor: string;
  borderColor: string;
  badgeBg: string;
  badgeColor: string;
  icon: string;
  badgeLabel: string;
  headline: string;
  subheadline: string;
}

/**
 * Determine dynamic visual styling and messaging based on the day's special event.
 */
function getFestivalTheme(title: string = "", category: string = ""): PosterTheme {
  const t = title.toLowerCase();
  const c = category.toLowerCase();

  if (t.includes("diwali") || t.includes("deepavali") || t.includes("dhanteras") || t.includes("kartik")) {
    return {
      name: "diwali",
      gradient: "linear-gradient(135deg, #180d2e 0%, #3a1505 45%, #78350f 100%)",
      accentColor: "#fbbf24",
      borderColor: "rgba(245, 158, 11, 0.45)",
      badgeBg: "rgba(245, 158, 11, 0.2)",
      badgeColor: "#fef08a",
      icon: "🪔",
      badgeLabel: "DIWALI DEEPOTSAV SPECIAL",
      headline: "Light Up Your Home With A Pristine Clean",
      subheadline: "Festival Deep Cleaning, Illumination Setup & Floor Polishing",
    };
  }

  if (t.includes("sankranti") || t.includes("pongal") || t.includes("lohri") || t.includes("harvest") || t.includes("makar")) {
    return {
      name: "sankranti",
      gradient: "linear-gradient(135deg, #431407 0%, #9a3412 45%, #ea580c 100%)",
      accentColor: "#fed7aa",
      borderColor: "rgba(234, 88, 12, 0.45)",
      badgeBg: "rgba(234, 88, 12, 0.25)",
      badgeColor: "#ffedd5",
      icon: "🪁",
      badgeLabel: "SANKRANTI UTSAV SPECIAL",
      headline: "Festive Harvest Vibes In A Spotless Home",
      subheadline: "Balcony Washing, Rooftop Prep & Home Whitewash",
    };
  }

  if (t.includes("eid") || t.includes("ramzan") || t.includes("milad") || t.includes("fitr") || t.includes("adha")) {
    return {
      name: "eid",
      gradient: "linear-gradient(135deg, #022c22 0%, #064e3b 45%, #047857 100%)",
      accentColor: "#6ee7b7",
      borderColor: "rgba(16, 185, 129, 0.45)",
      badgeBg: "rgba(16, 185, 129, 0.2)",
      badgeColor: "#d1fae5",
      icon: "🌙",
      badgeLabel: "EID MUBARAK CELEBRATION",
      headline: "Welcome Blessings In A Sparkling Clean Home",
      subheadline: "Sofa Shampooing, Kitchen Chimney Clean & Living Room Prep",
    };
  }

  if (t.includes("republic") || t.includes("independence") || t.includes("gandhi") || c.includes("national") || t.includes("azadi")) {
    return {
      name: "patriotic",
      gradient: "linear-gradient(135deg, #2d1305 0%, #0f2744 50%, #064e3b 100%)",
      accentColor: "#fdba74",
      borderColor: "rgba(249, 115, 22, 0.45)",
      badgeBg: "rgba(249, 115, 22, 0.2)",
      badgeColor: "#fed7aa",
      icon: "🇮🇳",
      badgeLabel: "NATIONAL CELEBRATION SPECIAL",
      headline: "Honoring The Nation With Clean, Safe Spaces",
      subheadline: "Electrical Safety Inspections, Plumbing & Full Sanitization",
    };
  }

  if (t.includes("holi") || t.includes("rang") || t.includes("dhuleti")) {
    return {
      name: "holi",
      gradient: "linear-gradient(135deg, #4a044e 0%, #831843 45%, #0369a1 100%)",
      accentColor: "#f472b6",
      borderColor: "rgba(236, 72, 153, 0.45)",
      badgeBg: "rgba(236, 72, 153, 0.2)",
      badgeColor: "#fbcfe8",
      icon: "🎨",
      badgeLabel: "HOLI COLORS UTSAV",
      headline: "Play Carefree · Leave The Cleanup To Verified Pros",
      subheadline: "Post-Holi Wall Stain Washing, Patio Wash & Deep Scrubbing",
    };
  }

  if (t.includes("christmas") || t.includes("new year") || t.includes("year end")) {
    return {
      name: "newyear",
      gradient: "linear-gradient(135deg, #1e1b4b 0%, #881337 50%, #9f1239 100%)",
      accentColor: "#fecdd3",
      borderColor: "rgba(244, 63, 94, 0.45)",
      badgeBg: "rgba(244, 63, 94, 0.2)",
      badgeColor: "#ffe4e6",
      icon: "🎄",
      badgeLabel: "NEW YEAR FRESH START",
      headline: "Step Into The New Year With A Pristine Home",
      subheadline: "Complete House Painting, Deep Cleaning & Appliance Fixes",
    };
  }

  if (t.includes("bathukamma") || t.includes("bonalu")) {
    return {
      name: "bathukamma",
      gradient: "linear-gradient(135deg, #581c87 0%, #9d174d 45%, #b45309 100%)",
      accentColor: "#fde047",
      borderColor: "rgba(250, 204, 21, 0.45)",
      badgeBg: "rgba(250, 204, 21, 0.2)",
      badgeColor: "#fef9c3",
      icon: "🌸",
      badgeLabel: "BATHUKAMMA & BONALU UTSAV",
      headline: "Celebrate Telangana's Heritage In A Spotless Home",
      subheadline: "Courtyard Scrubbing, Festive Painting & Deep Sanitization",
    };
  }

  if (t.includes("ugadi") || t.includes("padwa") || t.includes("vishu") || t.includes("baisakhi")) {
    return {
      name: "ugadi",
      gradient: "linear-gradient(135deg, #14532d 0%, #15803d 45%, #ca8a04 100%)",
      accentColor: "#fef08a",
      borderColor: "rgba(202, 138, 4, 0.45)",
      badgeBg: "rgba(202, 138, 4, 0.2)",
      badgeColor: "#fef9c3",
      icon: "🥭",
      badgeLabel: "UGADI SHUBHAKANKSHALU",
      headline: "Fresh Beginnings For A Prosperous Year Ahead",
      subheadline: "Complete Home Deep Cleaning, Whitewash & Pest Barrier",
    };
  }

  if (t.includes("tourism") || t.includes("lake") || t.includes("winter") || t.includes("fort") || t.includes("trek") || t.includes("camp")) {
    return {
      name: "tourism",
      gradient: "linear-gradient(135deg, #042f2e 0%, #0f766e 45%, #1e3a8a 100%)",
      accentColor: "#5eead4",
      borderColor: "rgba(20, 184, 166, 0.45)",
      badgeBg: "rgba(20, 184, 166, 0.2)",
      badgeColor: "#ccfbf1",
      icon: "🏕️",
      badgeLabel: "WINTER TOURISM & GETAWAY SPECIAL",
      headline: "Pristine Spaces For Seasonal Stays & Gatherings",
      subheadline: "Guesthouse Sanitization, Water Tank Clean & AC Service",
    };
  }

  if (t.includes("expo") || t.includes("tech") || t.includes("youth") || t.includes("harvest") || t.includes("motor") || t.includes("mela") || t.includes("fair")) {
    return {
      name: "expo",
      gradient: "linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #065f46 100%)",
      accentColor: "#a7f3d0",
      borderColor: "rgba(99, 102, 241, 0.45)",
      badgeBg: "rgba(99, 102, 241, 0.2)",
      badgeColor: "#e0e7ff",
      icon: "🚀",
      badgeLabel: "HARVEST & EXPO PEAK SEASON",
      headline: "Smart Repairs & Tune-ups For Busy Households",
      subheadline: "Electrical Wiring, Motor Rewinding & Appliance Overhaul",
    };
  }

  if (t.includes("pooja") || t.includes("ganesh") || t.includes("durga") || t.includes("navratri") || t.includes("jathara") || t.includes("mallanna") || t.includes("brahmotsavam") || t.includes("bhadrakali") || t.includes("kondagattu") || t.includes("yadadri") || t.includes("swamy") || t.includes("temple")) {
    return {
      name: "pooja",
      gradient: "linear-gradient(135deg, #4c0519 0%, #831843 45%, #9a3412 100%)",
      accentColor: "#fed7aa",
      borderColor: "rgba(249, 115, 22, 0.45)",
      badgeBg: "rgba(249, 115, 22, 0.2)",
      badgeColor: "#ffedd5",
      icon: "🌺",
      badgeLabel: "FESTIVAL & POOJA SPECIAL",
      headline: "Divine Cleanliness For Holy Festivities",
      subheadline: "Mandir Polishing, Floor Sanitization & Electrical Check",
    };
  }

  return {
    name: "everyday",
    gradient: "linear-gradient(135deg, #09172e 0%, #0f3952 50%, #0b5e52 100%)",
    accentColor: "#38bdf8",
    borderColor: "rgba(56, 189, 248, 0.35)",
    badgeBg: "rgba(56, 189, 248, 0.15)",
    badgeColor: "#e0f2fe",
    icon: "⚡",
    badgeLabel: "DAILY EXTRAHAND FLASH SPECIAL",
    headline: "Verified Home Care On-Demand Within Minutes",
    subheadline: "Emergency Plumbing, Electricians & Rapid Cleaners",
  };
}

export function FestivalPosterCard({
  event,
  selectedCity,
  selectedDateStr,
  isIndiaSelected = false,
}: FestivalPosterCardProps) {
  const [copied, setCopied] = useState(false);

  const theme = useMemo(() => {
    return getFestivalTheme(event?.title || "Daily Special", event?.category || "Regular Day");
  }, [event]);

  // Properly mention dates
  const eventDateFormatted = useMemo(() => {
    if (event?.date_start) {
      return fmtFullDate(event.date_start);
    }
    return fmtFullDate(selectedDateStr);
  }, [event, selectedDateStr]);

  const validityDateFormatted = useMemo(() => {
    if (event?.date_start && event?.date_end) {
      if (event.date_start === event.date_end) {
        return fmtFullDate(event.date_start);
      }
      return `${fmtShortDate(event.date_start)} – ${fmtFullDate(event.date_end)}`;
    }
    return `Valid on ${fmtFullDate(selectedDateStr)}`;
  }, [event, selectedDateStr]);

  const discountPercent = event?.suggested_discount ?? 15;
  const couponCode = event?.discount_code || (event ? "FESTIVE25" : "FLASH15");
  const cityLabel = isIndiaSelected ? "All-India" : selectedCity;
  const targetService = event?.target_services?.[0] || "Deep Cleaning & Maintenance";

  const shareText = `🎉 *ExtraHand ${event?.title || "Special"} Offer for ${cityLabel}!*
📅 *Event Date:* ${eventDateFormatted}
⚡ *Valid Till:* ${validityDateFormatted}

🎁 *Discount:* Flat ${discountPercent}% OFF on ${targetService}
🎟️ *Coupon Code:* ${couponCode}

👉 *Book Online:* https://extrahand.in/book?city=${encodeURIComponent(cityLabel.toLowerCase())}&promo=${couponCode}
🛡️ 100% Background-Verified Pros · Punctuality Guaranteed`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* 1. VISUAL MARKETING AD POSTER BANNER */}
      <div
        className="festival-ad-poster"
        style={{
          background: theme.gradient,
          border: `1.5px solid ${theme.borderColor}`,
          borderRadius: "16px",
          padding: "16px 18px",
          color: "#ffffff",
          boxShadow: `0 8px 30px -4px ${theme.borderColor}`,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Subtle Background Glow Accent */}
        <div
          style={{
            position: "absolute",
            top: "-40px",
            right: "-40px",
            width: "160px",
            height: "160px",
            borderRadius: "50%",
            background: theme.accentColor,
            opacity: 0.12,
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />

        {/* Top Header Row of Poster: Brand + Festival Badge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <span style={{ fontSize: "18px" }}>{theme.icon}</span>
            <div style={{ lineHeight: 1.1 }}>
              <span style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "-0.01em", color: "#ffffff" }}>
                ExtraHand
              </span>
              <span style={{ display: "block", fontSize: "9px", textTransform: "uppercase", color: "rgba(255, 255, 255, 0.7)", letterSpacing: "0.06em", fontWeight: 650 }}>
                On-Demand Verified Services
              </span>
            </div>
          </div>

          <div
            style={{
              background: theme.badgeBg,
              border: `1px solid ${theme.borderColor}`,
              color: theme.badgeColor,
              padding: "3px 9px",
              borderRadius: "999px",
              fontSize: "10.5px",
              fontWeight: 750,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Sparkles size={11} />
            <span>{theme.badgeLabel}</span>
          </div>
        </div>

        {/* Festival / Special Title + Location */}
        <div>
          <div style={{ fontSize: "16px", fontWeight: 850, lineHeight: 1.25, color: "#ffffff", marginBottom: "4px" }}>
            {event?.title ? `${event.title} Special` : `Celebrate Today in ${cityLabel}`}
          </div>
          <div style={{ fontSize: "11.5px", color: theme.accentColor, fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <MapPin size={12} />
            <span>Exclusive to {cityLabel} Residents</span>
          </div>
        </div>

        {/* PROPER DATES MENTION (Prominent Date Bar on Poster) */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.28)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "10px",
            padding: "8px 12px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
          }}
        >
          <div>
            <span style={{ display: "block", fontSize: "9.5px", textTransform: "uppercase", color: "rgba(255, 255, 255, 0.65)", fontWeight: 700, letterSpacing: "0.04em" }}>
              Festival / Event Date
            </span>
            <div style={{ fontSize: "11.5px", fontWeight: 750, color: "#ffffff", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
              <Calendar size={12} style={{ color: theme.accentColor }} />
              <span>{eventDateFormatted}</span>
            </div>
          </div>

          <div>
            <span style={{ display: "block", fontSize: "9.5px", textTransform: "uppercase", color: "rgba(255, 255, 255, 0.65)", fontWeight: 700, letterSpacing: "0.04em" }}>
              Offer Validity
            </span>
            <div style={{ fontSize: "11.5px", fontWeight: 750, color: theme.accentColor, display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
              <Zap size={12} />
              <span>{validityDateFormatted}</span>
            </div>
          </div>
        </div>

        {/* Embedded Marketing Message Body */}
        <div
          style={{
            fontSize: "11.5px",
            lineHeight: 1.5,
            color: "rgba(255, 255, 255, 0.9)",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "8px",
            padding: "8px 12px",
          }}
        >
          {event?.description
            ? `${event.description} Enjoy guaranteed on-time arrival and background-verified pros in ${cityLabel}.`
            : `Book expert verified helpers across ${cityLabel} for home deep cleaning, electrical checks, and plumbing at special festive rates.`}
        </div>

        {/* Big Offer Banner Strip on the Poster */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            border: `1px solid ${theme.borderColor}`,
            borderRadius: "10px",
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            <span style={{ display: "block", fontSize: "10px", color: "rgba(255, 255, 255, 0.7)", fontWeight: 650, textTransform: "uppercase" }}>
              Special Discount
            </span>
            <span style={{ fontSize: "1.45rem", fontWeight: 900, color: theme.accentColor, lineHeight: 1 }}>
              FLAT {discountPercent}% OFF
            </span>
          </div>

          <div style={{ textAlign: "right" }}>
            <span style={{ display: "block", fontSize: "10px", color: "rgba(255, 255, 255, 0.7)", fontWeight: 650, textTransform: "uppercase" }}>
              Use Coupon Code
            </span>
            <span
              className="mono"
              style={{
                display: "inline-block",
                marginTop: "2px",
                background: "rgba(255, 255, 255, 0.15)",
                border: "1px dashed rgba(255, 255, 255, 0.4)",
                color: "#ffffff",
                padding: "3px 10px",
                borderRadius: "6px",
                fontWeight: 800,
                fontSize: "12px",
                letterSpacing: "0.04em",
              }}
            >
              {couponCode}
            </span>
          </div>
        </div>

        {/* Target Service Tags */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {(event?.target_services || ["Deep Cleaning", "Electrical", "Plumbing"]).slice(0, 3).map((s) => (
            <span
              key={s}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                color: "#ffffff",
                fontSize: "10px",
                fontWeight: 650,
                padding: "2px 8px",
                borderRadius: "999px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
              }}
            >
              ✓ {s}
            </span>
          ))}
        </div>

        {/* Trust Seal + Direct Link CTA on Poster */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "6px",
            borderTop: "1px solid rgba(255, 255, 255, 0.12)",
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.8)",
            flexWrap: "wrap",
            gap: "6px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <ShieldCheck size={12} style={{ color: "#4ade80" }} />
            <span>100% Background-Verified · On-Time Arrival Guarantee</span>
          </div>

          <a
            href={`https://extrahand.in/book?city=${encodeURIComponent(cityLabel.toLowerCase())}&promo=${couponCode}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: theme.accentColor,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
            }}
          >
            <span>Book Online</span>
            <ExternalLink size={10} />
          </a>
        </div>
      </div>

      {/* 2. ACTION CONTROLS BELOW POSTER */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            flex: "1 1 auto",
            background: copied ? "#15803d" : "#0f172a",
            color: "#ffffff",
            border: "1px solid #334155",
            borderRadius: "8px",
            padding: "8px 14px",
            fontSize: "12px",
            fontWeight: 650,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            transition: "all 0.15s ease",
          }}
          title="Copy poster text and direct booking link for WhatsApp broadcast"
        >
          {copied ? <Check size={14} style={{ color: "#bbf7d0" }} /> : <Copy size={14} />}
          <span>{copied ? "Poster Message Copied!" : "Copy Poster Text & Promo Link"}</span>
        </button>
      </div>

      {/* 3. AI ENGINE DISCLOSURE BADGE */}
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "7px 11px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11px",
          color: "#475569",
        }}
      >
        <span style={{ fontSize: "14px" }}>🤖</span>
        <div>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>AI Engine: Google Gemini 2.5 Flash</span>
          <span style={{ display: "block", fontSize: "10px", color: "#64748b" }}>
            Autonomous radar scans local news &amp; composes day-special posters with verified festival dates.
          </span>
        </div>
      </div>
    </div>
  );
}
