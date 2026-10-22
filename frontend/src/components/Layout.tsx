import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from "framer-motion";
import {
  Check, LayoutDashboard, LifeBuoy, Moon, PhoneCall, RefreshCw, Settings, Sun, Ticket, Users, type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { fmtRelative } from "../format";
import { useTheme } from "../theme";
import type { AppConfig, Stats } from "../types";
import { LogoMark, Wordmark } from "./Logo";
import { useToast } from "./ui";

export const ConfigContext = createContext<AppConfig | null>(null);
export const useConfig = () => useContext(ConfigContext);

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/calls", label: "Calls", icon: PhoneCall },
  { to: "/customer-care", label: "Customer care", icon: LifeBuoy },
  { to: "/helpers", label: "Helper details", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { data: stats, refresh } = usePoll<Stats>(api.stats, 5000);
  const { theme, toggle } = useTheme();

  const badgeFor = (to: string) =>
    !stats ? 0 : to === "/calls" ? stats.active_calls : to === "/customer-care" ? stats.open_escalations : 0;

  const navItems = (variant: "side" | "bottom") => (
    <LayoutGroup id={`nav-${variant}`}>
      {NAV.map((n) => {
        const badge = badgeFor(n.to);
        return (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            data-tip={n.label}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-active" className="nav-active"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <n.icon size={17} className="nav-icon" />
                <span className="nav-label">{n.label}</span>
                <AnimatePresence>
                  {badge > 0 && (
                    <motion.span key={badge} className={`nav-badge ${n.to === "/customer-care" ? "red" : ""}`}
                      initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 600, damping: 18 }}>
                      {badge}
                    </motion.span>
                  )}
                </AnimatePresence>
              </>
            )}
          </NavLink>
        );
      })}
    </LayoutGroup>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Automation home">
          <LogoMark size={34} />
          <div className="brand-text">
            <div className="brand-name"><Wordmark /></div>
            <div className="brand-sub">Helper dispatch</div>
          </div>
        </NavLink>
        <nav className="side-nav">{navItems("side")}</nav>
        {config && (
          <div className="env">
            <div><span className={`dot ${config.extrahand_mode === "live" ? "success" : "live"}`} />
              <span className="env-label">{config.extrahand_mode === "live" ? "ExtraHand live" : "Mock data"}</span></div>
            <div><span className={`dot ${config.telephony_provider === "twilio" ? "success" : "live"}`} />
              <span className="env-label">{config.telephony_provider === "twilio" ? "Twilio calls" : "Call simulator"}</span></div>
          </div>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <NavLink to="/" className="topbar-brand" aria-label="Automation home"><LogoMark size={28} /><Wordmark /></NavLink>
          <div className="sync-info">
            {stats?.last_sync.at ? (
              <>
                <span className={`dot pulse ${stats.last_sync.ok ? "success" : "danger"}`} />
                Last sync {fmtRelative(stats.last_sync.at)}
                {!stats.last_sync.ok && stats.last_sync.error && <span className="error-inline"> · {stats.last_sync.error}</span>}
              </>
            ) : (
              <span className="muted">Not synced yet</span>
            )}
          </div>
          <div className="topbar-actions">
            <motion.button className="icon-btn" onClick={toggle} whileTap={{ scale: 0.9 }}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }} style={{ display: "inline-flex" }}>
                  {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <SyncButton onDone={refresh} />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      <nav className="bottom-nav">{navItems("bottom")}</nav>
      <EventToaster />
    </div>
  );
}

function SyncButton({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const controls = useAnimationControls();

  const sync = async () => {
    setState("busy");
    try {
      const s = await api.sync();
      setState("done");
      toast.success("Sync complete", `${s.fetched ?? 0} tickets · ${s.new ?? 0} new · ${s.updated ?? 0} updated`);
      onDone();
      setTimeout(() => setState("idle"), 1400);
    } catch (e) {
      setState("idle");
      toast.error("Sync failed", (e as Error).message);
      controls.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.4 } });
    }
  };

  return (
    <motion.button className={`btn btn-secondary btn-md sync-btn ${state === "done" ? "flash" : ""}`} animate={controls}
      whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} disabled={state === "busy"} onClick={sync}>
      <AnimatePresence mode="wait" initial={false}>
        {state === "done" ? (
          <motion.span key="ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
            style={{ display: "inline-flex" }}><Check size={15} /></motion.span>
        ) : (
          <motion.span key="sync" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ display: "inline-flex" }}><RefreshCw size={15} className={state === "busy" ? "spin" : ""} /></motion.span>
        )}
      </AnimatePresence>
      <span className="sync-label">{state === "busy" ? "Syncing…" : state === "done" ? "Synced" : "Sync from ExtraHand"}</span>
    </motion.button>
  );
}

const EVENT_TOASTS: Record<string, "success" | "error" | "info" | "warning"> = {
  dispatch_started: "info",
  helper_accepted: "success",
  escalated: "error",
  call_declined: "warning",
};

/** Turns new backend events into toasts (only events that arrive after the page loaded). */
function EventToaster() {
  const toast = useToast();
  const { data } = usePoll(() => api.events(20), 3000);
  const lastId = useRef<number | null>(null);

  useEffect(() => {
    if (!data?.length) return;
    const maxId = Math.max(...data.map((e) => e.id));
    if (lastId.current != null) {
      data.filter((e) => e.id > lastId.current! && EVENT_TOASTS[e.kind]).reverse()
        .forEach((e) => toast.show(EVENT_TOASTS[e.kind], e.message, e.ticket_id ?? undefined));
    }
    lastId.current = Math.max(lastId.current ?? 0, maxId);
  }, [data, toast]);

  return null;
}
