import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, ChevronRight, PhoneOutgoing, Search, TicketX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Empty, Phone, Pill, SkeletonRows, Tabs, useToastAction } from "../components/ui";
import { usePoll } from "../hooks";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import type { Ticket } from "../types";

const TABS = [
  { key: "", label: "All" },
  { key: "new", label: "Unassigned" },
  { key: "dispatching", label: "Calling" },
  { key: "assigned", label: "Assigned" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "escalated", label: "Customer care" },
  { key: "closed", label: "All Closed" },
];

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const [q, setQ] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const { data, refresh } = usePoll(() => api.tickets({ q, order: sortOrder }), 4000, [q, sortOrder]);
  const action = useToastAction();
  const navigate = useNavigate();

  const counts: Record<string, number> = {};
  for (const t of data ?? []) {
    counts[t.dispatch_status] = (counts[t.dispatch_status] ?? 0) + 1;
    if (t.status === "completed") counts["completed"] = (counts["completed"] ?? 0) + 1;
    if (t.status === "cancelled") counts["cancelled"] = (counts["cancelled"] ?? 0) + 1;
  }

  const rows = useMemo(() => {
    const list = (data ?? []).filter((t) => {
      if (!status) return true;
      if (status === "completed") return t.status === "completed";
      if (status === "cancelled") return t.status === "cancelled";
      return t.dispatch_status === status;
    });
    return [...list].sort((a, b) => {
      const timeA = a.scheduled_at
        ? new Date(a.scheduled_at).getTime()
        : a.created_at
        ? new Date(a.created_at).getTime()
        : 0;
      const timeB = b.scheduled_at
        ? new Date(b.scheduled_at).getTime()
        : b.created_at
        ? new Date(b.created_at).getTime()
        : 0;
      return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [data, status, sortOrder]);

  const dispatch = (t: Ticket) => action.run(async () => { await api.dispatch(t.id); await refresh(); });
  const open = (t: Ticket) => navigate(`/tickets/${encodeURIComponent(t.id)}`);

  return (
    <Stagger className="page">
      <motion.div className="page-head row" variants={itemVariants}>
        <div>
          <h1>Tickets</h1>
          <p className="muted">Team-posted works synced from ExtraHand ({rows.length} {sortOrder === "desc" ? "latest first" : "oldest first"}).</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn ghost"
            style={{
              fontSize: "12px",
              padding: "7px 12px",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
            }}
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            title={`Currently showing ${sortOrder === "desc" ? "Latest first (newest to oldest)" : "Oldest first"}. Click to toggle.`}
          >
            <ArrowUpDown size={14} style={{ color: "var(--brand)" }} />
            <span>{sortOrder === "desc" ? "Latest first" : "Oldest first"}</span>
          </button>
          <label className="search">
            <Search size={15} className="search-icon" />
            <input placeholder="Search ticket, customer, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Tabs value={status} onChange={(k) => setParams(k ? { status: k } : {})}
          items={TABS.map((t) => ({ ...t, count: t.key ? counts[t.key] ?? 0 : data?.length ?? 0 }))} />
      </motion.div>

      <motion.div className="table-wrap" variants={itemVariants}>
        {!data ? <div className="card-body"><SkeletonRows /></div> : (
          <table className="table responsive">
            <thead>
              <tr>
                <th>Booking</th><th>Customer</th><th>Location</th><th>Scheduled</th><th className="num">Amount</th>
                <th>Helper</th><th>Status</th><th />
              </tr>
            </thead>
            <Stagger as="tbody">
              <AnimatePresence initial={false}>
                {rows.map((t) => (
                  <motion.tr key={t.id} variants={itemVariants} exit="exit" layout="position" className="clickable"
                    onClick={() => open(t)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(t)}>
                    <td data-label="Booking">
                      <div className="strong">{t.title ?? "Untitled"}</div>
                      <div className="small muted"><span className="mono">{t.id}</span> · {t.category ?? "—"}</div>
                    </td>
                    <td data-label="Customer">
                      <div>{t.customer.name ?? "—"}</div>
                      <div className="small"><Phone value={t.customer.phone} /></div>
                    </td>
                    <td data-label="Location">
                      <div className="truncate" title={t.address ?? ""}>{t.address ?? "—"}</div>
                      <div className="small muted">{t.city}</div>
                    </td>
                    <td data-label="Scheduled">
                      {t.scheduled_at ? (
                        <>
                          <div className="nowrap">{fmtDateTime(t.scheduled_at)}</div>
                          <div className="small muted">{fmtRelative(t.scheduled_at)}</div>
                        </>
                      ) : (
                        <>
                          <div><span className="badge-flexible">Flexible</span></div>
                          <div className="small muted">Coordinate on call</div>
                        </>
                      )}
                    </td>
                    <td data-label="Amount" className="num">
                      {t.budget && t.budget > 0 ? (
                        fmtMoney(t.budget)
                      ) : (
                        <span className="badge-negotiable">Negotiable</span>
                      )}
                    </td>
                    <td data-label="Helper">
                      {t.assignee ? (
                        <>
                          <div>{t.assignee.name}</div>
                          <div className="small muted">{t.assigned_via === "whatsapp" ? "accepted on WhatsApp" : t.assignment_local_only ? "accepted on our call" : t.assignee.phone}</div>
                        </>
                      ) : t.active_call ? (
                        <div className="small calling-now"><span className="live-dot" /> Calling {t.active_call.helper_name}… ({t.last_run?.progress})</div>
                      ) : (
                        <span className="muted">Not assigned</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <Pill value={t.dispatch_status} label={t.dispatch_status === "escalated" ? "customer care" : undefined} />
                      {t.status && <div className="small muted">ExtraHand: {t.status}</div>}
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {t.dispatch_status === "new" && (
                        <Button size="sm" variant="primary" icon={PhoneOutgoing} disabled={action.busy} onClick={() => dispatch(t)}>
                          Call helpers
                        </Button>
                      )}
                      {t.dispatch_status === "escalated" && <Link className="btn btn-secondary btn-sm" to="/customer-care">Open</Link>}
                      <ChevronRight size={16} className="row-chevron" />
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </Stagger>
          </table>
        )}
        {data && !rows.length && <Empty icon={TicketX}>No tickets here.</Empty>}
      </motion.div>
    </Stagger>
  );
}
