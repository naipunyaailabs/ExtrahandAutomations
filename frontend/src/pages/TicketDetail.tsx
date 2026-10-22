import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing, Check, ChevronDown, ClipboardList, Code2, ExternalLink, History, Hourglass, LifeBuoy, MapPin, PhoneCall,
  PhoneOff, PhoneOutgoing, Square, UserRound, Users, X,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { LiveCalls } from "../components/LiveCalls";
import { itemVariants, Stagger } from "../components/motion";
import { Timeline } from "../components/Timeline";
import { Avatar, Button, Card, Empty, ErrorNote, Field, Phone, Pill, SkeletonPage, toneOf, useToastAction } from "../components/ui";
import { usePoll } from "../hooks";
import { fmtDateTime, fmtMoney, fmtOffset, fmtRelative, fmtTime, humanize } from "../format";
import type { Call, DispatchRun } from "../types";

export default function TicketDetail() {
  const { id = "" } = useParams();
  const config = useConfig()!;
  const { data: t, error, refresh } = usePoll(() => api.ticket(id), 2500, [id]);
  const action = useToastAction();
  const [showRaw, setShowRaw] = useState(false);

  if (!t) return error ? <div className="page"><ErrorNote error={error} /></div> : <SkeletonPage />;

  const activeCalls = t.calls.filter((c) => c.status !== "ended").map((c) => ({ ...c, ticket_title: t.title ?? undefined }));
  const running = t.runs.find((r) => r.status === "running");

  return (
    <Stagger className="page">
      <motion.div variants={itemVariants}>
        <div className="crumbs"><Link to="/tickets">Tickets</Link> / <span className="mono">{t.id}</span></div>
        <div className="page-head row">
          <div>
            <h1>{t.title ?? "Untitled booking"}</h1>
            <div className="head-meta">
              <Pill value={t.dispatch_status} label={t.dispatch_status === "escalated" ? "customer care" : undefined} />
              <span className="muted">ExtraHand: {t.status ?? "—"}</span>
              <span className="muted">Synced {fmtRelative(t.synced_at)}</span>
            </div>
          </div>
          <div className="actions">
            {t.dispatch_status === "new" && (
              <Button variant="primary" icon={PhoneOutgoing} loading={action.busy}
                onClick={() => action.run(async () => { await api.dispatch(t.id); await refresh(); })}>
                Call helpers
              </Button>
            )}
            {running && (
              <Button variant="danger" icon={Square} disabled={action.busy}
                onClick={() => action.run(async () => { await api.cancelDispatch(t.id); await refresh(); }, "Calling stopped")}>
                Stop calling
              </Button>
            )}
            {t.dispatch_status === "escalated" && <Link className="btn btn-secondary btn-md" to="/customer-care"><LifeBuoy size={15} />Open in customer care</Link>}
          </div>
        </div>
      </motion.div>

      <div className="grid-3">
        <Card title="Booking" icon={ClipboardList}>
          <dl className="fields">
            <Field label="Service">{t.category ?? "—"}</Field>
            <Field label="Scheduled">
              {t.scheduled_at ? (
                <>
                  {fmtDateTime(t.scheduled_at)}{" "}
                  <span className="muted small">({fmtRelative(t.scheduled_at)})</span>
                </>
              ) : (
                <span className="badge-flexible">Flexible timing (coordinate on call)</span>
              )}
            </Field>
            <Field label="Amount">
              <span className="amount">
                {t.budget && t.budget > 0 ? (
                  fmtMoney(t.budget)
                ) : (
                  <span className="badge-negotiable">Negotiable / Open</span>
                )}
              </span>
            </Field>
            <Field label="Source">{t.booking_source ?? "—"}</Field>
            {t.description && <Field label="Notes">{t.description}</Field>}
          </dl>
        </Card>
        <Card title="Customer & location" icon={MapPin}>
          <dl className="fields">
            <Field label="Customer">{t.customer.name ?? "—"}</Field>
            <Field label="Phone"><Phone value={t.customer.phone} /></Field>
            {t.customer.email && <Field label="Email">{t.customer.email}</Field>}
            <Field label="Address">{t.address ?? "—"}{t.city && <div className="muted small">{t.city}</div>}</Field>
            {t.lat != null && t.lng != null && (
              <Field label="GPS">
                <a href={`https://maps.google.com/?q=${t.lat},${t.lng}`} target="_blank" rel="noreferrer" className="mono small link-icon">
                  {t.lat.toFixed(4)}, {t.lng.toFixed(4)} <ExternalLink size={12} />
                </a>
              </Field>
            )}
          </dl>
        </Card>
        <Card title="Helper" icon={UserRound}>
          {t.assignee ? (
            <div className="helper-card">
              <Avatar name={t.assignee.name} size={44} />
              <dl className="fields">
                <Field label="Name">{t.assignee.name ?? t.assignee.id}</Field>
                <Field label="Phone"><Phone value={t.assignee.phone} /></Field>
                <Field label="Assignment">
                  {t.assignment_local_only
                    ? <span className="warn-text">Accepted on our call. Not pushed to ExtraHand (assignment API off).</span>
                    : "On ExtraHand"}
                </Field>
              </dl>
            </div>
          ) : (
            <Empty icon={t.dispatch_status === "dispatching" ? PhoneCall : UserRound}>
              {t.dispatch_status === "dispatching" ? "Calling helpers…" : "No helper assigned."}
            </Empty>
          )}
        </Card>
      </div>

      <AnimatePresence initial={false}>
        {activeCalls.length > 0 && (
          <motion.div key="live" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
            <Card title="Call in progress" icon={PhoneCall}>
              <LiveCalls calls={activeCalls} maxPrompts={config.ivr_max_prompts} onChange={refresh} />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {t.escalations.length > 0 && (
        <Card title="Customer care" icon={LifeBuoy}>
          <ul className="list">
            {t.escalations.map((e) => (
              <li key={e.id}>
                <div>
                  <div className="strong">{humanize(e.reason)}</div>
                  <div className="small muted">{e.details}</div>
                  {e.notes && <div className="small">Notes: {e.notes}</div>}
                </div>
                <Pill value={e.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid-2">
        <Card title="Helper calls" icon={Users}>
          {t.runs.length ? t.runs.map((r) => <RunView key={r.id} run={r} calls={t.calls} />) : (
            <Empty icon={Users}>No helpers called yet.</Empty>
          )}
        </Card>
        <div className="stack">
          <Card title="Reminder calls" icon={BellRing}>
            {t.followups.length ? (
              <ul className="reminders">
                {t.followups.map((f) => (
                  <li key={f.id} className={`tone-${toneOf(f.outcome ?? f.status)}`}>
                    <span className="reminder-offset">{fmtOffset(f.offset_minutes)}</span>
                    <div>
                      <div>{f.helper_name}</div>
                      <div className="small muted">{fmtDateTime(f.due_at)} · {fmtRelative(f.due_at)}</div>
                    </div>
                    <Pill value={f.outcome ?? f.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={BellRing}>{t.assignee ? "No reminders (task too soon or no start time)." : "Scheduled once a helper is assigned."}</Empty>
            )}
          </Card>
          <Card title="Timeline" icon={History}>
            <Timeline events={t.events} time={fmtTime} />
          </Card>
        </div>
      </div>

      <motion.div variants={itemVariants}>
        <Button variant="ghost" size="sm" icon={Code2} onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? "Hide" : "Show"} raw ExtraHand data
          <motion.span animate={{ rotate: showRaw ? 180 : 0 }} style={{ display: "inline-flex" }}><ChevronDown size={13} /></motion.span>
        </Button>
        <AnimatePresence initial={false}>
          {showRaw && (
            <motion.div key="raw" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: "hidden" }}>
              <pre className="raw">{JSON.stringify(t.raw, null, 2)}</pre>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Stagger>
  );
}

const RESULT_ICON: Record<string, typeof Check> = { accepted: Check, confirmed: Check };

function RunView({ run, calls }: { run: DispatchRun; calls: Call[] }) {
  const byHelper = new Map<string, Call>();
  for (const c of calls) if (c.run_id === run.id && c.helper_id) byHelper.set(c.helper_id, c);

  return (
    <div className="run">
      <div className="run-head">
        <span>Run #{run.id} · {fmtDateTime(run.started_at)} · {humanize(run.candidate_source)}</span>
        <Pill value={run.status} />
      </div>
      {run.reason && <div className="small muted">{run.reason}</div>}
      {run.candidates.length === 0 ? (
        <Empty icon={Users}>No eligible helpers found.</Empty>
      ) : (
        <ol className="stepper">
          {run.candidates.map((c, i) => {
            const call = byHelper.get(c.helper_id);
            const current = i === run.current_index && run.status === "running";
            const result = call?.outcome ?? null;
            const waiting = !call && i > run.current_index;
            const Icon = result ? RESULT_ICON[result] ?? X : current ? PhoneCall : waiting ? Hourglass : PhoneOff;
            return (
              <li key={c.helper_id} className={`step ${current ? "current" : ""} ${waiting ? "waiting" : ""} tone-${toneOf(result ?? (current ? "calling" : "closed"))}`}>
                {current && <span className="step-shimmer" />}
                <motion.span key={result ?? (current ? "cur" : "idle")} className="step-icon"
                  initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                  <Icon size={13} strokeWidth={2.5} />
                </motion.span>
                <div className="step-main">
                  <div>{c.name ?? c.helper_id} <span className="mono small muted">{c.phone}</span></div>
                  <div className="small muted">
                    {c.distance_km != null ? `${c.distance_km} km away` : "distance unknown"}
                    {c.skills.length > 0 && ` · ${c.skills.join(", ")}`}
                    {call && call.prompts_played > 0 && ` · message played ${call.prompts_played}×`}
                    {call?.error && ` · ${call.error}`}
                  </div>
                </div>
                {waiting ? <span className="small muted">queued</span> : <Pill value={result ?? call?.status ?? null} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
