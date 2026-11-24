import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Award, CheckCircle2, ChevronLeft, ChevronRight, Clock, Crown, Gem, Medal, RefreshCw, Search, Users, XCircle } from "lucide-react";
import { api } from "../api";
import type { CategorisedCustomer, CustomerCategories, CustomerTierKey, SilverCustomerPage } from "../types";

/**
 * User Engagement > Category: real customers grouped by how many orders they placed in a month
 * (Diamond 8+, Gold 5-7, Platinum 1-4, Silver 0 = no order). Numbers come from backend/user_engagement/categories.py.
 */

const TIER_LOOK: Record<CustomerTierKey, { color: string; bg: string; border: string; grad: string; icon: React.ElementType }> = {
  diamond: { color: "#0e7490", bg: "#ecfeff", border: "#a5f3fc", grad: "linear-gradient(135deg, #22d3ee, #0891b2)", icon: Gem },
  gold: { color: "#a16207", bg: "#fefce8", border: "#fde68a", grad: "linear-gradient(135deg, #facc15, #ca8a04)", icon: Crown },
  platinum: { color: "#4338ca", bg: "#eef2ff", border: "#c7d2fe", grad: "linear-gradient(135deg, #a5b4fc, #6366f1)", icon: Award },
  silver: { color: "#475569", bg: "#f8fafc", border: "#cbd5e1", grad: "linear-gradient(135deg, #cbd5e1, #64748b)", icon: Medal },
};

const n = (v?: number | null) => (v ?? 0).toLocaleString("en-IN");
const dateOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }) : "—";

function TierBadge({ tier }: { tier: CustomerTierKey | null }) {
  if (!tier) return <span style={{ color: "#94a3b8" }}>—</span>;
  const look = TIER_LOOK[tier];
  const Icon = look.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 9px", borderRadius: "999px", fontSize: "11px",
      fontWeight: 800, background: look.bg, color: look.color, border: `1px solid ${look.border}`, textTransform: "capitalize" }}>
      <Icon size={11} />
      {tier}
    </span>
  );
}

export const EngagementCategoriesPage: React.FC = () => {
  const [month, setMonth] = useState<string>("");
  const [data, setData] = useState<CustomerCategories | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<CustomerTierKey | "all">("all");
  const [query, setQuery] = useState("");
  // Silver = customers with no order in the month: listed page by page from ExtraHand
  const [silverPage, setSilverPage] = useState(1);
  const [silver, setSilver] = useState<SilverCustomerPage | null>(null);
  const [loadingSilver, setLoadingSilver] = useState(false);

  const load = async (m = month) => {
    try {
      setLoading(true);
      setError(null);
      setData(await api.engagement.categories(m || undefined));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the customer categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(month);
    setSilverPage(1);
  }, [month]);

  useEffect(() => {
    if (tier !== "silver" || !data) return;
    let stop = false;
    setLoadingSilver(true);
    api.engagement
      .silverCustomers(silverPage, data.month)
      .then((res) => !stop && setSilver(res))
      .catch((err: unknown) => !stop && setSilver({ available: false, reason: err instanceof Error ? err.message : "Could not load", customers: [], page: silverPage, pages: 0 }))
      .finally(() => !stop && setLoadingSilver(false));
    return () => {
      stop = true;
    };
  }, [tier, silverPage, data?.month]);

  const silverRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (silver?.customers ?? []).filter((c) => !q || [c.name, c.phone, c.area, c.city].some((v) => (v || "").toLowerCase().includes(q)));
  }, [silver, query]);

  const customers = useMemo<CategorisedCustomer[]>(() => {
    const q = query.trim().toLowerCase();
    return (data?.customers ?? []).filter((c) => {
      if (tier !== "all" && c.tier !== tier) return false;
      if (!q) return true;
      return [c.name, c.phone, c.area, c.city, c.top_service].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [data, tier, query]);

  return (
    <div style={{ padding: "1.25rem 1.5rem", maxWidth: "1440px", margin: "0 auto" }}>
      {/* ------------------------------------------------------------------ header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px",
        marginBottom: "1rem", paddingBottom: "0.9rem", borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#4f46e5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Customer Engagement · Customer Categories
          </div>
          <h1 style={{ margin: "1px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "var(--text)" }}>
            Customer Engagement · {data?.month_label ?? "This month"}
          </h1>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px" }}>
            Real customers grouped by the orders they placed in the month (Diamond, Gold, Platinum, Silver)
            {data && ` · ${n(data.registered_customers)} customers, ${n(data.active_customers)} ordered (${n(data.orders_in_month)} orders)`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            value={month || data?.month || ""}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
            style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px", fontWeight: 600, background: "#ffffff", color: "var(--text)" }}
          >
            {(data?.months ?? []).map((m, i) => (
              <option key={m.value} value={m.value}>{i === 0 ? `${m.label} (this month)` : m.label}</option>
            ))}
          </select>
          <button type="button" onClick={() => load()} disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--border)",
              background: "#ffffff", color: "var(--text)", fontSize: "12px", fontWeight: 600, cursor: loading ? "wait" : "pointer" }}>
            <RefreshCw size={13} className={loading ? "spin" : ""} style={{ color: "#2563eb" }} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.7rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#b91c1c", fontSize: "13px", fontWeight: 600, marginBottom: "1rem" }}>
          {error}
        </div>
      )}
      {data?.source === "local" && (
        <div style={{ padding: "0.6rem 1rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", color: "#92400e", fontSize: "12.5px", marginBottom: "1rem" }}>
          Showing the local copy: ExtraHand live data is unavailable ({data.source_note}).
        </div>
      )}

      {/* ------------------------------------------------------------------ the four categories */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {(data?.tiers ?? []).map((t) => {
          const look = TIER_LOOK[t.key];
          const Icon = look.icon;
          const active = tier === t.key;
          return (
            <motion.button
              key={t.key}
              type="button"
              whileHover={{ y: -2 }}
              onClick={() => {
                setTier(active ? "all" : t.key);
                setSilverPage(1);
              }}
              style={{ textAlign: "left", cursor: "pointer", background: "#ffffff", borderRadius: "12px", padding: "0.8rem 0.95rem",
                border: active ? `2px solid ${look.color}` : `1px solid ${look.border}`, display: "flex", flexDirection: "column", gap: "6px",
                boxShadow: active ? `0 4px 14px ${look.border}` : "0 1px 3px rgba(0,0,0,0.03)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
                  <span style={{ width: "28px", height: "28px", borderRadius: "8px", background: look.grad, color: "#ffffff",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={15} />
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 800, color: look.color }}>{t.label}</span>
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: look.color, background: look.bg, border: `1px solid ${look.border}`,
                  borderRadius: "999px", padding: "1px 8px" }}>
                  {t.percent}%
                </span>
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.05 }}>{n(t.count)}</div>
              <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                {t.range} in {data?.month_label}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ customers */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "1rem 1.2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
              {tier === "all"
                ? `Customers who ordered in ${data?.month_label ?? "the month"} (${customers.length})`
                : tier === "silver"
                ? `Silver customers · no order in ${data?.month_label ?? "the month"} (${n(data?.tiers.find((t) => t.key === "silver")?.count)})`
                : `${tier[0].toUpperCase()}${tier.slice(1)} customers (${customers.length})`}
            </h3>
            {tier !== "all" && (
              <button type="button" onClick={() => setTier("all")}
                style={{ fontSize: "11.5px", fontWeight: 600, color: "#2563eb", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                Show all
              </button>
            )}
          </div>
          <div style={{ position: "relative", minWidth: "220px" }}>
            <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, area, service..."
              style={{ width: "100%", padding: "6px 10px 6px 30px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", boxSizing: "border-box", outline: "none" }} />
          </div>
        </div>

        {tier === "silver" ? (
          loadingSilver && !silver ? (
            <div style={{ textAlign: "center", padding: "2.5rem", color: "#64748b", fontSize: "13px" }}>
              <RefreshCw size={22} className="spin" style={{ color: "#2563eb", marginBottom: "6px" }} />
              <div>Reading Silver customers from ExtraHand...</div>
            </div>
          ) : !silver?.available ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1.5px dashed #e2e8f0", borderRadius: "12px", background: "#f8fafc", color: "#64748b", fontSize: "13px" }}>
              The Silver list is not available: {silver?.reason || "ExtraHand could not be read."}
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto", opacity: loadingSilver ? 0.55 : 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                      {["Customer", "Category", "Area", "Joined", "Last order", "All-time orders"].map((h) => (
                        <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 700, fontSize: "10.5px", textTransform: "uppercase",
                          textAlign: h === "All-time orders" ? "right" : "left", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {silverRows.map((c) => (
                      <tr key={c.customer_key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.name}</div>
                          {c.phone && <div style={{ fontSize: "11px", color: "#64748b" }}>{c.phone}</div>}
                        </td>
                        <td style={{ padding: "9px 12px" }}><TierBadge tier="silver" /></td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px" }}>{[c.area, c.city].filter(Boolean).join(", ") || "—"}</td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px", whiteSpace: "nowrap" }}>{dateOf(c.joined_at)}</td>
                        <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px", whiteSpace: "nowrap" }}>{c.last_order_at ? dateOf(c.last_order_at) : "Never"}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", color: "#475569" }}>{c.lifetime_orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.8rem", fontSize: "12px", color: "#64748b" }}>
                <span>Newest registrations first · page {silver.page} of {silver.pages}</span>
                <span style={{ display: "inline-flex", gap: "6px" }}>
                  <button type="button" disabled={silverPage <= 1 || loadingSilver} onClick={() => setSilverPage((p) => p - 1)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "5px 10px", borderRadius: "7px", border: "1px solid #cbd5e1",
                      background: "#ffffff", fontSize: "12px", fontWeight: 600, cursor: silverPage <= 1 ? "not-allowed" : "pointer", opacity: silverPage <= 1 ? 0.5 : 1 }}>
                    <ChevronLeft size={13} /> Previous
                  </button>
                  <button type="button" disabled={silverPage >= silver.pages || loadingSilver} onClick={() => setSilverPage((p) => p + 1)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "5px 10px", borderRadius: "7px", border: "1px solid #cbd5e1",
                      background: "#ffffff", fontSize: "12px", fontWeight: 600, cursor: silverPage >= silver.pages ? "not-allowed" : "pointer", opacity: silverPage >= silver.pages ? 0.5 : 1 }}>
                    Next <ChevronRight size={13} />
                  </button>
                </span>
              </div>
            </>
          )
        ) : loading && !data ? (
          <div style={{ textAlign: "center", padding: "2.5rem", color: "#64748b", fontSize: "13px" }}>
            <RefreshCw size={22} className="spin" style={{ color: "#2563eb", marginBottom: "6px" }} />
            <div>Reading customer orders from ExtraHand...</div>
          </div>
        ) : customers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", border: "1.5px dashed #e2e8f0", borderRadius: "12px", background: "#f8fafc", color: "#64748b", fontSize: "13px" }}>
            <Users size={28} style={{ color: "#94a3b8", marginBottom: "6px" }} />
            <div style={{ fontWeight: 700, color: "#1e293b" }}>No customers here</div>
            <div style={{ fontSize: "12px", marginTop: "2px" }}>
              {tier !== "all" ? `No ${tier} customers in ${data?.month_label}.` : `No customer orders in ${data?.month_label}.`}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  {["Customer", "Category", "Orders", "Outcome", "Main service", "Area", "Last order", "Spent", "All-time orders"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 700, fontSize: "10.5px", textTransform: "uppercase",
                      textAlign: ["Orders", "Spent", "All-time orders"].includes(h) ? "right" : "left", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customer_key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.name}</div>
                      {c.phone && <div style={{ fontSize: "11px", color: "#64748b" }}>{c.phone}</div>}
                    </td>
                    <td style={{ padding: "9px 12px" }}><TierBadge tier={c.tier} /></td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 800, color: "#0f172a", fontSize: "13.5px" }}>{c.orders}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontSize: "11.5px" }}>
                      <span title="Completed" style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#15803d", marginRight: "8px" }}>
                        <CheckCircle2 size={12} />{c.completed}
                      </span>
                      <span title="Pending" style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#b45309", marginRight: "8px" }}>
                        <Clock size={12} />{c.pending}
                      </span>
                      <span title="Cancelled" style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#b91c1c" }}>
                        <XCircle size={12} />{c.cancelled}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {c.top_service ? (
                        <span title={c.services.join(", ")} style={{ display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "11px",
                          fontWeight: 650, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #dbeafe" }}>
                          {c.top_service}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px" }}>{[c.area, c.city].filter(Boolean).join(", ") || "—"}</td>
                    <td style={{ padding: "9px 12px", color: "#475569", fontSize: "12px", whiteSpace: "nowrap" }}>{dateOf(c.last_order_at)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                      {c.spent > 0 ? `₹${c.spent.toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#475569" }}>{c.lifetime_orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EngagementCategoriesPage;
