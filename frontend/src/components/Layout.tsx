import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import {
  AlertOctagon,
  Check,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { fmtRelative } from "../format";
import { usePoll } from "../hooks";
import { useTheme } from "../theme";
import type { AppConfig, Stats } from "../types";
import { LogoMark, Wordmark } from "./Logo";
import { useToast } from "./ui";

export const ConfigContext = createContext<AppConfig | null>(null);
export const useConfig = () => useContext(ConfigContext);

export function Layout({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { data: stats } = usePoll<Stats>(api.stats, 5000);

  return (
    <div className="shell-no-sidebar">
      <header className="topbar">
        {/* Left: Logo + Brand */}
        <NavLink to="/" className="topbar-brand topbar-brand-always" aria-label="Home">
          <LogoMark size={28} />
          <Wordmark />
        </NavLink>

        {/* Center: Sync status */}
        <div className="sync-info">
          {stats?.last_sync.at ? (
            <>
              <span className={`dot pulse ${stats.last_sync.ok ? "success" : "danger"}`} />
              Last sync {fmtRelative(stats.last_sync.at)}
              {!stats.last_sync.ok && stats.last_sync.error && (
                <span className="error-inline" title={stats.last_sync.error}>
                  {" "}·{" "}
                  {stats.last_sync.error.includes("version") || stats.last_sync.error.includes("No matching document")
                    ? "Temporary server collision (retrying automatically)"
                    : stats.last_sync.error.length > 60
                    ? `${stats.last_sync.error.slice(0, 60)}...`
                    : stats.last_sync.error}
                </span>
              )}
            </>
          ) : (
            <span className="muted">Not synced yet</span>
          )}
        </div>

        {/* Right: actions */}
        <div className="topbar-actions">
          {config?.runtime?.emergency_stop_calls && (
            <NavLink
              to="/settings"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                background: "rgba(239, 68, 68, 0.2)",
                border: "1px solid #ef4444",
                color: "#dc2626",
                padding: "0.3rem 0.75rem",
                borderRadius: "6px",
                fontSize: "0.78rem",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              <AlertOctagon size={14} />
              <span>CALLS STOPPED</span>
            </NavLink>
          )}
          <ThemeButton />
          <UserChip />
        </div>
      </header>

      <main className="content">{children}</main>
      <EventToaster />
    </div>
  );
}

export function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <motion.button
      className="icon-btn"
      onClick={toggle}
      whileTap={{ scale: 0.9 }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "inline-flex" }}
        >
          {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

export function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="user-topbar-profile">
      <div className="user-avatar-badge">
        <User size={14} />
      </div>
      <div className="user-topbar-info">
        <span className="user-topbar-name">{user.name}</span>
        <span className="user-topbar-role">{user.role}</span>
      </div>
      <NavLink
        to="/settings"
        className="icon-btn settings-topbar-btn"
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={15} />
      </NavLink>
      <button
        className="icon-btn logout-topbar-btn"
        onClick={logout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}

/** Keep SyncButton exported so other components that may reference it don't break */
export function SyncButton({ onDone }: { onDone: () => void }) {
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
    <motion.button
      className={`btn btn-secondary btn-md sync-btn ${state === "done" ? "flash" : ""}`}
      animate={controls}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      disabled={state === "busy"}
      onClick={sync}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === "done" ? (
          <motion.span key="ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} style={{ display: "inline-flex" }}>
            <Check size={15} />
          </motion.span>
        ) : (
          <motion.span key="sync" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: "inline-flex" }}>
            <RefreshCw size={15} className={state === "busy" ? "spin" : ""} />
          </motion.span>
        )}
      </AnimatePresence>
      <span className="sync-label">{state === "busy" ? "Syncing…" : state === "done" ? "Synced" : "Sync"}</span>
    </motion.button>
  );
}

const EVENT_TOASTS: Record<string, "success" | "error" | "info" | "warning"> = {
  dispatch_started: "info",
  helper_accepted: "success",
  escalated: "error",
  call_declined: "warning",
};

export function EventToaster() {
  const toast = useToast();
  const { data } = usePoll(() => api.events(20), 3000);
  const lastId = useRef<number | null>(null);

  useEffect(() => {
    if (!data?.length) return;
    const maxId = Math.max(...data.map((e) => e.id));
    if (lastId.current != null) {
      data
        .filter((e) => e.id > lastId.current! && EVENT_TOASTS[e.kind])
        .reverse()
        .forEach((e) => toast.show(EVENT_TOASTS[e.kind], e.message, e.ticket_id ?? undefined));
    }
    lastId.current = Math.max(lastId.current ?? 0, maxId);
  }, [data, toast]);

  return null;
}
