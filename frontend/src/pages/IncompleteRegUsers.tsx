import { Clock3, HandHeart, Phone, RefreshCw, Search, UserRoundPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote, SkeletonRows } from "../components/ui";
import { usePoll } from "../hooks";
import type { WaIncompleteUsersPage } from "../types";
import { AudienceBadge, fmtCountdown, fmtPhone, fmtWhen, IncompleteStatusPill } from "./incompleteRegShared";
import "./wa-commercials.css";
import "./wa-welcomers.css";

const AUDIENCES = [
  { key: "all", label: "All" },
  { key: "helper", label: "Helpers" },
  { key: "customer", label: "Customers" },
] as const;

const STAGES = [
  { key: "all", label: "All stages" },
  { key: "profile_pending", label: "Helper: Profile / Location pending" },
  { key: "kyc_pending", label: "Helper: KYC pending" },
  { key: "role_pending", label: "Customer: Role not selected" },
  { key: "location_pending", label: "Customer: No location" },
  { key: "name_pending", label: "Customer: Name missing" },
];

const STATUSES = [
  { key: "all", label: "All statuses" },
  { key: "waiting_5h", label: "Waiting (5h)" },
  { key: "ready", label: "Ready (>5h)" },
  { key: "old_skipped", label: "Before activation (ignored)" },
  { key: "not_targeted", label: "Location added (not messaged)" },
  { key: "sent", label: "Sent" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
  { key: "no_phone", label: "No phone" },
];

export function IncompleteRegUsers() {
  const [audience, setAudience] = useState<"all" | "helper" | "customer">("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const LIMIT = 50;

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => setOffset(0), [audience, stage, status, q]);

  const data = usePoll<WaIncompleteUsersPage>(
    () => api.whatsapp.incompleteRegUsers({ audience, stage, status, q, offset, limit: LIMIT }),
    30000,
    [audience, stage, status, q, offset],
  );
  const r = data.data;

  const forceRefresh = async () => {
    setRefreshing(true);
    try {
      await api.whatsapp.incompleteRegUsers({ audience, stage, status, q, offset, limit: LIMIT, refresh: true });
      data.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="wx-page">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Users size={13} /> Customer Engagement · Incomplete Register</span>
            <h1>Incomplete Helpers &amp; Customers</h1>
            <p className="wwl-sub">
              Every real Helper and Customer who stopped registration midway. Reminders go only to registered helpers and customers who have not added their location, who signed up after the automation was activated, 5 hours after signup. Everyone else is left out.
            </p>
          </div>
          <div className="wx-banner-tools">
            <button type="button" className="wx-ghost wx-square" onClick={forceRefresh} disabled={refreshing} title="Re-scan ExtraHand" aria-label="Refresh">
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </div>
        {r && (
          <div className="wx-figures wwl-figures">
            <div><span>Total shown</span><b>{(r.counts.all ?? 0).toLocaleString("en-IN")}</b><em>{r.counts.helper ?? 0} helpers · {r.counts.customer ?? 0} customers</em></div>
            <div><span>Ready (&gt;5h)</span><b>{(r.counts.ready ?? 0).toLocaleString("en-IN")}</b><em>eligible to message</em></div>
            <div><span>Waiting (5h)</span><b>{(r.counts.waiting_5h ?? 0).toLocaleString("en-IN")}</b><em>grace window · {(r.counts.old_skipped ?? 0).toLocaleString("en-IN")} old ignored</em></div>
            <div><span>Messaged</span><b>{(r.counts.sent ?? 0).toLocaleString("en-IN")}</b><em>{r.counts.read ?? 0} read · {r.counts.failed ?? 0} failed</em></div>
          </div>
        )}
      </header>

      <ErrorNote error={data.error || r?.error} />

      <section className="wx-sheet">
        <div className="wwl-people-tools">
          <div className="wwl-people-row">
            <div className="wwl-seg" role="tablist" aria-label="Audience">
              {AUDIENCES.map((a) => (
                <button key={a.key} type="button" className={audience === a.key ? "on" : ""} onClick={() => setAudience(a.key)}>
                  {a.key === "helper" && <HandHeart size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                  {a.key === "customer" && <UserRoundPlus size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                  {a.label}
                </button>
              ))}
            </div>

            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filter by stage"
              style={{ height: "34px", padding: "0 10px", borderRadius: "999px", border: "1px solid var(--wx-rule)", background: "var(--surface)", color: "var(--text)", fontSize: "12.5px" }}
            >
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>

            <div className="wwl-search">
              <Search size={14} />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search name, phone, city, user id…" />
            </div>
          </div>

          <div className="wwl-filters">
            {STATUSES.map((s) => (
              <button key={s.key} type="button" className={status === s.key ? "on" : ""} onClick={() => setStatus(s.key)}>
                {s.label} {r?.counts[s.key] !== undefined && <span>{r.counts[s.key]}</span>}
              </button>
            ))}
          </div>
        </div>

        {!r ? (
          <SkeletonRows rows={8} />
        ) : r.loading && r.items.length === 0 ? (
          <p className="wx-empty"><RefreshCw size={14} className="spin" /> Scanning ExtraHand registrations…</p>
        ) : r.items.length === 0 ? (
          <p className="wx-empty">No incomplete users match this filter.</p>
        ) : (
          <>
            <div className="wwl-table-wrap">
              <table className="wx-ledger">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Incomplete Stage</th>
                    <th>City</th>
                    <th>Signed up</th>
                    <th>5h Timer</th>
                    <th>WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((u) => (
                    <tr key={`${u.audience}-${u.user_id}`}>
                      <td>
                        <b>{u.name || "Unnamed"}</b>
                        <div className="wwl-person-meta">
                          <Phone size={11} /> {fmtPhone(u.phone)}
                        </div>
                      </td>
                      <td><AudienceBadge audience={u.audience} /></td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: "12.5px" }}>{u.stage_label}</div>
                        <small style={{ color: "var(--muted)", fontSize: "11px" }}>Missing: {u.missing.join(", ")}</small>
                      </td>
                      <td>{u.city || "No location"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(u.registered_at)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {u.msg_status === "waiting_5h" ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#d97706", fontSize: "12px", fontWeight: 600 }}>
                            <Clock3 size={12} /> {fmtCountdown(u.remaining_seconds)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "12px" }}>&gt; 5h elapsed</span>
                        )}
                      </td>
                      <td>
                        <IncompleteStatusPill status={u.msg_status} />
                        {u.error && <div style={{ color: "var(--danger)", fontSize: "11px", maxWidth: "180px" }}>{u.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="wwl-pager">
              <span>Showing {offset + 1}–{Math.min(offset + r.items.length, r.total)} of {r.total.toLocaleString("en-IN")}</span>
              <button type="button" className="wsm-page-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                Previous
              </button>
              <button type="button" className="wsm-page-btn" disabled={offset + r.items.length >= r.total} onClick={() => setOffset(offset + LIMIT)}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
