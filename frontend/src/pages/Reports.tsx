import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Headphones,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  Wifi,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { useUrlState } from "../hooks";
import type { DashboardOrderItem, EngagementDashboardSummary } from "../types";

/**
 * User Engagement dashboard for today (India time). All numbers come from the backend
 * (backend/user_engagement), which reads them live from the ExtraHand Main Admin API every 5 minutes.
 */

type StateFilter = "all" | "success" | "fail" | "pending";

const STATE_STYLE: Record<Exclude<StateFilter, "all">, { label: string; color: string; bg: string; border: string; strong: string }> = {
  success: { label: "Successful", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", strong: "#14532d" },
  fail: { label: "Failed", color: "#b91c1c", bg: "#fef2f2", border: "#fecaca", strong: "#7f1d1d" },
  pending: { label: "Pending", color: "#b45309", bg: "#fffbeb", border: "#fde68a", strong: "#78350f" },
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

const prettySource = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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
  const [filter, setFilter] = useUrlState<StateFilter>("show", "all");
  const [query, setQuery] = useUrlState<string>("q", "");

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

  const orders = useMemo<DashboardOrderItem[]>(() => {
    const q = query.trim().toLowerCase();
    return (data?.today_orders ?? []).filter((o) => {
      if (filter !== "all" && o.state_type !== filter) return false;
      if (!q) return true;
      return [o.id, o.title, o.customer_name, o.customer_phone, o.category, o.status, o.area, o.city, o.helper_name]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [data, filter, query]);

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
              Today · User Engagement
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "0.75rem" }}>
            <Kpi
              label="Total Helpers"
              value={data?.helpers?.total != null ? n(data.helpers.total) : "—"}
              icon={<Wrench size={14} />}
              tint={{ fg: "#2563eb", bg: "#eff6ff", border: "#dbeafe" }}
              note={data?.helpers?.new_month != null ? `${n(data.helpers.new_month)} joined in ${monthName}` : "Registered helpers"}
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

        {/* ------------------------------------------------------------------ today's outcome */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "1rem 1.2rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>Today's orders by outcome</h3>
            <span style={{ fontSize: "11.5px", color: "#64748b" }}>Orders booked or scheduled today · click a card to filter the list</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
            {(["success", "pending", "fail"] as const).map((kind) => {
              const st = STATE_STYLE[kind];
              const today = kind === "success" ? data?.today_success : kind === "fail" ? data?.today_fail : data?.today_pending;
              const month = kind === "success" ? data?.monthly_success : kind === "fail" ? data?.monthly_fail : data?.monthly_pending;
              const active = filter === kind;
              const Icon = kind === "success" ? CheckCircle2 : kind === "fail" ? XCircle : Clock;
              return (
                <motion.button
                  key={kind}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => setFilter(active ? "all" : kind)}
                  style={{
                    textAlign: "left", padding: "0.7rem 0.9rem", borderRadius: "10px", cursor: "pointer",
                    background: st.bg, border: active ? `2px solid ${st.color}` : `1px solid ${st.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", color: st.color, fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
                      <Icon size={13} />
                      {st.label}
                    </div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, color: st.strong, margin: "2px 0" }}>{n(today)}</div>
                    <div style={{ fontSize: "11px", color: st.color }}>{n(month)} in {monthName}</div>
                  </div>
                  <span style={{ fontSize: "11.5px", fontWeight: 800, color: st.color, background: "#ffffff", padding: "3px 9px", borderRadius: "999px", border: `1px solid ${st.border}` }}>
                    {pct(today ?? 0, data?.today_orders_count ?? 0)}%
                  </span>
                </motion.button>
              );
            })}
          </div>
          {data && data.today_orders_count > 0 && (
            <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${pct(data.today_success, data.today_orders_count)}%`, background: "#16a34a" }} title={`Successful: ${data.today_success}`} />
              <div style={{ width: `${pct(data.today_pending, data.today_orders_count)}%`, background: "#f59e0b" }} title={`Pending: ${data.today_pending}`} />
              <div style={{ width: `${pct(data.today_fail, data.today_orders_count)}%`, background: "#ef4444" }} title={`Failed: ${data.today_fail}`} />
            </div>
          )}
          {data && Object.keys(data.categories_breakdown).length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Today's services:</span>
              {Object.entries(data.categories_breakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => (
                  <span key={cat} style={{ fontSize: "11.5px", fontWeight: 600, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #dbeafe", borderRadius: "999px", padding: "2px 9px" }}>
                    {cat} · {count}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ today's orders */}
        <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "1rem 1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "0.8rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>Today's orders ({orders.length})</h3>
              <div style={{ display: "flex", gap: "3px", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
                {(["all", "pending", "success", "fail"] as const).map((k) => {
                  const count = k === "all" ? data?.today_orders_count : k === "success" ? data?.today_success : k === "fail" ? data?.today_fail : data?.today_pending;
                  const on = filter === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFilter(k)}
                      style={{
                        padding: "3px 9px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                        background: on ? (k === "all" ? "#ffffff" : STATE_STYLE[k].bg) : "transparent",
                        color: on ? (k === "all" ? "#0f172a" : STATE_STYLE[k].color) : "#64748b",
                        boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                      }}
                    >
                      {k === "all" ? "All" : STATE_STYLE[k].label} ({n(count)})
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ position: "relative", minWidth: "220px" }}>
              <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer, service, area, helper..."
                style={{ width: "100%", padding: "6px 10px 6px 30px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", boxSizing: "border-box", outline: "none" }}
              />
            </div>
          </div>

          {loading && !data ? (
            <div style={{ textAlign: "center", padding: "2.5rem", color: "#64748b", fontSize: "13px" }}>
              <RefreshCw size={22} className="spin" style={{ color: "#2563eb", marginBottom: "6px" }} />
              <div>Reading today's orders from ExtraHand...</div>
            </div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", border: "1.5px dashed #e2e8f0", borderRadius: "12px", background: "#f8fafc", color: "#64748b", fontSize: "13px" }}>
              <ShoppingBag size={28} style={{ color: "#94a3b8", marginBottom: "6px" }} />
              <div style={{ fontWeight: 700, color: "#1e293b" }}>No orders match</div>
              <div style={{ fontSize: "12px", marginTop: "2px" }}>
                {filter !== "all" ? `No ${STATE_STYLE[filter].label.toLowerCase()} orders today.` : "No orders booked or scheduled today yet."}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12.5px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    {["Order", "Customer", "Service", "When", "Area", "Helper", "Status", "Amount"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 700, fontSize: "10.5px", textTransform: "uppercase", textAlign: h === "Amount" ? "right" : "left" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const st = STATE_STYLE[o.state_type];
                    const Icon = o.state_type === "success" ? CheckCircle2 : o.state_type === "fail" ? XCircle : Clock;
                    return (
                      <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ fontFamily: "monospace", fontSize: "11.5px", fontWeight: 700, color: "#2563eb" }} title={o.id}>
                            {o.id.length > 14 ? `${o.id.slice(0, 12)}…` : o.id}
                          </div>
                          {o.booking_source && <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>{prettySource(o.booking_source)}</div>}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{o.customer_name}</div>
                          {o.customer_phone && <div style={{ fontSize: "11px", color: "#64748b" }}>{o.customer_phone}</div>}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 650, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #dbeafe" }}>
                            {o.category}
                          </span>
                        </td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px", whiteSpace: "nowrap" }}>
                          {o.scheduled_slot || timeOf(o.scheduled_at) || `Booked ${timeOf(o.created_at)}`}
                        </td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px" }}>{[o.area, o.city].filter(Boolean).join(", ") || "—"}</td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px" }}>{o.helper_name || "—"}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 9px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: st.bg, color: st.color, border: `1px solid ${st.border}`, textTransform: "capitalize" }}>
                            <Icon size={11} />
                            {o.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {o.budget > 0 ? `₹${o.budget.toLocaleString("en-IN")}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
