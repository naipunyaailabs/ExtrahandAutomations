import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Calendar,
  Clock,
  Database,
  Headphones,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  Wifi,
} from "lucide-react";
import { api } from "../api";
import type { EngagementDashboardSummary } from "../types";
import { TopCitiesCard } from "./TopCitiesCard";

/**
 * Customer Engagement dashboard for today (India time): customers, orders, helpers and the cities with the most
 * customers and helpers. All numbers come from the backend
 * (backend/user_engagement), which reads them live from the ExtraHand Main Admin API every 5 minutes.
 */

/** Small KPI card. */
function Kpi({
  label,
  value,
  note,
  icon,
  tint,
}: {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  icon: React.ReactNode;
  tint: { fg: string; bg: string; border: string };
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      style={{
        background: "#ffffff",
        border: `1px solid ${tint.border}`,
        borderRadius: "12px",
        padding: "0.75rem 0.9rem",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: tint.fg, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </span>
        <span
          style={{
            width: "26px", height: "26px", borderRadius: "8px", background: tint.bg, color: tint.fg,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          {icon}
        </span>
      </div>
      <div style={{ fontSize: "1.55rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.05 }}>{value}</div>
      <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.35 }}>{note}</div>
    </motion.div>
  );
}

export const ReportsPage: React.FC = () => {
  const [data, setData] = useState<EngagementDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await api.engagement.dashboard());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the dashboard");
    } finally {
      setLoading(false);
    }
  };

  // Load now, then follow the backend's refresh interval (ExtraHand is read every 5 minutes)
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const every = (data?.refresh_seconds ?? 300) * 1000;
    const timer = setInterval(load, every);
    return () => clearInterval(timer);
  }, [data?.refresh_seconds]);

  const today = data ? new Date(`${data.today}T00:00:00+05:30`) : new Date();
  const dayNumber = today.toLocaleDateString("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" });
  const monthShort = today.toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" });
  const todayLabel = data?.today_label ?? today.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const monthName = today.toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" });
  const live = data?.source === "live";
  const n = (v?: number | null) => (v ?? 0).toLocaleString("en-IN");

  return (
    <div style={{ padding: "1.25rem 1.5rem", maxWidth: "1440px", margin: "0 auto" }}>
      {/* ------------------------------------------------------------------ header: today (top left) */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px",
          marginBottom: "1rem", paddingBottom: "0.9rem", borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            title={`Today: ${todayLabel}`}
            style={{
              width: "52px", borderRadius: "10px", overflow: "hidden", border: "1px solid #c7d2fe", flexShrink: 0,
              textAlign: "center", background: "#ffffff", boxShadow: "0 2px 6px rgba(79,70,229,0.12)",
            }}
          >
            <div style={{ background: "#4f46e5", color: "#ffffff", fontSize: "10px", fontWeight: 800, padding: "2px 0", textTransform: "uppercase" }}>
              {monthShort}
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#1e1b4b", padding: "2px 0 3px" }}>{dayNumber}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#4f46e5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Today · Customer Engagement
            </div>
            <h1 style={{ margin: "1px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
              {todayLabel}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px", fontSize: "12px", color: "var(--muted)", flexWrap: "wrap" }}>
              {data && (
                <span
                  title={data.source_note}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px",
                    background: live ? "#dcfce7" : "#fef3c7", color: live ? "#15803d" : "#b45309",
                    border: `1px solid ${live ? "#bbf7d0" : "#fde68a"}`,
                  }}
                >
                  {live ? <Wifi size={11} /> : <Database size={11} />}
                  {live ? "Live from ExtraHand" : "Local copy"}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Reload the dashboard"
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px",
            border: "1px solid var(--border)", background: "#ffffff", color: "var(--text)", fontSize: "12px",
            fontWeight: 600, cursor: loading ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} style={{ color: "#2563eb" }} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: "0.7rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#b91c1c", fontSize: "13px", fontWeight: 600, marginBottom: "1rem" }}>
          {error}
        </div>
      )}
      {data && !live && (
        <div style={{ padding: "0.6rem 1rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", color: "#92400e", fontSize: "12.5px", marginBottom: "1rem" }}>
          {data.source_note}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* ------------------------------------------------------------------ KPI cards (compact) */}
        <div style={{ fontSize: "11px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "-0.5rem" }}>
          Customers
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0.75rem" }}>
          <Kpi
            label="Total Customers"
            value={n(data?.total_users)}
            icon={<Users size={14} />}
            tint={{ fg: "#2563eb", bg: "#eff6ff", border: "#dbeafe" }}
            note={data?.new_users_month != null ? `${n(data.new_users_month)} joined in ${monthName}` : "Registered customers"}
          />
          <Kpi
            label="New Today"
            value={data?.new_users_today != null ? n(data.new_users_today) : "—"}
            icon={<UserPlus size={14} />}
            tint={{ fg: "#0891b2", bg: "#ecfeff", border: "#cffafe" }}
            note={data?.new_users_today != null ? "Customers who registered today" : "Needs live ExtraHand data"}
          />
          <Kpi
            label="Active This Month"
            value={n(data?.active_users_month)}
            icon={<Calendar size={14} />}
            tint={{ fg: "#7c3aed", bg: "#f5f3ff", border: "#ede9fe" }}
            note={`Customers with an order in ${monthName}`}
          />
          <Kpi
            label="Active Today"
            value={n(data?.active_users_today)}
            icon={<Clock size={14} />}
            tint={{ fg: "#059669", bg: "#ecfdf5", border: "#d1fae5" }}
            note="Customers with an order today"
          />
          <Kpi
            label="Today's Orders"
            value={n(data?.today_orders_count)}
            icon={<ShoppingBag size={14} />}
            tint={{ fg: "#1d4ed8", bg: "#eff6ff", border: "#dbeafe" }}
            note={`${n(data?.monthly_orders_count)} orders in ${monthName}`}
          />
          <Kpi
            label="Support Tickets"
            value={data?.support?.available ? n(data.support.open) : "—"}
            icon={<Headphones size={14} />}
            tint={{ fg: "#db2777", bg: "#fdf2f8", border: "#fce7f3" }}
            note={
              data?.support?.available
                ? `Open, of ${n(data.support.total)} tickets`
                : "Not available from ExtraHand right now"
            }
          />
        </div>

        {/* ------------------------------------------------------------------ helper KPI cards (same style) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ fontSize: "11px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Helpers
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "0.75rem" }}>
            <Kpi
              label="Total Helpers"
              value={data?.helpers?.total != null ? n(data.helpers.total) : "—"}
              icon={<Wrench size={14} />}
              tint={{ fg: "#2563eb", bg: "#eff6ff", border: "#dbeafe" }}
              note={data?.helpers?.new_month != null ? `${n(data.helpers.new_month)} joined in ${monthName}` : "Registered helpers"}
            />
            <Kpi
              label="Verified Helpers"
              value={data?.helpers?.kyc_complete != null ? n(data.helpers.kyc_complete) : "—"}
              icon={<BadgeCheck size={14} />}
              tint={{ fg: "#15803d", bg: "#f0fdf4", border: "#dcfce7" }}
              note={data?.helpers?.kyc_complete != null && data.helpers.total
                ? `Aadhaar, PAN and bank all verified · ${Math.round((data.helpers.kyc_complete / data.helpers.total) * 100)}% of helpers`
                : "Needs live ExtraHand data"}
            />
            <Kpi
              label="New Today"
              value={data?.helpers?.new_today != null ? n(data.helpers.new_today) : "—"}
              icon={<UserPlus size={14} />}
              tint={{ fg: "#0891b2", bg: "#ecfeff", border: "#cffafe" }}
              note={data?.helpers?.new_today != null ? "Helpers who registered today" : "Needs live ExtraHand data"}
            />
            <Kpi
              label="Active This Month"
              value={n(data?.helpers?.active_month)}
              icon={<Calendar size={14} />}
              tint={{ fg: "#7c3aed", bg: "#f5f3ff", border: "#ede9fe" }}
              note={`Helpers assigned a Work in ${monthName}`}
            />
            <Kpi
              label="Active Today"
              value={n(data?.helpers?.active_today)}
              icon={<Clock size={14} />}
              tint={{ fg: "#059669", bg: "#ecfdf5", border: "#d1fae5" }}
              note="Helpers with a Work today"
            />
            <Kpi
              label="Today's Works Assigned"
              value={data ? `${n(data.helpers?.today_assigned)} / ${n(data.today_orders_count)}` : "—"}
              icon={<UserCheck size={14} />}
              tint={{ fg: "#1d4ed8", bg: "#eff6ff", border: "#dbeafe" }}
              note={`${n(data?.helpers?.month_assigned)} of ${n(data?.monthly_orders_count)} Works in ${monthName} have a helper`}
            />
            <Kpi
              label="Aadhaar Verified"
              value={data?.helpers?.aadhaar_verified != null ? n(data.helpers.aadhaar_verified) : "—"}
              icon={<ShieldCheck size={14} />}
              tint={{ fg: "#db2777", bg: "#fdf2f8", border: "#fce7f3" }}
              note={
                data?.helpers?.with_completed_jobs != null
                  ? `${n(data.helpers.with_completed_jobs)} helpers have completed a job`
                  : "Needs live ExtraHand data"
              }
            />
          </div>
        </div>

        {/* ------------------------------------------------------------------ cities with the most customers and helpers */}
        <TopCitiesCard />

      </div>
    </div>
  );
};

export default ReportsPage;
