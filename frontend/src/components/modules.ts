import { BarChart3, IndianRupee, PartyPopper, PhoneCall, Star, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { WhatsAppIcon } from "./ui";

export type ModuleKey = "calling" | "whatsapp" | "advertisement" | "engagement" | "pricing" | "feedback";

export interface ModuleDef {
  key: ModuleKey;
  title: string;
  /** Short label for the header nav */
  short: string;
  subtitle: string;
  icon: LucideIcon | ((p: { size?: number }) => ReactNode);
  accent: string;
  path: string;
  /** Paths that count as "inside" this module (header highlight) */
  match: string[];
}

/** The six modules, in home-page / dock order. One place for names, icons and colours. */
export const MODULES: ModuleDef[] = [
  { key: "calling", title: "Calling Agent", short: "Calling", subtitle: "Helper Outreach & Voice IVR", icon: PhoneCall, accent: "#2563eb",
    path: "/calling", match: ["/calling", "/calls", "/tickets", "/customer-care", "/helpers"] },
  { key: "whatsapp", title: "WhatsApp Automation", short: "WhatsApp", subtitle: "Work Orders & Direct Chat", icon: WhatsAppIcon, accent: "#16a34a",
    path: "/whatsapp", match: ["/whatsapp"] },
  { key: "advertisement", title: "Advertisement & Campaigns", short: "Campaigns", subtitle: "State & City Event Calendars & Discounts", icon: PartyPopper,
    accent: "#d97706", path: "/advertisement", match: ["/advertisement", "/advestiment"] },
  { key: "engagement", title: "User Engagement", short: "Engagement", subtitle: "Diamond · Gold · Silver Tiers", icon: BarChart3, accent: "#7c3aed",
    path: "/engagement/dashboard", match: ["/engagement", "/reports"] },
  { key: "pricing", title: "Competitive Pricing", short: "Pricing", subtitle: "AI Pricing Agent & Competitor Analysis", icon: IndianRupee, accent: "#c026d3",
    path: "/pricing", match: ["/pricing"] },
  { key: "feedback", title: "Reviews & Feedback", short: "Feedback", subtitle: "Customer ratings after every completed task", icon: Star, accent: "#e11d48",
    path: "/feedback/reviews", match: ["/feedback"] },
];

export const moduleByKey = (k: ModuleKey) => MODULES.find((m) => m.key === k)!;

export function moduleForPath(pathname: string): ModuleDef | null {
  return MODULES.find((m) => m.match.some((p) => pathname === p || pathname.startsWith(`${p}/`))) ?? null;
}
