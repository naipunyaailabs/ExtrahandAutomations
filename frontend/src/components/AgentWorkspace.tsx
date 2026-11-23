import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  ArrowLeft,
  AudioLines,
  Award,
  History,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  MessageSquare,
  PartyPopper,
  PhoneCall,
  PhoneForwarded,
  Radio,
  Scale,
  IndianRupee,
  FileText,
  ClipboardList,
  MessageSquareQuote,
  ListChecks,
  Braces,
  Send,
  Settings,
  Smartphone,
  Inbox,
  HandHeart,
  UserRoundPlus,
  Star,
  Ticket,
  Users,
  Workflow,
  Receipt,
  ReceiptIndianRupee,
  Megaphone,
  Sprout,
  CalendarDays,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { fmtRelative } from "../format";
import { useGoBack, usePoll } from "../hooks";
import type { Stats } from "../types";
import { EventToaster, ThemeButton, useConfig, UserChip } from "./Layout";
import { LogoMark, Wordmark } from "./Logo";
import { WhatsAppIcon } from "./ui";
import { CallingAgentToggle } from "./CallingAgentToggle";

export type AgentKind = "calling" | "whatsapp" | "advertisement" | "feedback" | "reports" | "pricing" | "settings";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  /** Extra path prefixes that keep this item highlighted (e.g. ticket detail under Tickets). */
  match?: string[];
  badge?: (s: Stats) => number;
  danger?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const AGENTS: Record<AgentKind, { title: string; subtitle: string; icon: LucideIcon | React.ComponentType<{ size?: number; className?: string }>; groups: NavGroup[] }> = {
  calling: {
    title: "Calling Agent",
    subtitle: "Voice IVR & Dispatch",
    icon: PhoneCall,
    groups: [
      {
        title: "Dispatch & Automation",
        items: [
          { to: "/calling", label: "Calling Agent Dispatch", icon: Workflow, match: ["/calling/dispatch"] },
          { to: "/calling/console", label: "Dialing Console", icon: Radio, badge: (s) => s.active_calls },
          { to: "/calling/history", label: "Call History", icon: History, match: ["/calls"] },
          { to: "/calling/voice", label: "Voice & IVR", icon: AudioLines },
          { to: "/calling/commercials/automation", label: "Automation Spend", icon: Receipt },
        ],
      },
      {
        title: "Bulk Calling",
        items: [
          { to: "/calling/bulk", label: "Bulk Calling", icon: PhoneForwarded },
          { to: "/calling/commercials/bulk", label: "Bulk Spend", icon: Megaphone },
        ],
      },
      {
        title: "Operations",
        items: [
          { to: "/calling/tasks", label: "Tickets & Tasks", icon: Ticket, match: ["/tickets"] },
          { to: "/calling/helpers", label: "Helper Details", icon: Users, match: ["/helpers"] },
          { to: "/calling/care", label: "Customer Care", icon: LifeBuoy, match: ["/customer-care"], badge: (s) => s.open_escalations, danger: true },
        ],
      },
    ],
  },
  whatsapp: {
    title: "WhatsApp Agent",
    subtitle: "Work orders & direct chat",
    icon: WhatsAppIcon,
    groups: [
      {
        title: "Dispatch & Automation",
        items: [
          { to: "/whatsapp", label: "WhatsApp Dispatch Dashboard", icon: Workflow, match: ["/whatsapp/dispatch"] },
          { to: "/whatsapp/overview", label: "Agent Overview", icon: LayoutDashboard, match: ["/whatsapp/dashboard"] },
          { to: "/whatsapp/send", label: "Send Work Order", icon: Send },
          { to: "/whatsapp/commercials/automation", label: "Automation Commercials", icon: Receipt },
        ],
      },
      {
        title: "Connection",
        items: [
          { to: "/whatsapp/device", label: "Meta Connection", icon: Smartphone },
          { to: "/whatsapp/messages", label: "Sent Messages", icon: Inbox },
        ],
      },
      {
        title: "Bulk Msgs",
        items: [
          {
            to: "/whatsapp/bulk",
            label: "Bulk Msgs",
            icon: MessageSquare,
            match: ["/whatsapp/bulk-msgs"],
          },
          { to: "/whatsapp/commercials/bulk", label: "Bulk Commercials", icon: Megaphone },
        ],
      },
      {
        title: "Welcomers",
        items: [
          { to: "/whatsapp/welcomers/dashboard", label: "Welcomer Dashboard", icon: LayoutDashboard },
          { to: "/whatsapp/welcomers/helper", label: "Helper Welcomer", icon: HandHeart },
          { to: "/whatsapp/welcomers/customer", label: "Customer Welcomer", icon: UserRoundPlus },
          { to: "/whatsapp/welcomers/commercials", label: "Welcomer Commercials", icon: Receipt },
        ],
      },

    ],
  },
  advertisement: {
    title: "Advertisement Agent",
    subtitle: "Marketing & Festival Ads",
    icon: PartyPopper,
    groups: [
      {
        title: "Marketing Radar",
        items: [
          { to: "/advertisement", label: "Dashboard", icon: LayoutDashboard },
          { to: "/advertisement/commercials", label: "Advertisement Commercials", icon: ReceiptIndianRupee },
        ],
      },
      {
        title: "Regions",
        items: [
          { to: "/advertisement/regions", label: "States & Cities", icon: MapPin, match: ["/advertisement/regions"] },
        ],
      },
      {
        title: "Task Seeding",
        items: [
          { to: "/advertisement/task-seeding", label: "Overview", icon: Sprout },
          { to: "/advertisement/task-seeding/calendar", label: "Festival Calendar", icon: CalendarDays },
          { to: "/advertisement/task-seeding/settings", label: "Settings", icon: SlidersHorizontal },
          { to: "/advertisement/task-seeding/history", label: "Campaign History", icon: History },
        ],
      },
    ],
  },
  feedback: {
    title: "Reviews & Feedback",
    subtitle: "Customer ratings after every task",
    icon: Star,
    groups: [
      {
        title: "Reviews & Feedback",
        items: [
          { to: "/feedback/reviews", label: "Tasks & Feedback", icon: ClipboardList },
          { to: "/feedback/replies", label: "Customer Replies", icon: MessageSquareQuote },
          { to: "/feedback/template", label: "Feedback Template", icon: FileText },
          { to: "/feedback/commercials", label: "Feedback Commercials", icon: Receipt },
        ],
      },
    ],
  },
  reports: {
    title: "User Engagement",
    subtitle: "Customer Engagement",
    icon: Users,
    groups: [
      {
        title: "Overview",
        items: [
          { to: "/engagement/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/engagement/dashboard", "/reports"] },
          { to: "/engagement/customers", label: "Customer Engagement", icon: Award, match: ["/engagement/customers", "/engagement/categories"] },
          { to: "/engagement/regions", label: "Regions", icon: MapPin },
        ],
      },
    ],
  },
  pricing: {
    title: "Competitive Pricing",
    subtitle: "Pricing agent & competitors",
    icon: IndianRupee,
    groups: [
      {
        title: "Results",
        items: [
          { to: "/pricing", label: "Recommended Prices", icon: IndianRupee },
          { to: "/pricing/compare", label: "Our Prices vs Competitors", icon: Scale },
          { to: "/pricing/analysis", label: "Competitive Analysis", icon: FileText },
          { to: "/pricing/runs", label: "Agent Runs", icon: History },
        ],
      },
      {
        title: "Setup",
        items: [
          { to: "/pricing/setup", label: "Areas, Services & Competitors", icon: ListChecks },
          { to: "/pricing/api", label: "App API", icon: Braces },
        ],
      },
    ],
  },
  settings: {
    title: "System & Settings",
    subtitle: "Configuration & integrations",
    icon: Settings,
    groups: [
      {
        title: "Preferences",
        items: [
          { to: "/settings", label: "General Settings", icon: Settings },
          { to: "/whatsapp/device", label: "WhatsApp Gateway", icon: Smartphone },
        ],
      },
      {
        title: "Live Engines",
        items: [
          { to: "/calling", label: "Calling Agent", icon: PhoneCall },
          { to: "/whatsapp", label: "WhatsApp Agent", icon: WhatsAppIcon },
        ],
      },
    ],
  },
};

/** Route prefixes that belong to each agent workspace; anything else renders in the hub layout. */
const ROUTES: Record<AgentKind, string[]> = {
  calling: ["/calling", "/calls", "/tickets", "/helpers", "/customer-care"],
  whatsapp: ["/whatsapp"],
  advertisement: ["/advertisement", "/advestiment"],
  feedback: ["/feedback"],
  reports: ["/reports", "/engagement"],
  pricing: ["/pricing"],
  settings: ["/settings"],
};

export function workspaceFor(pathname: string): AgentKind | null {
  for (const kind of Object.keys(ROUTES) as AgentKind[]) {
    if (ROUTES[kind].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return kind;
  }
  return null;
}

/** Full-screen agent workspace with its own sidebar of the agent's sections (no hub navigation). */
export function AgentWorkspace({ agent, children }: { agent: AgentKind; children: ReactNode }) {
  const def = AGENTS[agent];
  const config = useConfig();
  const location = useLocation();
  const { pathname, hash, search } = location;
  const { data: stats } = usePoll<Stats>(api.stats, 5000);
  const goBack = useGoBack("/home");


  const resolvedGroups = def.groups;
  const items = resolvedGroups.flatMap((g) => g.items);
  const isActive = (n: NavItem) => {
    if (n.to.includes("?")) {
      const [path, targetSearch] = n.to.split("?");
      return pathname === path && search === `?${targetSearch}`;
    }
    if (n.to.includes("#")) {
      const [path, targetHash] = n.to.split("#");
      return pathname === path && hash === `#${targetHash}`;
    }
    // Page filters live in ?query (e.g. /calling/tasks?date=today), so the query does not change which item is active
    if (pathname === n.to && !hash) return true;
    return (n.match ?? []).some((m) => pathname === m || pathname.startsWith(`${m.replace(/\/+$/, "")}/`));
  };
  const current = items.find(isActive) ?? items[0];
  const engine =
    agent === "calling"
      ? config?.telephony_provider === "vobiz" ? "Vobiz calls live"
        : config?.telephony_provider === "twilio" ? "Twilio calls live" : "Call simulator"
      : agent === "whatsapp"
      ? config?.whatsapp_simulated ? "WhatsApp test mode" : "Meta WhatsApp"
      : agent === "pricing"
      ? "Weekly competitor scan"
      : config?.extrahand_mode === "live" ? "ExtraHand live" : "Dual ready";

  const link = (n: NavItem, variant: "side" | "mobile") => {
    const active = isActive(n);
    const badge = stats && n.badge ? n.badge(stats) : 0;
    const isTicketsAnchor = n.to.includes("#tickets-and-tasks");

    return (
      <motion.div
        key={n.to}
        whileHover={{ x: 3 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.12 }}
        style={{ width: "100%" }}
      >
        <Link
          to={n.to}
          className={`ws-nav-item ${active ? "active" : ""}`}
          style={{
            fontSize: "12.5px",
            fontWeight: active ? 600 : 500,
            padding: "7px 10px",
            borderRadius: "8px",
            color: active ? "#0f172a" : "#475569",
            transition: "all 0.15s ease",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            background: active ? "#f8fafc" : "transparent",
            border: active ? "1px solid #e2e8f0" : "1px solid transparent",
            boxShadow: active ? "0 1px 3px rgba(0,0,0,0.04)" : "none"
          }}
          onClick={() => {
            if (isTicketsAnchor) {
              const el = document.getElementById("tickets-and-tasks");
              if (el) {
                el.scrollIntoView({ behavior: "smooth" });
                el.classList.add("section-highlight");
                setTimeout(() => el.classList.remove("section-highlight"), 2500);
              }
            }
          }}
        >
          {active && (
            <motion.span layoutId={`ws-active-${variant}`} className="ws-nav-active"
              transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
          <n.icon size={15} className="ws-nav-icon" style={{ flexShrink: 0, color: active ? "#2563eb" : "#64748b" }} />
          <span className="ws-nav-label" style={{ fontSize: "12.5px", fontWeight: active ? 600 : 500 }}>
            {n.label}
          </span>
          <AnimatePresence>
            {badge > 0 && (
              <motion.span key={badge} className={`ws-nav-badge ${n.danger ? "danger" : ""}`}
                initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                {badge}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </motion.div>
    );
  };

  return (
    <div className={`ws ws-${agent}`}>
      <aside className="ws-side">
        <Link to="/home" className="ws-brand" title="Home">
          <LogoMark size={30} />
          <span className="ws-brand-name"><Wordmark /></span>
        </Link>

        <div className="ws-agent">
          <span className="ws-agent-icon"><def.icon size={18} /></span>
          <div className="ws-agent-text">
            <span className="ws-agent-title">{def.title}</span>
            <span className="ws-agent-sub">{def.subtitle}</span>
          </div>
        </div>

        <LayoutGroup id={`ws-side-${agent}`}>
          <nav className="ws-nav" aria-label={`${def.title} sections`}>
            {resolvedGroups.map((g) => (
              <div key={g.title} className="ws-nav-group">
                <span className="ws-nav-heading">{g.title}</span>
                {g.items.map((n) => link(n, "side"))}
              </div>
            ))}
          </nav>
        </LayoutGroup>

        <div className="ws-side-foot">
          <div className="ws-status">
            <div><span className="dot success pulse" />{engine}</div>
            <div>
              <span className={`dot ${stats?.last_sync.ok === false ? "danger" : "success"}`} />
              {stats?.last_sync.at ? `Synced ${fmtRelative(stats.last_sync.at)}` : "Not synced yet"}
            </div>
          </div>
          <button type="button" className="ws-back" onClick={goBack} title="One step back">
            <ArrowLeft size={15} />
            <span>Back</span>
          </button>
        </div>
      </aside>

      <div className="ws-main">
        <header className="ws-top">
          <Link to="/home" className="ws-top-brand" aria-label="Home"><LogoMark size={26} /></Link>
          <div className="ws-crumb">
            <span className="ws-crumb-agent">{def.title}</span>
            <span className="ws-crumb-sep">/</span>
            <span className="ws-crumb-page">{current.label}</span>
          </div>
          <div className="topbar-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {agent === "calling" && (
              <>
                <CallingAgentToggle channel="automation" variant="bar" />
                <CallingAgentToggle channel="bulk" variant="bar" />
              </>
            )}
            <ThemeButton />
            <UserChip />
          </div>
        </header>

        {items.length > 1 && (
          <LayoutGroup id={`ws-mobile-${agent}`}>
            <nav className="ws-mobile-nav" aria-label={`${def.title} sections`}>{items.map((n) => link(n, "mobile"))}</nav>
          </LayoutGroup>
        )}

        <main className="ws-content">{children}</main>
      </div>
      <EventToaster />
    </div>
  );
}
