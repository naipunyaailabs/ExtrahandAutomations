import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  Clock,
  Flag,
  Hash,
  Headset,
  Keyboard,
  PhoneCall,
  PhoneOff,
  PhoneOutgoing,
  Ticket as TicketIcon,
  Timer,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Card, Empty, ErrorNote, Pill, SkeletonRows } from "../components/ui";
import { usePoll, useGoBack } from "../hooks";
import { callKind, fmtDateTime, fmtDuration, fmtTime, humanize } from "../format";
import type { CallDetail, TimelineEvent } from "../types";

type Tone = "success" | "warn" | "danger" | "info" | "neutral";
interface Row { t: string; icon: LucideIcon; tone: Tone; title: string; detail?: string }

/** One line of the trail in words an operator would use. */
function describe(e: TimelineEvent, call: CallDetail): Omit<Row, "t"> {
  const d = e.detail;
  switch (e.event) {
    case "placed": return { icon: PhoneOutgoing, tone: "neutral", title: "Call placed", detail: `to ${call.phone ?? "unknown number"} through ${call.provider}` };
    case "answered": return { icon: PhoneCall, tone: "success", title: "Answered" };
    case "prompt": return { icon: Volume2, tone: "info", title: `Message played${d ? ` (${d})` : ""}` };
    case "key": return { icon: Keyboard, tone: d?.includes("not an option") ? "warn" : "info", title: `Pressed key ${d ?? ""}`.trim() };
    case "silence": return { icon: Timer, tone: "warn", title: "No key pressed in time" };
    case "handoff_started": return { icon: ArrowRightLeft, tone: "info", title: "Call handed to Maya" };
    case "handoff_connected": return { icon: Headset, tone: "success", title: "Maya joined the call" };
    case "handoff_result": return { icon: Bot, tone: "success", title: `Maya recorded: ${humanize(d)}` };
    case "handoff_failed": return { icon: PhoneOff, tone: "danger", title: "Maya could not be reached", detail: d ? `The phone line said: ${d}` : undefined };
    case "outcome": return { icon: Flag, tone: d === "accepted" || d === "confirmed" ? "success" : d === "no_input" || d === "hung_up" || d === "no_answer" || d === "busy" ? "warn" : "info", title: `Result: ${humanize(d)}` };
    case "hangup": return { icon: PhoneOff, tone: "neutral", title: "Call ended", detail: d };
    default: return { icon: Clock, tone: "neutral", title: humanize(e.event), detail: d };
  }
}

function rowsOf(call: CallDetail): Row[] {
  const events = [{ t: call.created_at, event: "placed" } as TimelineEvent, ...call.timeline];
  return events.map((e) => ({ t: e.t, ...describe(e, call) }));
}

const secondsBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

/** "[Maya]: text", "[Helper]: text" or "assistant: text", "user: text" lines into chat turns. */
function turns(transcript: string, caller: string) {
  return transcript.split(/\r?\n/).filter(Boolean).map((line) => {
    const m = line.match(/^\s*(?:\[([^\]]+)\]|(assistant|user|system)):\s*(.*)$/i);
    if (!m) return { who: "", mine: false, text: line };
    const raw = (m[1] ?? m[2]).toLowerCase();
    const maya = raw === "maya" || raw === "assistant";
    return { who: maya ? "Maya" : caller, mine: maya, text: m[3] };
  });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="vx-stat">
      <span className="vx-stat-label">{label}</span>
      <b className="tabular">{value}</b>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

export default function CallDetailPage() {
  const goBack = useGoBack("/calling/history");
  const { id } = useParams();
  const callId = Number(id);
  const { data: call, error } = usePoll<CallDetail>(() => api.callDetail(callId), 3000, [callId]);

  if (!call) {
    return (
      <Stagger className="page">
        <a href="/calling/history" className="vx-back" onClick={(e) => { e.preventDefault(); goBack(); }}><ArrowLeft size={14} /> Back</a>
        {error ? <ErrorNote error={error} /> : <Card><SkeletonRows rows={5} /></Card>}
      </Stagger>
    );
  }

  const rows = rowsOf(call);
  const who = call.purpose === "feedback" ? "customer" : "helper";
  const person = (call.purpose === "feedback" ? call.customer_name : call.helper_name) ?? "Unknown";
  const rang = call.answered_at ? secondsBetween(call.created_at, call.answered_at) : null;
  const talk = call.duration_seconds ?? (call.answered_at && call.ended_at ? secondsBetween(call.answered_at, call.ended_at) : null);
  const chat = call.transcript ? turns(call.transcript, who === "customer" ? "Customer" : "Helper") : [];
  const h = call.handoff;

  return (
    <Stagger className="page">
      <a href="/calling/history" className="vx-back" onClick={(e) => { e.preventDefault(); goBack(); }}><ArrowLeft size={14} /> Back</a>

      <motion.div className="page-head vx-call-head" variants={itemVariants}>
        <div>
          <h1>{callKind(call.purpose)} to {person}</h1>
          <p className="muted">
            {fmtDateTime(call.created_at)} · <span className="mono">{call.phone ?? "no number"}</span>
            {call.followup && ` · reminder ${call.followup.offset_minutes} min before the job${call.followup.retry_of ? " (second try)" : ""}`}
          </p>
        </div>
        <div className="vx-call-pills">
          <Pill value={call.status} />
          {call.outcome && <Pill value={call.outcome} />}
        </div>
      </motion.div>

      <ErrorNote error={call.error} />

      <motion.div className="vx-stats" variants={itemVariants}>
        <Stat label="Keys pressed" value={call.digits || "none"} />
        <Stat label="Message played" value={`${call.prompts_played}×`} />
        <Stat label="Rang for" value={rang == null ? "not answered" : fmtDuration(rang)} />
        <Stat label="Talk time" value={talk == null ? "—" : fmtDuration(talk)} hint={call.status !== "ended" ? "still going" : undefined} />
      </motion.div>

      <div className="vx-split">
        <Card title="What happened" icon={Clock}>
          <ol className="vx-timeline">
            {rows.map((r, i) => (
              <li key={i} className={`vx-tl vx-tl-${r.tone}`}>
                <span className="vx-tl-dot"><r.icon size={13} /></span>
                <div className="vx-tl-body">
                  <b>{r.title}</b>
                  {r.detail && <span className="muted small">{r.detail}</span>}
                </div>
                <span className="vx-tl-time tabular" title={fmtDateTime(r.t)}>
                  {fmtTime(r.t)}
                  <em>{i === 0 ? "" : `+${secondsBetween(rows[0].t, r.t).toFixed(1)}s`}</em>
                </span>
              </li>
            ))}
          </ol>
          {call.status !== "ended" && <p className="muted small vx-foot">This updates every few seconds while the call is live.</p>}
        </Card>

        <div className="vx-stack">
          {(h || chat.length > 0) && (
            <Card title="Maya" icon={Bot}>
              {h && (
                <dl className="vx-facts">
                  {h.decision && <div><dt>Said</dt><dd>{humanize(h.decision)}</dd></div>}
                  {h.complaint_category && <div><dt>Complaint</dt><dd>{humanize(h.complaint_category)}</dd></div>}
                  {h.reason && <div><dt>Reason</dt><dd>{h.reason}</dd></div>}
                  {h.eta_minutes != null && <div><dt>Arriving in</dt><dd>{h.eta_minutes} min</dd></div>}
                  {h.details && <div><dt>Details</dt><dd>{h.details}</dd></div>}
                </dl>
              )}
              {call.summary && <p className="vx-summary">{call.summary}</p>}
              {chat.length > 0 && (
                <ul className="vx-chat" aria-label="Conversation with Maya">
                  {chat.map((t, i) => (
                    <li key={i} className={t.mine ? "maya" : "them"}>
                      {t.who && <span>{t.who}</span>}
                      <p lang="te">{t.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {call.script && (
            <Card title="Message played" icon={Volume2}>
              <p className="vx-say" lang="te">{call.script}</p>
            </Card>
          )}

          {call.ticket ? (
            <Card title="Ticket" icon={TicketIcon}>
              <dl className="vx-facts">
                <div><dt>Job</dt><dd><Link to={`/tickets/${encodeURIComponent(call.ticket.id)}`}>{call.ticket.title ?? call.ticket.id}</Link></dd></div>
                <div><dt>Service</dt><dd>{call.ticket.category ?? "—"}</dd></div>
                <div><dt>Where</dt><dd>{call.ticket.address ?? call.ticket.city ?? "—"}</dd></div>
                <div><dt>When</dt><dd>{fmtDateTime(call.ticket.scheduled_at)}</dd></div>
                <div><dt>Status</dt><dd><Pill value={call.ticket.dispatch_status} /></dd></div>
              </dl>
            </Card>
          ) : <Empty icon={TicketIcon}>This call's ticket is no longer on file.</Empty>}

          <Card title="Technical details" icon={Hash}>
            <dl className="vx-facts vx-facts-mono">
              <div><dt>Call number</dt><dd className="mono">{call.id}</dd></div>
              <div><dt>Provider</dt><dd className="mono">{call.provider}</dd></div>
              <div><dt>Provider call id</dt><dd className="mono">{call.provider_call_id ?? "—"}</dd></div>
              <div><dt>Language</dt><dd className="mono">{call.language ?? "—"}</dd></div>
              {call.run_id != null && <div><dt>Dispatch run</dt><dd className="mono">{call.run_id}</dd></div>}
            </dl>
          </Card>
        </div>
      </div>
    </Stagger>
  );
}
