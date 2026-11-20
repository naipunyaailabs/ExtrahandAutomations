import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, History, PhoneCall, PhoneOff, Search } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { LiveCalls } from "../components/LiveCalls";
import { itemVariants, Stagger } from "../components/motion";
import { Card, Empty, Pill, SkeletonRows } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import { callKind, fmtDateTime, fmtDuration } from "../format";
import type { Call } from "../types";

function talkTime(c: Call) {
  if (c.duration_seconds) return fmtDuration(c.duration_seconds);
  if (!c.answered_at || !c.ended_at) return "—";
  return fmtDuration((new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000);
}

const KINDS = [
  { key: "", label: "All" },
  { key: "dispatch", label: "Task offers" },
  { key: "followup", label: "Reminders" },
  { key: "feedback", label: "Ratings" },
];
const RESULTS = [
  { key: "", label: "Any result" },
  { key: "answered", label: "Answered" },
  { key: "unanswered", label: "Not answered" },
  { key: "maya", label: "Handed to Maya" },
  { key: "failed", label: "Failed" },
];

function matchesResult(c: Call, result: string) {
  switch (result) {
    case "answered": return !!c.answered_at;
    case "unanswered": return c.status === "ended" && !c.answered_at;
    case "maya": return !!c.handoff || c.status === "handoff";
    case "failed": return c.outcome === "failed" || !!c.error;
    default: return true;
  }
}

export default function Calls() {
  const config = useConfig()!;
  const { data, refresh } = usePoll(() => api.calls(300), 2000);
  // Filters live in the URL so a reload keeps them
  const [kind, setKind] = useUrlState<string>("kind", "");
  const [result, setResult] = useUrlState<string>("result", "");
  const [query, setQuery] = useUrlState<string>("q", "");
  const active = (data ?? []).filter((c) => c.status !== "ended");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((c) =>
      (!kind || c.purpose === kind) &&
      matchesResult(c, result) &&
      (!q || [c.helper_name, c.customer_name, c.phone, c.ticket_title, c.ticket_id].some((v) => v?.toLowerCase().includes(q))));
  }, [data, kind, result, query]);

  return (
    <Stagger className="page">
      <motion.div className="page-head" variants={itemVariants}>
        <h1>Call history</h1>
        <p className="muted">
          The agent reads out the task and the payment. The helper presses <b>1</b> to accept or <b>2</b> to reject.
          With no key pressed the message repeats, up to {config.ivr_max_prompts} times, then the agent hangs up and calls the next helper.
          Open a call to see exactly what happened on it.
        </p>
      </motion.div>

      <Card title="Live" icon={PhoneCall}>
        {data ? <LiveCalls calls={active} maxPrompts={config.ivr_max_prompts} onChange={refresh} empty="No live calls." /> : <SkeletonRows rows={2} />}
      </Card>

      <Card title="Call log" icon={History} flat>
        <div className="vx-filters">
          <div className="vx-seg" role="tablist" aria-label="Kind of call">
            {KINDS.map((k) => (
              <button key={k.key} role="tab" aria-selected={kind === k.key} className={kind === k.key ? "on" : ""} onClick={() => setKind(k.key)}>{k.label}</button>
            ))}
          </div>
          <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result" className="vx-filter-select">
            {RESULTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <label className="vx-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number or ticket" aria-label="Search calls" />
          </label>
        </div>

        {!data ? <SkeletonRows /> : shown.length ? (
          <div className="table-wrap inner">
            <table className="table responsive">
              <thead>
                <tr><th>Time</th><th>Type</th><th>Who</th><th>Ticket</th><th>Plays</th><th>Keys</th><th>Talk time</th><th>Result</th><th aria-label="Open" /></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {shown.map((c) => (
                    <motion.tr key={c.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                      <td data-label="Time" className="nowrap"><Link to={`/calls/${c.id}`}>{fmtDateTime(c.created_at)}</Link></td>
                      <td data-label="Type">{callKind(c.purpose)}</td>
                      <td data-label="Who">{(c.purpose === "feedback" ? c.customer_name : c.helper_name) ?? "—"}<div className="small muted mono">{c.phone}</div></td>
                      <td data-label="Ticket"><Link to={`/tickets/${encodeURIComponent(c.ticket_id)}`}>{c.ticket_title ?? c.ticket_id}</Link></td>
                      <td data-label="Plays">{c.prompts_played}</td>
                      <td data-label="Keys" className="mono">{c.digits || "—"}</td>
                      <td data-label="Talk time" className="tabular">{talkTime(c)}</td>
                      <td data-label="Result"><Pill value={c.outcome ?? c.status} />{c.handoff && <span className="small muted"> · Maya</span>}{c.summary && <div className="small muted">{c.summary}</div>}{c.error && <div className="small error-inline">{c.error}</div>}</td>
                      <td data-label="" className="vx-open"><Link to={`/calls/${c.id}`} aria-label={`Open call ${c.id}`}><ChevronRight size={16} /></Link></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        ) : <Empty icon={PhoneOff}>{data.length ? "No calls match these filters." : "No calls yet."}</Empty>}
      </Card>
    </Stagger>
  );
}
