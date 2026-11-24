import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, Inbox, LifeBuoy, Loader2, MessageCircle, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { WsCase } from "../types";
import { Kpi, Skeleton, fmtDate, fmtTime, n } from "./EngagementKit";
import { CASE_STATUS, Kicker, SUPPORT_ROUTES, TestsToggle, ago } from "./SupportShared";

/** Customer Engagement → WhatsApp Support → Support Cases: what the AI handed to the care team (complaints, refund
 * requests, confirmed cancel / reschedule requests, "talk to a person"). They are Customer Care cases: the team works
 * them in Calling Agent → Customer Care Cases. */

type StatusFilter = "active" | "resolved" | "all";

export function SupportCasesPage() {
  const [tests, setTests] = useState(false);
  const data = usePoll<WsCase[]>(() => api.whatsapp.supportCases(tests), 15000, [tests]);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const all = data.data ?? [];
  const cats = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const c of all) {
      const k = c.category ?? "other";
      m.set(k, { label: c.category_label, count: (m.get(k)?.count ?? 0) + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [all]);
  const rows = all.filter((c) =>
    (status === "all" || (status === "resolved" ? c.status === "resolved" : c.status !== "resolved"))
    && (!cat || (c.category ?? "other") === cat)
    && (!q || `${c.customer_name ?? ""} ${c.customer_phone ?? ""} ${c.booking_id ?? ""} ${c.id}`.toLowerCase().includes(q.toLowerCase())));

  if (!data.data) {
    return <div className="cw-page ws-page">{data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading support cases…</>} />}</div>;
  }
  const openCount = all.filter((c) => c.status === "open").length;
  const progress = all.filter((c) => c.status === "in_progress").length;
  const done = all.filter((c) => c.status === "resolved");
  const solved = done.filter((c) => c.outcome !== "rejected").length;

  return (
    <div className="cw-page ws-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <Kicker />
            <h1>Support Cases</h1>
            <p>Everything the AI agent handed to the care team. They are worked in Customer Care Cases, with the same team.</p>
          </div>
          <div className="cw-head-tools">
            <Link className="cw-btn" to="/calling/care"><LifeBuoy size={13} /> Customer Care Cases</Link>
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /></button>
          </div>
        </div>
      </header>

      <div className="ws-kpis four">
        <Kpi lead icon={Inbox} label="Waiting" value={n(openCount)} color="var(--cw-amber)" sub="nobody has taken them yet" />
        <Kpi icon={LifeBuoy} label="Being handled" value={n(progress)} color="var(--ws-team)" sub="a person is on it" />
        <Kpi icon={MessageCircle} label="Done" value={n(done.length)} sub={done.length ? `${n(solved)} solved · ${n(done.length - solved)} not solved` : "none closed yet"} />
        <Kpi icon={Inbox} label="All cases" value={n(all.length)} sub="from WhatsApp Support" />
      </div>

      <section className="cw-card">
        <div className="ws-case-tools">
          <div className="ws-tabs" role="tablist">
            {([["active", "Open"], ["resolved", "Done"], ["all", "All"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
          <div className="ws-chips">
            <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>All types</button>
            {cats.map(([k, v]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(cat === k ? null : k)}>{v.label} <b>{v.count}</b></button>)}
          </div>
          <label className="ws-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, number, booking or case #" /></label>
          <TestsToggle on={tests} set={setTests} />
        </div>

        {rows.length === 0 ? (
          <p className="ws-empty center">No cases here.</p>
        ) : (
          <ul className="ws-case-list">
            {rows.map((c) => (
              <li key={c.id} className={open === c.id ? "open" : ""}>
                <button className="ws-case-row" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                  <span className="ws-case-id">#{c.id}</span>
                  <span className="ws-case-main">
                    <b>{c.category_label}{c.is_test && <em className="ws-tag test">Test</em>}</b>
                    <small>{c.customer_name || "Unknown"} · +{c.customer_phone}{c.booking_id ? ` · booking ${c.booking_id}` : ""}</small>
                  </span>
                  <span className="ws-case-who">{c.assigned_to || <i>Not assigned</i>}</span>
                  <em className={`ws-tag ${c.status === "resolved" && c.outcome === "rejected" ? "bad" : CASE_STATUS[c.status]?.tone}`}>
                    {c.status === "resolved" ? (c.outcome === "rejected" ? "Not solved" : "Solved") : CASE_STATUS[c.status]?.label}
                  </em>
                  <small className="ws-case-age" title={`${fmtDate(c.created_at)} ${fmtTime(c.created_at)}`}>{ago(c.created_at)}</small>
                  <ChevronDown size={15} className="ws-chev" />
                </button>
                <AnimatePresence>
                  {open === c.id && (
                    <motion.div className="ws-case-more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <pre>{c.details}</pre>
                      {c.notes && <p><b>Team notes:</b> {c.notes}</p>}
                      <div className="ws-links">
                        {c.conversation_id && <Link className="cx-link" to={`${SUPPORT_ROUTES.conversations}?c=${c.conversation_id}`}>Open the chat <ArrowRight size={13} /></Link>}
                        <Link className="cx-link" to="/calling/care">Handle in Customer Care Cases <ArrowRight size={13} /></Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
