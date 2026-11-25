import { AlertTriangle, Inbox, Phone, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNote, SkeletonRows } from "../components/ui";
import { usePoll } from "../hooks";
import type { WaIncompleteHistoryPage } from "../types";
import { AudienceBadge, fmtPhone, fmtWhen, IncompleteStatusPill } from "./incompleteRegShared";
import "./wa-commercials.css";
import "./wa-welcomers.css";

const AUDIENCES = [
  { key: "all", label: "All" },
  { key: "helper", label: "Helpers" },
  { key: "customer", label: "Customers" },
] as const;

const STATUSES = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
  { key: "simulated", label: "Simulated" },
];

export function IncompleteRegHistory() {
  const [audience, setAudience] = useState<"all" | "helper" | "customer">("all");
  const [status, setStatus] = useState("all");
  const [includeTests, setIncludeTests] = useState(false);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => setOffset(0), [audience, status, includeTests, q]);

  const data = usePoll<WaIncompleteHistoryPage>(
    () => api.whatsapp.incompleteRegHistory({ audience, status, include_tests: includeTests, q, offset, limit: LIMIT }),
    15000,
    [audience, status, includeTests, q, offset],
  );
  const r = data.data;

  const webhookStale = r?.last_sent_at && (!r.webhook_last_seen || new Date(r.webhook_last_seen) < new Date(r.last_sent_at));

  return (
    <div className="wx-page">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Inbox size={13} /> Customer Engagement · Incomplete Register</span>
            <h1>Message History</h1>
            <p className="wwl-sub">
              Every WhatsApp reminder dispatched to incomplete helpers and customers, with live Meta delivery and read status.
            </p>
          </div>
          <div className="wx-banner-tools">
            <button type="button" className="wx-ghost wx-square" onClick={data.refresh} title="Refresh" aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        {r && (
          <div className="wx-figures wwl-figures">
            <div><span>Total sent</span><b>{r.counts.sent.toLocaleString("en-IN")}</b><em>{r.counts.helper} helpers · {r.counts.customer} customers</em></div>
            <div><span>Delivered</span><b>{r.counts.delivered.toLocaleString("en-IN")}</b><em>{r.counts.sent ? `${Math.round((r.counts.delivered / r.counts.sent) * 100)}% of sent` : "—"}</em></div>
            <div><span>Read</span><b>{r.counts.read.toLocaleString("en-IN")}</b><em>{r.counts.delivered ? `${Math.round((r.counts.read / r.counts.delivered) * 100)}% of delivered` : "—"}</em></div>
            <div><span>Failed / Sim</span><b>{r.counts.failed + r.counts.simulated}</b><em>{r.counts.failed} failed · {r.counts.simulated} simulated</em></div>
          </div>
        )}
      </header>

      <ErrorNote error={data.error} />

      {webhookStale && (
        <div className="wd-warn" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AlertTriangle size={15} />
          <span>Meta delivery/read webhooks have not reached this server since the latest send, so statuses stay “Sent” until Meta calls `/api/whatsapp/webhook`.</span>
        </div>
      )}

      <section className="wx-sheet">
        <div className="wwl-people-tools">
          <div className="wwl-people-row">
            <div className="wwl-seg" role="tablist" aria-label="Audience">
              {AUDIENCES.map((a) => (
                <button key={a.key} type="button" className={audience === a.key ? "on" : ""} onClick={() => setAudience(a.key)}>
                  {a.label}
                </button>
              ))}
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={includeTests} onChange={(e) => setIncludeTests(e.target.checked)} />
              Include test sends
            </label>

            <div className="wwl-search">
              <Search size={14} />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search name, phone, city, user id…" />
            </div>
          </div>

          <div className="wwl-filters">
            {STATUSES.map((s) => (
              <button key={s.key} type="button" className={status === s.key ? "on" : ""} onClick={() => setStatus(s.key)}>
                {s.label} {r && s.key in r.counts && <span>{r.counts[s.key as keyof typeof r.counts]}</span>}
              </button>
            ))}
          </div>
        </div>

        {!r ? (
          <SkeletonRows rows={8} />
        ) : r.items.length === 0 ? (
          <p className="wx-empty">No incomplete registration messages sent yet.</p>
        ) : (
          <>
            <div className="wwl-table-wrap">
              <table className="wx-ledger">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Role</th>
                    <th>Stage</th>
                    <th>Template</th>
                    <th>Sent at</th>
                    <th>Delivered / Read</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <b>{m.name || "Unnamed"}</b> {m.is_test && <span className="wwl-chip wwl-t-off" style={{ marginLeft: "4px" }}>TEST</span>}
                        <div className="wwl-person-meta">
                          <Phone size={11} /> {fmtPhone(m.phone)} {m.city ? `· ${m.city}` : ""}
                        </div>
                      </td>
                      <td><AudienceBadge audience={m.audience} /></td>
                      <td>{m.stage_label || "—"}</td>
                      <td><code style={{ fontSize: "11.5px" }}>{m.template || "—"}</code></td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(m.sent_at)}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted)" }}>
                        {m.read_at ? `Read ${fmtWhen(m.read_at)}` : m.delivered_at ? `Delivered ${fmtWhen(m.delivered_at)}` : "—"}
                      </td>
                      <td>
                        <IncompleteStatusPill status={m.status} />
                        {m.error && <div style={{ color: "var(--danger)", fontSize: "11px", maxWidth: "200px" }}>{m.error}</div>}
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
