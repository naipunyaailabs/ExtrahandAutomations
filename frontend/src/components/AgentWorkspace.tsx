import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  ArrowLeft,
  ClipboardList,
  Globe,
  History,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  PartyPopper,
  PhoneCall,
  Plus,
  Radio,
  Send,
  Settings,
  Smartphone,
  Star,
  Ticket,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { fmtRelative } from "../format";
import { usePoll } from "../hooks";
import type { Stats } from "../types";
import { EventToaster, ThemeButton, useConfig, UserChip } from "./Layout";
import { LogoMark, Wordmark } from "./Logo";
import { WhatsAppIcon } from "./ui";

export type AgentKind = "calling" | "whatsapp" | "advertisement" | "feedback" | "reports" | "tickets" | "settings";

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
        title: "Voice Console",
        items: [
          { to: "/calling", label: "Calling Agent Dispatch", icon: Workflow, match: ["/calling/dispatch"] },
          { to: "/calling/console", label: "Dialing Console", icon: Radio, badge: (s) => s.active_calls },
          { to: "/calling/history", label: "Call History", icon: History, match: ["/calls"] },
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
        ],
      },
      {
        title: "Connection",
        items: [{ to: "/whatsapp/device", label: "Device & Pairing", icon: Smartphone }],
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
        ],
      },
      {
        title: "Cities",
        items: [
          { to: "/advertisement?city=All-India", label: "All-India (National)", icon: Globe },
          { to: "/advertisement?city=Siddipet", label: "Siddipet", icon: MapPin },
          { to: "/advertisement?city=Warangal", label: "Warangal", icon: MapPin },
          { to: "/advertisement?city=Mahabubnagar", label: "Mahabubnagar", icon: MapPin },
          { to: "/advertisement?city=Karimnagar", label: "Karimnagar", icon: MapPin },
          { to: "/advertisement?city=Kalwakurthy", label: "Kalwakurthy", icon: MapPin },
          { to: "/advertisement?city=Nalgonda", label: "Nalgonda", icon: MapPin },
          { to: "/advertisement?city=Jadcherla", label: "Jadcherla", icon: MapPin },
          { to: "/advertisement?city=Nizamabad", label: "Nizamabad", icon: MapPin },
        ],
      },
    ],
  },
  feedback: {
    title: "Feedback & CSAT",
    subtitle: "Post-service surveys & quality",
    icon: Star,
    groups: [
      {
        title: "CSAT Operations",
        items: [
          { to: "/feedback", label: "CSAT Overview", icon: Star },
          { to: "/customer-care", label: "Complaints & Escalations", icon: LifeBuoy, badge: (s) => s.open_escalations, danger: true },
        ],
      },
      {
        title: "Quality Verification",
        items: [
          { to: "/calling/history", label: "Post-Service Call Logs", icon: History },
          { to: "/helpers", label: "Helper Performance", icon: Users },
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
          { to: "/engagement", label: "User Engagement", icon: Users, match: ["/engagement", "/reports"] },
        ],
      },
    ],
  },
  tickets: {
    title: "Work Orders & Tasks",
    subtitle: "Field pipeline & matching",
    icon: ClipboardList,
    groups: [
      {
        title: "Pipeline",
        items: [
          { to: "/tickets", label: "All Work Orders", icon: ClipboardList, match: ["/tickets/"] },
          { to: "/helpers", label: "Eligible Helpers", icon: Users },
        ],
      },
      {
        title: "Support",
        items: [
          { to: "/customer-care", label: "Escalations Queue", icon: LifeBuoy, badge: (s) => s.open_escalations, danger: true },
          { to: "/calling", label: "Voice Dialing Console", icon: Radio },
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
  tickets: [],
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

  // Dynamic cities sync for advertisement agent
  const [advertisementCities, setAdvertisementCities] = useState<string[]>([]);

  useEffect(() => {
    if (agent === "advertisement") {
      api.advestiment.cities().then((res) => {
        const names = res.filter((c) => !c.is_national && c.city_name !== "All-India").map((c) => c.city_name);
        if (names.length > 0) {
          setAdvertisementCities(names);
        }
      }).catch(() => {});
    }
  }, [agent]);

  useEffect(() => {
    const handleCityAdded = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.city_name) {
        setAdvertisementCities((prev) => Array.from(new Set([...prev, customEvent.detail.city_name])));
      }
    };
    window.addEventListener("city-added", handleCityAdded);
    return () => window.removeEventListener("city-added", handleCityAdded);
  }, []);

  // Compute actual groups with dynamic cities if advertisement
  const resolvedGroups = def.groups.map((g) => {
    if (agent === "advertisement" && g.title === "Cities" && advertisementCities.length > 0) {
      return {
        ...g,
        items: [
          { to: "/advertisement?city=All-India", label: "All-India (National)", icon: Globe },
          ...advertisementCities.map((cityName) => ({
            to: `/advertisement?city=${encodeURIComponent(cityName)}`,
            label: cityName,
            icon: MapPin,
          })),
        ],
      };
    }
    return g;
  });

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
    return (pathname === n.to && !hash && (!search || search === "")) || (n.match ?? []).some((m) => pathname.startsWith(m));
  };
  const current = items.find(isActive) ?? items[0];
  const engine =
    agent === "calling"
      ? config?.telephony_provider === "twilio" ? "Twilio Voice" : "Call simulator"
      : agent === "whatsapp"
      ? config?.whatsapp_simulated ? "Simulated line" : "OpenWA live"
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
          <span className="ws-nav-label" style={{ fontSize: "12.5px", fontWeight: active ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
        <Link to="/" className="ws-brand" title="Overview Hub">
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
            {resolvedGroups.map((g) => {
              const isCitiesGroup = g.title === "Cities";
              return (
                <div key={g.title} className="ws-nav-group">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 6px" }}>
                    <span className="ws-nav-heading" style={{ padding: 0 }}>{g.title}</span>
                    {isCitiesGroup && (
                      <motion.button
                        whileHover={{ scale: 1.12 }}
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent("open-add-city-modal"))}
                        title="Add new city with data sources"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "20px",
                          height: "20px",
                          borderRadius: "5px",
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          cursor: "pointer",
                          color: "#475569",
                          padding: 0,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                        }}
                      >
                        <Plus size={12} />
                      </motion.button>
                    )}
                  </div>

                  {isCitiesGroup ? (
                    <div
                      className="ws-city-scroll"
                      style={{
                        maxHeight: "185px", // Exactly 5 items visible height
                        overflowY: "auto",
                        overflowX: "hidden",
                        paddingRight: "2px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px"
                      }}
                    >
                      {g.items.map((n) => link(n, "side"))}
                    </div>
                  ) : (
                    g.items.map((n) => link(n, "side"))
                  )}
                </div>
              );
            })}
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
          <Link to="/" className="ws-back">
            <ArrowLeft size={15} />
            <span>Back to Overview Hub</span>
          </Link>
        </div>
      </aside>

      <div className="ws-main">
        <header className="ws-top">
          <Link to="/" className="ws-top-brand" aria-label="Overview Hub"><LogoMark size={26} /></Link>
          <div className="ws-crumb">
            <span className="ws-crumb-agent">{def.title}</span>
            <span className="ws-crumb-sep">/</span>
            <span className="ws-crumb-page">{current.label}</span>
          </div>
          <div className="topbar-actions">
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
