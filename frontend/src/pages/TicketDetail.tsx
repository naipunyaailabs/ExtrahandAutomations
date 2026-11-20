import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, BadgeCheck, BellRing, Calendar, ChevronDown, Code2, ExternalLink, History,
  Hourglass, IndianRupee, LifeBuoy, MapPin, PhoneCall, PhoneOutgoing, Square, UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { LiveCalls } from "../components/LiveCalls";
import { itemVariants, Stagger } from "../components/motion";
import { Timeline } from "../components/Timeline";
import { Avatar, Button, Card, Empty, ErrorNote, Phone, Pill, SkeletonPage, toneOf, useToastAction } from "../components/ui";
import { usePoll, useGoBack } from "../hooks";
import { TaskHelpersTable, useHelperRows } from "../components/TaskHelpersTable";
import { fmtDateTime, fmtMoney, fmtOffset, fmtRelative, fmtSlot, fmtTime, humanize } from "../format";
import type { TicketDetail as TicketDetailType } from "../types";

/* ------------------------------------------------------------------------------------------------ helpers */

const istDay = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Where the task stands by date: today / upcoming / overdue / completed (same rules as the task list). */
/** Who assigned the helper and whether ExtraHand has it. */
function assignedNote(t: TicketDetailType): string {
  const via = t.assigned_via || (t.assignment_local_only ? "call" : "extrahand");
  if (via === "extrahand") return "assigned on ExtraHand";
  const how = via === "whatsapp" ? "accepted on WhatsApp" : "accepted on our AI call";
  if (!t.assignment_local_only || t.extrahand_push === "ok") return `${how} · updated on ExtraHand`;
  if (t.extrahand_push === "failed") return `${how} · NOT on ExtraHand (${t.extrahand_push_error || "update failed"})`;
  if (t.extrahand_push === "pending") return `${how} · updating ExtraHand…`;
  return `${how} · this app only`;
}

function dateBucket(t: TicketDetailType): { key: string; label: string; tone: string } {
  const closed = ["completed", "cancelled", "closed"].includes((t.status ?? "").toLowerCase());
  const when = t.scheduled_at ?? t.booked_at ?? t.created_at ?? null;
  const today = istDay(new Date());
  const day = when ? istDay(when) : today;
  if (day === today) return { key: "today", label: "Today", tone: "success" };
  if (day > today) return { key: "upcoming", label: "Upcoming", tone: "warn" };
  return closed ? { key: "done", label: "Completed", tone: "neutral" } : { key: "overdue", label: "Overdue", tone: "danger" };
}

/* ------------------------------------------------------------------------------------------------ page */

/** The task page route: /tickets/:id */
export default function TicketDetail() {
  const goBack = useGoBack("/calling/tasks");
  const { id = "" } = useParams();
  return <TaskDetailView id={id} onBack={goBack} />;
}

interface TaskDetailViewProps {
  id: string;
  onBack: () => void;
  backLabel?: string;
  /** Section shown between the task and the helpers table (e.g. the WhatsApp message on WhatsApp > Send Work Order). */
  extra?: ReactNode;
  /** Extra button(s) per helper row, e.g. Direct Chat. */
  helperAction?: (h: { id: string; name: string; phone: string | null }) => ReactNode;
}

/** Task + its helpers (WhatsApp, call status, pressed key, reply). Used by the task page and by WhatsApp. */
export function TaskDetailView({ id, onBack, backLabel = "Back", extra, helperAction }: TaskDetailViewProps) {
  const config = useConfig()!;
  const { data: t, error, refresh } = usePoll(() => api.ticket(id), 3000, [id]);
  const { data: matched } = usePoll(() => api.whatsapp.taskCandidates(id), 30000, [id]);
  const action = useToastAction();
  const [showRaw, setShowRaw] = useState(false);

  const { counts } = useHelperRows(t, matched);

  if (!t) return error ? <div className="page"><ErrorNote error={error} /></div> : <SkeletonPage />;


  const activeCalls = t.calls.filter((c) => c.status !== "ended").map((c) => ({ ...c, ticket_title: t.title ?? undefined }));
  const running = t.runs.find((r) => r.status === "running");
  const bucket = dateBucket(t);

  return (
    <Stagger className="page td-page">
      {/* ------------------------------------------------------------------ TASK (top) */}
      <motion.div variants={itemVariants}>
        <button type="button" className="td-back" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
      </motion.div>

      <motion.section variants={itemVariants} className={`td-hero td-hero-${bucket.key}`}>
        <div className="td-hero-top">
          <div className="td-hero-title">
            <div className="td-hero-tags">
              <span className="task-category-tag">{t.category ?? "Service"}</span>
              <span className={`pill tone-${bucket.tone}`}><span className="pill-dot" />{bucket.label}</span>
              <Pill value={t.dispatch_status} label={t.dispatch_status === "escalated" ? "customer care" : undefined} />
              <span className="td-muted-chip">ExtraHand: {t.status ?? "—"}</span>
            </div>
            <h1>{t.title ?? "Untitled booking"}</h1>
            <div className="td-sub mono">#{t.id} · synced {fmtRelative(t.synced_at)}</div>
          </div>
          <div className="td-actions">
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
            {t.dispatch_status === "escalated" && (
              <Link className="btn btn-secondary btn-md" to="/calling/care"><LifeBuoy size={15} />Open in customer care</Link>
            )}
          </div>
        </div>

        <div className="td-facts">
          <div className="td-fact">
            <span className="td-fact-label"><Calendar size={13} /> Schedule</span>
            <span className="td-fact-value">{fmtSlot(t.scheduled_at, t.scheduled_end_at)}</span>
            <span className="td-fact-note">
              {t.scheduled_at ? `starts ${fmtRelative(t.scheduled_at)}` : "coordinate on call"}
              {(t.booked_at || t.created_at) && <> · booked {fmtDateTime(t.booked_at || t.created_at)}</>}
            </span>
          </div>
          <div className="td-fact">
            <span className="td-fact-label"><IndianRupee size={13} /> Budget</span>
            <span className="td-fact-value td-money">{t.budget && t.budget > 0 ? fmtMoney(t.budget) : "Negotiable"}</span>
            <span className="td-fact-note">{t.booking_source ? humanize(t.booking_source) : "—"}</span>
          </div>
          <div className="td-fact">
            <span className="td-fact-label"><UserRound size={13} /> Customer</span>
            <span className="td-fact-value">{t.customer.name ?? "—"}</span>
            <span className="td-fact-note"><Phone value={t.customer.phone} /></span>
          </div>
          <div className="td-fact td-fact-wide">
            <span className="td-fact-label"><MapPin size={13} /> Location</span>
            <span className="td-fact-value truncate" title={t.address ?? ""}>{t.city || t.address || "—"}</span>
            <span className="td-fact-note truncate" title={t.address ?? ""}>
              {t.lat != null && t.lng != null ? (
                <a href={`https://maps.google.com/?q=${t.lat},${t.lng}`} target="_blank" rel="noreferrer" className="link-icon">
                  {t.address && t.address !== t.city ? t.address : "Open in Maps"} <ExternalLink size={11} />
                </a>
              ) : (t.address && t.address !== t.city ? t.address : "—")}
            </span>
          </div>
          <div className="td-fact td-fact-helper">
            <span className="td-fact-label"><BadgeCheck size={13} /> Assigned helper</span>
            {t.assignee ? (
              <>
                <span className="td-fact-value td-assigned"><Avatar name={t.assignee.name} size={22} /> {t.assignee.name ?? t.assignee.id}</span>
                <span className="td-fact-note"><Phone value={t.assignee.phone} /> · {assignedNote(t)}</span>
              </>
            ) : (
              <>
                <span className="td-fact-value td-unassigned">{t.dispatch_status === "dispatching" ? "Calling helpers…" : "Not assigned yet"}</span>
                <span className="td-fact-note">{counts.accepted ? `${counts.accepted} accepted` : `${counts.called} of ${counts.all} called`}</span>
              </>
            )}
          </div>
        </div>
        {t.description && <p className="td-notes">{t.description}</p>}
      </motion.section>

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

      {extra && <motion.div variants={itemVariants}>{extra}</motion.div>}

      {/* ------------------------------------------------------------------ HELPERS (below) */}
      <TaskHelpersTable t={t} matched={matched} action={helperAction} />

      {/* ------------------------------------------------------------------ reminders + timeline */}
      <div className="grid-2">
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
          {t.events.length ? <Timeline events={t.events} time={fmtTime} /> : <Empty icon={Hourglass}>Nothing has happened on this task yet.</Empty>}
        </Card>
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
