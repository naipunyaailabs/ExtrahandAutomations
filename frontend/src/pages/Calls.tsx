import { AnimatePresence, motion } from "framer-motion";
import { History, PhoneCall, PhoneOff } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { LiveCalls } from "../components/LiveCalls";
import { itemVariants, Stagger } from "../components/motion";
import { Card, Empty, Pill, SkeletonRows } from "../components/ui";
import { usePoll } from "../hooks";
import { fmtDateTime } from "../format";
import type { Call } from "../types";

function duration(c: Call) {
  if (!c.answered_at || !c.ended_at) return "—";
  const s = Math.round((new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Calls() {
  const config = useConfig()!;
  const { data, refresh } = usePoll(() => api.calls(), 2000);
  const active = (data ?? []).filter((c) => c.status !== "ended");

  return (
    <Stagger className="page">
      <motion.div className="page-head" variants={itemVariants}>
        <h1>Call history</h1>
        <p className="muted">
          The agent reads out the task and the payment. The helper presses <b>1</b> to accept or <b>2</b> to reject.
          With no key pressed the message repeats, up to {config.ivr_max_prompts} times, then the agent hangs up and calls the next helper.
        </p>
      </motion.div>

      <Card title="Live" icon={PhoneCall}>
        {data ? <LiveCalls calls={active} maxPrompts={config.ivr_max_prompts} onChange={refresh} empty="No live calls." /> : <SkeletonRows rows={2} />}
      </Card>

      <Card title="Call log" icon={History} flat>
        {!data ? <SkeletonRows /> : data.length ? (
          <div className="table-wrap inner">
            <table className="table responsive">
              <thead>
                <tr><th>Time</th><th>Type</th><th>Helper</th><th>Ticket</th><th>Plays</th><th>Keys</th><th>Talk time</th><th>Result</th></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {data.map((c) => (
                    <motion.tr key={c.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                      <td data-label="Time" className="nowrap">{fmtDateTime(c.created_at)}</td>
                      <td data-label="Type">{c.purpose === "dispatch" ? "Task offer" : "Reminder"}</td>
                      <td data-label="Helper">{c.helper_name}<div className="small muted mono">{c.phone}</div></td>
                      <td data-label="Ticket"><Link to={`/tickets/${encodeURIComponent(c.ticket_id)}`}>{c.ticket_title ?? c.ticket_id}</Link></td>
                      <td data-label="Plays">{c.prompts_played}</td>
                      <td data-label="Keys" className="mono">{c.digits || "—"}</td>
                      <td data-label="Talk time" className="tabular">{duration(c)}</td>
                      <td data-label="Result"><Pill value={c.outcome ?? c.status} />{c.error && <div className="small error-inline">{c.error}</div>}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        ) : <Empty icon={PhoneOff}>No calls yet.</Empty>}
      </Card>
    </Stagger>
  );
}
