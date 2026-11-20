import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Loader2,
  MapPin,
  MessageSquareQuote,
  Phone,
  Play,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Square,
  Star,
  UserRound,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNote, SkeletonRows, useToast } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { FbCommercials, FbFeedbackFilter, FbReply, FbTask, FbTasksPage, FbTaskState, FbTemplateExample, FbWhen, WaFeedbackItem, WaFeedbackOverview, WaFeedbackPage, WaFeedbackTab } from "../types";
import "./wa-commercials.css";
import "./wa-feedback.css";
import "./wa-feedback-tasks.css";
import "./wa-feedback-replies.css";
import "./wa-feedback-rows.css";
import "./wa-feedback-commercials.css";
import "./wa-feedback-drawer.css";

/* ================================================================================================ helpers */

function toDate(iso: string): Date {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
}
function when(iso: string | null): string {
  if (!iso) return "—";
  return toDate(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}
/** Task time; ExtraHand date-only tasks arrive as midnight India time and show as "All day". */
function timeOnly(iso: string | null): string {
  if (!iso) return "No time";
  const d = toDate(iso);
  const ist = new Date(d.getTime() + 330 * 60000);
  if (ist.getUTCHours() === 0 && ist.getUTCMinutes() === 0) return "All day";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}
function dayOnly(iso: string | null): string {
  if (!iso) return "";
  return toDate(iso).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}
function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - toDate(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return when(iso);
}
function phone(p: string | null): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return "No phone";
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}
const titleCase = (s: string | null) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");
const initials = (n: string | null) => {
  const p = (n ?? "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
};

function Stars({ value, size = 15 }: { value: number | null; size?: number }) {
  const v = Math.round(value ?? 0);
  return (
    <span className="wfb-stars" aria-label={value ? `${value} out of 5` : "no rating"}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= v ? "on" : ""} fill={n <= v ? "currentColor" : "none"} />)}
    </span>
  );
}

const QUESTIONS: { key: "work" | "behaviour" | "on_time"; label: string; icon: typeof Wrench }[] = [
  { key: "work", label: "Quality of work", icon: Wrench },
  { key: "behaviour", label: "Behaviour", icon: UserRound },
  { key: "on_time", label: "Arrived on time", icon: Clock3 },
];

const STATE: Record<FbTaskState, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "ok" },
  in_progress: { label: "In progress", tone: "info" },
  open: { label: "Open", tone: "wait" },
  cancelled: { label: "Cancelled", tone: "off" },
};

/** Shared top banner: switch + key numbers (both pages). */
function Banner({ o, refresh, title, sub }: { o: WaFeedbackOverview | null; refresh: () => void; title: string; sub: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"toggle" | "check" | null>(null);

  const toggle = async () => {
    if (!o) return;
    setBusy("toggle");
    try {
      if (o.active) {
        await api.whatsapp.deactivateFeedback();
        toast.info("Feedback automation deactivated", "No more feedback forms will be sent.");
      } else {
        await api.whatsapp.activateFeedback();
        toast.success("Feedback automation activated", "Customers of tasks completed from now on get the feedback form.");
      }
      refresh();
    } catch (e) {
      toast.error("Could not update", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const checkNow = async () => {
    setBusy("check");
    try {
      const res = await api.whatsapp.feedbackCheckNow();
      toast.info("Checked completed tasks", res.sent ? `${res.sent} feedback form(s) sent.` : "No newly completed tasks to ask about.");
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <header className="wx-banner wfb-banner">
      <div className="wx-banner-top">
        <div className="wx-banner-title">
          <span className="wx-kicker"><Star size={13} /> Reviews &amp; Feedback</span>
          <h1>{title}</h1>
          <p className="wfb-sub">{sub}</p>
        </div>
        <div className="wx-banner-tools">
          {o && (
            <button className={`wfb-switch ${o.active ? "on" : "off"}`} onClick={toggle} disabled={busy !== null}>
              {busy === "toggle" ? <Loader2 size={14} className="animate-spin" /> : o.active ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              {o.active ? "Active · Deactivate" : "Deactive · Activate"}
            </button>
          )}
          <button className="wx-ghost" onClick={checkNow} disabled={busy !== null || !o?.active} title="Look for newly completed tasks now">
            {busy === "check" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check now
          </button>
        </div>
      </div>
      {o && (
        <div className="wx-figures wfb-figures">
          <div><span>Average rating</span><b>{o.averages.overall ? <>{o.averages.overall.toFixed(1)}<small> / 5</small></> : "—"}</b><em><Stars value={o.averages.overall} size={12} /></em></div>
          <Link to="/feedback/replies" className="wfb-fig-link" title="Read the replies">
            <span>Feedback received</span><b>{o.counts.answered}</b><em>{o.response_rate}% of {o.counts.asked} asked · view →</em>
          </Link>
          <div><span>Awaiting reply</span><b>{o.counts.sent}</b><em>form sent, no answer yet</em></div>
          <Link to="/feedback/replies?tab=low" className="wfb-fig-link" title="Read the low ratings">
            <span>Low ratings</span><b className={o.counts.low ? "wfb-bad-n" : ""}>{o.counts.low}</b><em>2 stars or less · view →</em>
          </Link>
        </div>
      )}
      {o && (
        <div className="wx-banner-foot">
          {o.active ? <span><i className="wx-live" /> Active since {when(o.since)} · every task completed after this gets the form</span>
            : <span><i className="wfb-paused" /> Deactive — no feedback forms are sent</span>}
          <span><Clock3 size={12} /> Sent {o.quiet_hours.label.replace(" IST", "")}</span>
        </div>
      )}
    </header>
  );
}

/* ================================================================================================ period KPIs */

function PeriodKpis({ f, label }: { f: NonNullable<FbTasksPage["funnel"]>; label: string }) {
  const tiles = [
    { key: "completed", label: "Completed tasks", value: f.completed, sub: "feedback can be asked", tone: "ok", icon: CheckCircle2 },
    { key: "sent", label: "Forms sent", value: f.sent, sub: "on WhatsApp", tone: "info", icon: Send },
    { key: "received", label: "Feedback received", value: f.received, sub: `${f.reply_rate}% reply rate`, tone: "star", icon: Star },
    { key: "pending", label: "Pending reply", value: f.pending, sub: "sent, no answer yet", tone: "wait", icon: Clock3 },
    { key: "not_asked", label: "Not asked", value: f.not_asked, sub: f.failed ? `+ ${f.failed} not sent` : "completed, no form yet", tone: "off", icon: MessageSquareQuote },
  ] as const;
  return (
    <div className="fbk" aria-label={`${label} feedback numbers`}>
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.key} className={`fbk-tile fbk-${t.tone}`}>
            <span className="fbk-icon"><Icon size={16} /></span>
            <div>
              <span className="fbk-label">{t.label}</span>
              <b className="tabular">{t.value}</b>
              <small>{t.sub}</small>
            </div>
          </div>
        );
      })}
      <div className="fbk-rate" title="Feedback received out of forms sent">
        <span>Reply rate · {label}</span>
        <div className="fbk-bar"><i style={{ width: `${Math.min(100, f.reply_rate)}%` }} /></div>
        <b className="tabular">{f.reply_rate}%</b>
      </div>
    </div>
  );
}

/* ================================================================================================ task row (one line) */

function FeedbackCell({ t }: { t: FbTask }) {
  const f = t.feedback;
  if (f?.status === "answered") {
    return (
      <span className={`fbr2-fb answered ${f.low ? "low" : ""}`} title={f.comment ? `Concerns: “${f.comment}”` : "No concerns mentioned"}>
        <Star size={13} fill="currentColor" />
        <b className="tabular">{f.average?.toFixed(1)}</b>
        <span className="fbr2-fb-detail">
          {QUESTIONS.map((q) => `${q.label.split(" ")[0]} ${f.ratings[q.key] ?? "–"}`).join(" · ")}
        </span>
        {f.comment && <MessageSquareQuote size={13} className="fbr2-fb-cmt" />}
      </span>
    );
  }
  if (t.state !== "completed") return <span className="fbr2-fb muted">After completion</span>;
  if (f?.status === "sent" || f?.status === "sending") return <span className="fbr2-fb wait"><Clock3 size={13} /> Awaiting reply</span>;
  if (f?.status === "failed") return <span className="fbr2-fb bad" title={f.error ?? undefined}><XCircle size={13} /> Not sent</span>;
  if (f?.status === "no_phone") return <span className="fbr2-fb bad"><XCircle size={13} /> No phone</span>;
  return <span className="fbr2-fb off">Not asked</span>;
}

function TaskRow({ t, onSend, onOpen }: { t: FbTask; onSend: (id: string) => void; onOpen: (t: FbTask) => void }) {
  const st = STATE[t.state];
  const f = t.feedback;
  const canAsk = t.state === "completed" && !!t.customer.phone && (!f || ["sent", "failed", "skipped"].includes(f.status));
  return (
    <li
      className={`fbr2-row fbr2-${t.state} ${f?.low ? "low" : ""}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a")) onOpen(t); }}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(t); }}
      role="button"
      tabIndex={0}
      title="Open task details and feedback"
    >
      <span className="fbr2-when">
        <b>{timeOnly(t.scheduled_at)}</b>
        <small>{dayOnly(t.scheduled_at)}</small>
      </span>
      <span className="fbr2-task">
        <b>{t.title || titleCase(t.category) || "Task"}</b>
        <small>{titleCase(t.category)}{t.budget ? ` · ₹${Math.round(t.budget)}` : ""}{t.city ? ` · ${t.city}` : ""}</small>
      </span>
      <span className="fbr2-person">
        <b>{t.customer.name || "Unknown"}</b>
        {t.customer.phone ? (
          <a href={`tel:${t.customer.phone}`}><Phone size={11} /> {phone(t.customer.phone)}</a>
        ) : <small>No phone</small>}
      </span>
      <span className="fbr2-person">
        <b className={t.helper ? "" : "muted"}>{t.helper?.name || "Not assigned"}</b>
        <small>{t.helper ? "Helper" : "—"}</small>
      </span>
      <span className="fbr2-status"><span className={`wfb-chip wfb-t-${st.tone}`}>{st.label}</span></span>
      <span className="fbr2-fbcol"><FeedbackCell t={t} /></span>
      <span className="fbr2-act">
        {canAsk ? (
          <button className="fbr2-ask" onClick={() => onSend(t.id)} title={f?.status === "sent" ? "Send the form again" : "Send the feedback form now"}>
            <Send size={12} /> {f?.status === "sent" ? "Remind" : "Ask"}
          </button>
        ) : <ChevronRight size={16} className="fbr2-chev" />}
      </span>
    </li>
  );
}

/* ================================================================================================ Tasks & Feedback page */

const WHEN: { key: FbWhen; label: string; desc: string; icon: typeof CalendarDays }[] = [
  { key: "today", label: "Today", desc: "Live service dispatches", icon: CalendarDays },
  { key: "previous", label: "Previous Tasks", desc: "Historical & completed jobs", icon: History },
  { key: "upcoming", label: "Upcoming", desc: "Future bookings scheduled", icon: CalendarClock },
];
const STATES: { key: FbTaskState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "in_progress", label: "In progress" },
  { key: "open", label: "Open" },
  { key: "cancelled", label: "Cancelled" },
];

export function WaFeedback() {
  const toast = useToast();
  const ov = usePoll<WaFeedbackOverview>(api.whatsapp.feedbackOverview, 30000);
  const [whenKey, setWhen] = useState<FbWhen>("today");
  const [state, setState] = useState<FbTaskState | "all">("all");
  const [fb, setFb] = useState<FbFeedbackFilter>("all");
  const [open, setOpen] = useState<FbTask | null>(null);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const list = usePoll<FbTasksPage>(() => api.whatsapp.feedbackTasks(whenKey, state, q, offset, fb), 30000, [whenKey, state, q, offset, fb]);
  const o = ov.data;
  const r = list.data;

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => setOffset(0), [whenKey, state, q, fb]);

  const refresh = () => {
    ov.refresh();
    list.refresh();
  };
  const sendNow = async (ticketId: string) => {
    try {
      await api.whatsapp.feedbackSendNow(ticketId);
      toast.success("Feedback form sent", "The customer got the form on WhatsApp.");
      refresh();
    } catch (e) {
      toast.error("Not sent", (e as Error).message);
    }
  };

  return (
    <div className="wx-page">
      <Banner o={o} refresh={refresh} title="Tasks & Feedback"
        sub="Every task with its customer, helper and status. When a task is completed the customer automatically gets a WhatsApp form; their ratings and comments appear right on the task." />
      <ErrorNote error={ov.error} />

      {o && !(o.setup.ready && o.webhook_last_seen) && (
        <div className="fbt-alert">
          <Settings2 size={16} />
          <span>
            {!o.setup.ready ? "The feedback template is not approved by Meta yet, so no forms go out." : "Forms are sent, but answers can only arrive once Meta's webhook reaches this app."}
          </span>
          <Link to="/feedback/template">Open Feedback Template</Link>
        </div>
      )}

      <section className="wx-sheet">
        <div className="fbt-when" role="tablist" aria-label="When">
          {WHEN.map((w) => {
            const Icon = w.icon;
            const count = r ? r.counts[w.key] : "–";
            return (
              <button
                key={w.key}
                role="tab"
                aria-selected={whenKey === w.key}
                className={whenKey === w.key ? "on" : ""}
                onClick={() => setWhen(w.key)}
              >
                <div className="fbt-when-icon"><Icon size={18} /></div>
                <div className="fbt-when-text">
                  <span className="fbt-when-title">{w.label}</span>
                  <small className="fbt-when-desc">{w.desc}</small>
                </div>
                <b className="fbt-when-count tabular">{count}</b>
              </button>
            );
          })}
        </div>

        {r?.funnel && <PeriodKpis f={r.funnel} label={WHEN.find((w) => w.key === whenKey)?.label ?? ""} />}

        <div className="fbt-tools">
          <div className="fbt-search-bar">
            <Search size={15} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search task, customer name, phone, helper, area or ticket ID..."
            />
            {draft && (
              <button
                className="fbt-search-clear"
                onClick={() => { setDraft(""); setQ(""); }}
                title="Clear search"
                type="button"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="fbt-filter-row">
            <div className="wfb-tabs" role="tablist" aria-label="Status">
              {STATES.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={state === s.key}
                  className={state === s.key ? "on" : ""}
                  onClick={() => setState(s.key)}
                >
                  {s.label}<span className="tabular">{r ? r.states[s.key] : "–"}</span>
                </button>
              ))}
            </div>

            <div className="fbt-fbfilter" role="tablist" aria-label="Feedback">
              <span>Feedback:</span>
              {FB_FILTERS.map((x) => (
                <button
                  key={x.key}
                  role="tab"
                  aria-selected={fb === x.key}
                  className={`${fb === x.key ? "on" : ""} fbt-fbf-${x.key}`}
                  onClick={() => setFb(x.key)}
                  title={x.hint}
                >
                  {x.icon} {x.label}
                  {x.key !== "all" && <small className="fbt-fbf-range">{x.key === "best" ? "5–4★" : x.key === "good" ? "3★" : "≤2★"}</small>}
                  <b className="tabular">{r?.feedback?.[x.key] ?? "–"}</b>
                </button>
              ))}
            </div>
          </div>

          {r && (
            <div className="fbt-meta-summary">
              <span>Showing <b>{r.items.length}</b> of <b>{r.total}</b> tasks</span>
              {q && <span className="fbt-matching-tag">Filtered by: &ldquo;{q}&rdquo;</span>}
            </div>
          )}
        </div>

        <ErrorNote error={list.error} />
        {!r && !list.error && <SkeletonRows rows={6} />}
        {r && r.items.length === 0 && (
          <div className="wx-empty">No {state === "all" ? "" : `${STATES.find((s) => s.key === state)?.label.toLowerCase()} `}tasks {whenKey === "today" ? "today" : whenKey === "upcoming" ? "coming up" : "before today"}.</div>
        )}
        {r && r.items.length > 0 && (
          <>
            <div className="fbr2-table">
              <div className="fbr2-head" aria-hidden>
                <span>When</span><span>Task</span><span>Customer</span><span>Helper</span><span>Status</span><span>Feedback</span><span />
              </div>
              <ul className="fbr2-list">{r.items.map((t) => <TaskRow key={t.id} t={t} onSend={sendNow} onOpen={setOpen} />)}</ul>
            </div>
            <div className="wfb-pager">
              <span className="tabular">{r.offset + 1}–{r.offset + r.items.length} of {r.total}</span>
              <button disabled={r.offset === 0} onClick={() => setOffset(Math.max(0, r.offset - r.limit))}>{whenKey === "previous" ? "Newer" : "Earlier"}</button>
              <button disabled={r.offset + r.items.length >= r.total} onClick={() => setOffset(r.offset + r.limit)}>{whenKey === "previous" ? "Older" : "Later"}</button>
            </div>
          </>
        )}
      </section>
      <TaskDrawer t={open} onClose={() => setOpen(null)} onSend={sendNow} />
    </div>
  );
}

/* ================================================================================================ Feedback Template page */

export function WaFeedbackTemplate() {
  const toast = useToast();
  const ov = usePoll<WaFeedbackOverview>(api.whatsapp.feedbackOverview, 60000);
  const ex = usePoll<FbTemplateExample>(api.whatsapp.feedbackExample, 120000);
  const [busy, setBusy] = useState(false);
  const o = ov.data;
  const e = ex.data;

  const setup = async () => {
    setBusy(true);
    try {
      await api.whatsapp.feedbackSetup();
      toast.success("Sent to Meta", "Feedback form published and template submitted for approval.");
      ov.refresh();
    } catch (err) {
      toast.error("Setup failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tmpl = o?.setup.template.status ?? "";
  const steps = o ? [
    { ok: o.setup.flow.status === "PUBLISHED", wait: false, label: "Feedback form", detail: o.setup.flow.status === "PUBLISHED" ? "Published in WhatsApp" : "Not created yet" },
    { ok: tmpl === "APPROVED", wait: tmpl === "PENDING", label: "Message template", detail: tmpl === "APPROVED" ? `Approved by Meta${o.setup.template.category ? ` · ${o.setup.template.category.toLowerCase()}` : ""}` : tmpl === "PENDING" ? "Waiting for Meta approval" : tmpl === "REJECTED" ? `Rejected${o.setup.template.rejected_reason ? `: ${o.setup.template.rejected_reason}` : ""}` : "Not created yet" },
    { ok: !!o.webhook_last_seen, wait: false, label: "Receiving answers", detail: o.webhook_last_seen ? `Meta reached the app ${ago(o.webhook_last_seen)}` : "Meta's webhook does not reach this app yet" },
  ] : [];

  return (
    <div className="wx-page">
      <Banner o={o} refresh={() => ov.refresh()} title="Feedback Template"
        sub="The WhatsApp message and form every customer receives when their task is completed, shown with a real example." />
      <ErrorNote error={ov.error || ex.error} />
      {(!o || !e) && !ov.error && !ex.error && <div className="wx-sheet"><SkeletonRows rows={8} /></div>}

      {o && e && (
        <>
          <section className="wx-sheet">
            <div className="wx-sheet-head">
              <Settings2 size={16} className="wfb-head-icon" /><h2>Status in Meta</h2>
              <span className="wx-sheet-aside">
                {(o.setup.flow.status !== "PUBLISHED" || tmpl === "NOT_CREATED" || tmpl === "REJECTED") && (
                  <button className="wfb-btn" onClick={setup} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Set up in Meta
                  </button>
                )}
              </span>
            </div>
            <ol className="wfb-steps">
              {steps.map((s) => (
                <li key={s.label} className={`wfb-step ${s.ok ? "ok" : s.wait ? "wait" : "todo"}`}>
                  {s.ok ? <CheckCircle2 size={18} /> : s.wait ? <Clock3 size={18} /> : <XCircle size={18} />}
                  <div><b>{s.label}</b><span>{s.detail}</span></div>
                </li>
              ))}
            </ol>
            <div className="fbt-meta-row">
              <span><FileText size={13} /> Template <code>{o.template.name}</code></span>
              <span>Language: English</span>
              <span>Button: “{e.button}” opens the form</span>
            </div>
          </section>

          <div className="fbt-tpl-grid">
            <section className="wx-sheet">
              <div className="wx-sheet-head">
                <MessageSquareQuote size={16} className="wfb-head-icon" /><h2>Example message</h2>
                <span className="wx-sheet-aside wx-aside">{e.from_real_task ? `filled with “${e.task?.title}”` : "example values"}</span>
              </div>
              <div className="fbt-phones">
                <div className="wfb-phone">
                  <div className="wfb-phone-top"><img src="/extrahand_app_icon_white_bg.png" alt="" /><div><b>ExtraHand</b><small>Verified business</small></div></div>
                  <div className="wfb-chat">
                    <div className="wfb-bubble">
                      <div className="wfb-bubble-text">{e.filled_body}</div>
                      <div className="wfb-bubble-foot">{e.footer}</div>
                      <div className="wfb-bubble-btn"><Star size={14} /> {e.button}</div>
                    </div>
                  </div>
                </div>

                <div className="wfb-phone">
                  <div className="wfb-phone-top"><img src="/extrahand_app_icon_white_bg.png" alt="" /><div><b>Rate your service</b><small>Opens inside WhatsApp</small></div></div>
                  <div className="fbt-form">
                    <p>How was your ExtraHand helper?</p>
                    {o.form.questions.map((q, qi) => (
                      <div key={q.key} className="fbt-form-q">
                        <b>{q.label}</b>
                        {q.options.map((opt, i) => (
                          <span key={opt} className={i === (qi === 2 ? 1 : 0) ? "picked" : ""}><i />{opt}</span>
                        ))}
                      </div>
                    ))}
                    <div className="fbt-form-q">
                      <b>{o.form.comment_label}</b>
                      <div className="fbt-form-box">Helper was polite, came 10 minutes late.</div>
                    </div>
                    <div className="fbt-form-submit">Submit feedback</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="wx-sheet">
              <div className="wx-sheet-head"><FileText size={16} className="wfb-head-icon" /><h2>How it is filled</h2></div>
              <ul className="fbt-vars">
                {e.values.map((v) => (
                  <li key={v.n}><code>{`{{${v.n}}}`}</code><div><b>{v.label}</b><span>{v.example}</span></div></li>
                ))}
                <li><code><Star size={12} /></code><div><b>“{e.button}” button</b><span>Opens the form for that exact task</span></div></li>
              </ul>
              <h4 className="fbt-h4">Template text</h4>
              <pre className="fbt-raw">{e.raw_body}</pre>
              <h4 className="fbt-h4">When it is sent</h4>
              <ul className="fbt-rules">
                <li>Automatically when a task's status becomes <b>Completed</b> (synced from ExtraHand)</li>
                <li>Only between <b>{o.quiet_hours.label.replace(" IST", "")}</b>; night completions get it in the morning</li>
                <li>Once per task · never for tasks completed before the automation was activated</li>
                <li>Answers appear on the task in <b>Tasks &amp; Feedback</b></li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================================================ feedback filter */

const FB_FILTERS: { key: FbFeedbackFilter; label: string; icon: string; hint: string }[] = [
  { key: "all", label: "All", icon: "", hint: "Every task" },
  { key: "best", label: "Best", icon: "😊", hint: "Average 5 or 4 stars" },
  { key: "good", label: "Good", icon: "🙂", hint: "Average 3 stars" },
  { key: "worst", label: "Worst", icon: "😞", hint: "Average 2 stars or below: follow up" },
];

/* ================================================================================================ task drawer */

function verdict(avg: number | null): { text: string; tone: string } {
  const a = avg ?? 0;
  if (a >= 4.5) return { text: "Excellent service", tone: "ok" };
  if (a >= 3.5) return { text: "Good service", tone: "ok" };
  if (a >= 2.5) return { text: "Average", tone: "wait" };
  return { text: "Needs follow-up", tone: "bad" };
}

function TaskDrawer({ t, onClose, onSend }: { t: FbTask | null; onClose: () => void; onSend: (id: string) => void }) {
  useEffect(() => {
    if (!t) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, onClose]);
  if (!t) return null;
  const st = STATE[t.state];
  const f = t.feedback;
  const r = f?.reply ?? null;
  const answered = f?.status === "answered";
  const picked = (key: string) => r?.answer?.find((a) => a.key === key)?.picked.replace(/^[★\s]+/, "") ?? "";
  const steps = [
    { label: "Completed", done: t.state === "completed", at: t.state === "completed" ? dayOnly(t.scheduled_at) : "" },
    { label: "Form sent", done: !!f?.sent_at || answered, at: f?.sent_at ? when(f.sent_at) : "" },
    { label: "Replied", done: answered, at: f?.answered_at ? when(f.answered_at) : "" },
  ];
  const v = verdict(f?.average ?? null);

  return createPortal(
    <div className="fbd-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="fbd fbd2" role="dialog" aria-modal="true" aria-label="Task details">
        {/* ------------------------------------------------------------ header */}
        <header className="fbd2-head">
          <div className="fbd2-head-top">
            <span className={`wfb-chip wfb-t-${st.tone}`}>{t.state === "completed" && <CheckCircle2 size={12} />}{st.label}</span>
            <button className="fbd2-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
          <h3>{t.title || titleCase(t.category) || "Task"}</h3>
          <div className="fbd2-meta">
            {t.category && <span>{titleCase(t.category)}</span>}
            <span><CalendarDays size={12} /> {dayOnly(t.scheduled_at)} · {timeOnly(t.scheduled_at)}</span>
            {t.budget ? <span className="fbd2-price">₹{Math.round(t.budget)}</span> : null}
          </div>
        </header>

        <div className="fbd2-body">
          {/* ------------------------------------------------------------ people */}
          <div className="fbd2-people">
            {[
              { role: "Customer", name: t.customer.name || "Unknown", ph: t.customer.phone, icon: UserRound },
              { role: "Helper", name: t.helper?.name || "Not assigned", ph: t.helper?.phone ?? null, icon: Wrench },
            ].map((p) => (
              <div key={p.role} className="fbd2-person">
                <span className={`fbd2-av ${p.role === "Helper" ? "h" : ""}`}>{p.role === "Helper" ? <p.icon size={16} /> : initials(p.name)}</span>
                <div>
                  <small>{p.role}</small>
                  <b>{p.name}</b>
                  <span>{p.ph ? phone(p.ph) : "No phone"}</span>
                </div>
                {p.ph && <a className="fbd2-call" href={`tel:${p.ph}`} title={`Call ${p.name}`}><Phone size={14} /></a>}
              </div>
            ))}
          </div>

          {/* ------------------------------------------------------------ feedback */}
          <section className="fbd2-section">
            <h4>Customer feedback</h4>
            {answered && f ? (
              <div className={`fbd2-fb ${f.low ? "low" : ""}`}>
                <div className="fbd2-fb-top">
                  <div className="fbd2-score">
                    <b>{f.average?.toFixed(1)}</b>
                    <div>
                      <Stars value={f.average} size={16} />
                      <span className={`fbd2-verdict ${v.tone}`}>{v.text}</span>
                    </div>
                  </div>
                  {r && (
                    <span className={`fbd2-src ${r.verified ? "ok" : r.source === "test" ? "bad" : "off"}`}
                      title={r.message_id ? `Message ID ${r.message_id}` : undefined}>
                      {r.verified ? <><CheckCircle2 size={12} /> Real reply</> : r.source === "test" ? <><AlertTriangle size={12} /> Test data</> : "Source unknown"}
                    </span>
                  )}
                </div>
                {r?.source === "test" && <p className="fbd2-warn">This reply came from a test, not from {t.customer.name || "the customer"}.</p>}

                <div className="fbd2-rows">
                  {QUESTIONS.map((q) => {
                    const n = f.ratings[q.key];
                    return (
                      <div key={q.key} className={(n ?? 5) <= 2 ? "bad" : ""}>
                        <span className="fbd2-q"><q.icon size={14} /> {q.label}</span>
                        <Stars value={n} size={14} />
                        <span className="fbd2-pick">{picked(q.key) || (n ? `${n}/5` : "—")}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="fbd2-concern">
                  <span className="fbd2-label"><MessageSquareQuote size={13} /> Concerns</span>
                  {f.comment
                    ? <div className={`fbd2-bubble ${f.low ? "bad" : ""}`}>{f.comment}</div>
                    : <span className="fbd2-none">No concerns mentioned</span>}
                </div>
                {r?.via === "text" && r.stars_guessed && (
                  <p className="fbd2-note"><AlertTriangle size={12} /> The customer typed a message instead of using the form; stars are estimated from it.</p>
                )}
                {r && r.messages.length > 0 && (
                  <div className="fbd2-concern">
                    <span className="fbd2-label">Other messages</span>
                    {r.messages.map((m, i) => (
                      <div key={m.message_id ?? i} className="fbd2-bubble small">{m.text || `[${m.kind}]`}<small>{when(m.at)}</small></div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="fbd2-empty">
                <MessageSquareQuote size={22} />
                <span>
                  {t.state !== "completed"
                    ? t.state === "cancelled" ? "Cancelled: no feedback is asked." : "The feedback form goes out automatically when this task is completed."
                    : f?.status === "sent" ? `Form sent ${when(f.sent_at)}. Waiting for the customer's reply.`
                    : f?.status === "failed" ? `Not sent: ${f.error || "Meta refused it"}`
                    : f?.status === "no_phone" ? "This task has no customer phone number."
                    : "Feedback has not been asked for this task yet."}
                </span>
                {t.state === "completed" && t.customer.phone && (!f || ["sent", "failed", "skipped"].includes(f.status)) && (
                  <button className="wfb-btn" onClick={() => onSend(t.id)}><Send size={14} /> {f?.status === "sent" ? "Send again" : "Ask for feedback"}</button>
                )}
              </div>
            )}
          </section>

          {/* ------------------------------------------------------------ progress */}
          <section className="fbd2-section">
            <h4>Progress</h4>
            <ol className="fbd2-steps">
              {steps.map((s) => (
                <li key={s.label} className={s.done ? "done" : ""}>
                  <i>{s.done ? <Check size={12} strokeWidth={3} /> : null}</i>
                  <b>{s.label}</b>
                  <small>{s.at || "—"}</small>
                </li>
              ))}
            </ol>
          </section>

          {/* ------------------------------------------------------------ details */}
          <section className="fbd2-section">
            <h4>Details</h4>
            <dl className="fbd2-details">
              {(t.address || t.city) && <><dt><MapPin size={13} /> Address</dt><dd>{t.address || t.city}</dd></>}
              {t.customer.email && <><dt>Email</dt><dd>{t.customer.email}</dd></>}
              <dt>Task ID</dt><dd className="mono">{t.id}</dd>
              {r?.message_id && <><dt>Reply ID</dt><dd className="mono">{r.message_id}</dd></>}
            </dl>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/* ================================================================================================ exactly what the customer sent */

function SourceBadge({ r }: { r: FbReply }) {
  if (r.verified) return <span className="fbs-badge ok" title={r.message_id ?? ""}><CheckCircle2 size={12} /> Received from WhatsApp</span>;
  if (r.source === "test") return <span className="fbs-badge bad" title={r.message_id ?? ""}><AlertTriangle size={12} /> Test data · not sent by the customer</span>;
  return <span className="fbs-badge off">Source unknown</span>;
}

/* ================================================================================================ Customer Replies page */

const REPLY_TABS: { key: WaFeedbackTab; label: string }[] = [
  { key: "received", label: "All replies" },
  { key: "low", label: "Low ratings" },
  { key: "commented", label: "With comments" },
  { key: "five_star", label: "5 stars" },
];

const EXAMPLE_REPLY: WaFeedbackItem = {
  id: 0, ticket_id: "example", task_title: "Ceiling Fan Replacement", category: "electrician", city: "Siddipet",
  scheduled_at: null, customer_name: "Ravi Kumar", customer_phone: "919000000001", helper_name: "Anand", status: "answered",
  error: null, ratings: { work: 5, behaviour: 5, on_time: 3 }, average: 4.33, low: false,
  comment: "Very polite and did neat work. Came about 20 minutes late.", created_at: null, sent_at: null, answered_at: null,
};

function ReplyCard({ f, example = false }: { f: WaFeedbackItem; example?: boolean }) {
  return (
    <li className={`fbr-card ${f.low ? "low" : ""} ${example ? "example" : ""}`}>
      {example && <span className="fbr-example">Example · this is how a reply will look</span>}
      {!example && f.reply && !f.reply.verified && <SourceBadge r={f.reply} />}
      <div className="fbr-top">
        <span className="fbt-avatar">{initials(f.customer_name)}</span>
        <div className="fbr-who">
          <b>{f.customer_name || "Customer"}</b>
          <span><Phone size={11} /> {phone(f.customer_phone)}</span>
        </div>
        <div className={`fbr-score ${f.low ? "low" : ""}`}>
          <b>{f.average?.toFixed(1) ?? "—"}</b>
          <Stars value={f.average} size={12} />
        </div>
      </div>
      <div className="fbr-task">
        <Wrench size={13} /> <b>{f.task_title || titleCase(f.category)}</b>
        <span>· by {f.helper_name || "helper"}{f.city ? ` · ${f.city}` : ""}</span>
      </div>
      <div className="fbr-rows">
        {QUESTIONS.map((q) => (
          <div key={q.key} className={(f.ratings[q.key] ?? 5) <= 2 ? "bad" : ""}>
            <span>{q.label}</span>
            <Stars value={f.ratings[q.key]} size={14} />
          </div>
        ))}
      </div>
      <span className="fbr-concern-label"><MessageSquareQuote size={13} /> Concerns</span>
      {f.comment ? (
        <blockquote className={f.low ? "bad" : ""}>{f.low && <AlertTriangle size={14} />}<span>“{f.comment}”</span></blockquote>
      ) : (
        <p className="fbr-nocomment">No concerns mentioned</p>
      )}
      <div className="fbr-foot">{example ? "Replied just now" : `Replied ${when(f.answered_at)}`}</div>
    </li>
  );
}

export function WaFeedbackReplies() {
  const ov = usePoll<WaFeedbackOverview>(api.whatsapp.feedbackOverview, 30000);
  const [tab, setTab] = useUrlState<WaFeedbackTab>("tab", "received");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const list = usePoll<WaFeedbackPage>(() => api.whatsapp.feedbackRequests(tab, q, offset), 30000, [tab, q, offset]);
  const o = ov.data;
  const r = list.data;

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => setOffset(0), [tab, q]);

  const maxDist = Math.max(1, ...Object.values(o?.distribution ?? { 1: 0 }));

  return (
    <div className="wx-page">
      <Banner o={o} refresh={() => { ov.refresh(); list.refresh(); }} title="Customer Replies"
        sub="Every feedback reply from customers: the three star ratings and their comments, newest first." />
      <ErrorNote error={ov.error} />

      {o && (
        <section className="wx-sheet fbr-summary">
          <div className="fbr-big">
            <span>Overall</span>
            <b>{o.averages.overall ? o.averages.overall.toFixed(1) : "—"}</b>
            <Stars value={o.averages.overall} size={18} />
            <small>{o.counts.answered} {o.counts.answered === 1 ? "reply" : "replies"}</small>
          </div>
          <div className="wfb-avgs">
            {QUESTIONS.map((x) => (
              <div key={x.key} className="wfb-avg-row">
                <span className="wfb-avg-label"><x.icon size={15} /> {x.label}</span>
                <span className="wfb-avg-bar"><i style={{ width: `${((o.averages[x.key] ?? 0) / 5) * 100}%` }} /></span>
                <b className="tabular">{o.averages[x.key] ? o.averages[x.key]!.toFixed(1) : "—"}</b>
              </div>
            ))}
          </div>
          <div className="wfb-dist fbr-dist">
            {(["5", "4", "3", "2", "1"] as const).map((n) => (
              <div key={n} className={`wfb-dist-row ${Number(n) <= 2 ? "bad" : ""}`}>
                <span>{n} <Star size={11} fill="currentColor" /></span>
                <span className="wfb-dist-bar"><i style={{ width: `${(o.distribution[n] / maxDist) * 100}%` }} /></span>
                <b className="tabular">{o.distribution[n]}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="wx-sheet">
        <div className="fbt-tools">
          <div className="wfb-tabs" role="tablist">
            {REPLY_TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`${tab === t.key ? "on" : ""} ${t.key === "low" && (r?.counts.low ?? 0) > 0 ? "warn" : ""}`}>
                {t.label}<span className="tabular">{r?.counts?.[t.key] ?? "–"}</span>
              </button>
            ))}
          </div>
          <label className="wfb-search">
            <Search size={15} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search customer, task, helper or comment" />
          </label>
        </div>

        <ErrorNote error={list.error} />
        {!r && !list.error && <SkeletonRows rows={6} />}
        {r && r.items.length === 0 && (
          <div className="fbr-empty">
            <div className="fbr-empty-text">
              <MessageSquareQuote size={28} />
              <b>{tab === "received" ? "No replies yet" : "No replies here"}</b>
              <span>
                {tab === "received"
                  ? "Replies appear here as soon as customers submit the feedback form on WhatsApp. Activate the automation and connect Meta's webhook to start receiving them."
                  : "Nothing matches this filter yet."}
              </span>
            </div>
            {tab === "received" && <ul className="fbr-list fbr-list-one"><ReplyCard f={EXAMPLE_REPLY} example /></ul>}
          </div>
        )}
        {r && r.items.length > 0 && (
          <>
            <ul className="fbr-list">{r.items.map((f) => <ReplyCard key={f.id} f={f} />)}</ul>
            <div className="wfb-pager">
              <span className="tabular">{r.offset + 1}–{r.offset + r.items.length} of {r.total}</span>
              <button disabled={r.offset === 0} onClick={() => setOffset(Math.max(0, r.offset - r.limit))}>Newer</button>
              <button disabled={r.offset + r.items.length >= r.total} onClick={() => setOffset(r.offset + r.limit)}>Older</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ================================================================================================ Feedback Commercials page */

const COMM_PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;
type CommPeriod = (typeof COMM_PERIODS)[number]["key"];

const inr = (x: number | null | undefined) =>
  x == null ? "—" : "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function WaFeedbackCommercials() {
  const [period, setPeriod] = useUrlState<CommPeriod>("period", "month");
  const data = usePoll<FbCommercials>(api.whatsapp.feedbackCommercials, 60000);
  const r = data.data;
  const p = r?.periods[period];
  const max = Math.max(1, ...(r?.daily ?? []).map((d) => Math.max(d.sent, d.replies)));

  const funnel = p ? [
    { label: "Sent", n: p.sent, sub: "feedback forms", tone: "sent" },
    { label: "Delivered", n: p.delivered, sub: `${p.delivery_rate}% of sent`, tone: "del" },
    { label: "Read", n: p.read, sub: `${p.read_rate}% of delivered`, tone: "read" },
    { label: "Replied", n: p.replies, sub: `${p.reply_rate}% of sent`, tone: "rep" },
  ] : [];

  return (
    <div className="wx-page">
      <header className="wx-banner wfb-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Receipt size={13} /> Reviews &amp; Feedback</span>
            <h1>Feedback Commercials</h1>
            <p className="wfb-sub">What the WhatsApp feedback messages cost, and how many customers actually reply.</p>
          </div>
          <div className="wx-banner-tools">
            <div className="wx-pills" role="tablist" aria-label="Period">
              {COMM_PERIODS.map((x) => (
                <button key={x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
              ))}
            </div>
            <button className="wx-ghost wx-square" onClick={data.refresh} title="Refresh" aria-label="Refresh"><RefreshCw size={14} /></button>
          </div>
        </div>
        {p && (
          <div className="wx-figures wfb-figures">
            <div><span>Sending cost</span><b>{inr(p.cost)}</b><em>{p.sent} messages · {inr(p.cost_per_message)} each</em></div>
            <div><span>Feedback received</span><b>{p.replies}</b><em>{p.reply_rate}% of customers replied · free</em></div>
            <div><span>Cost per reply</span><b>{inr(p.cost_per_reply)}</b><em>what one review costs</em></div>
            <div><span>Low ratings found</span><b className={p.low ? "wfb-bad-n" : ""}>{p.low}</b><em>2 stars or less · follow up</em></div>
          </div>
        )}
      </header>

      <ErrorNote error={data.error} />
      {!r && !data.error && <div className="wx-sheet"><SkeletonRows rows={8} /></div>}

      {r && p && (
        <>
          {/* ---------------------------------------------------------------- 1. sending messages */}
          <section className="wx-sheet fbc-part">
            <div className="fbc-part-head">
              <span className="fbc-part-icon send"><Send size={18} /></span>
              <div>
                <h2>Sending messages</h2>
                <p>Feedback forms we send on WhatsApp · Utility template · {inr(r.rate_utility)} per message</p>
              </div>
              <span className="fbc-part-total"><small>Cost</small><b>{inr(p.cost)}</b></span>
            </div>
            <div className="fbc-kpis">
              <div><span>Sent</span><b className="tabular">{p.sent}</b><small>{inr(p.cost_per_message)} each</small></div>
              <div><span>Delivered</span><b className="tabular">{p.delivered}</b><small>{p.delivery_rate}% of sent</small></div>
              <div><span>Read</span><b className="tabular">{p.read}</b><small>{p.read_rate}% of delivered</small></div>
              <div className={p.not_charged ? "bad" : ""}><span>Not sent</span><b className="tabular">{p.not_charged}</b><small>refused by Meta · not charged</small></div>
            </div>
            <div className="fbc-funnel">
              {funnel.slice(0, 3).map((s, i) => (
                <div key={s.label} className="fbc-cell">
                  <div className={`fbc-step fbc-${s.tone}`}>
                    <b className="tabular">{s.n}</b>
                    <span>{s.label}</span>
                    <small>{s.sub}</small>
                    <i style={{ width: `${p.sent ? Math.max(4, (s.n / p.sent) * 100) : 0}%` }} />
                  </div>
                  {i < 2 && <ChevronRight size={18} className="fbc-arrow" />}
                </div>
              ))}
            </div>
            {p.sent > 0 && p.delivered === 0 && (
              <p className="fbc-note"><Clock3 size={13} /> Delivered and Read stay at 0 until Meta's webhook reaches the app.</p>
            )}
          </section>

          {/* ---------------------------------------------------------------- 2. feedback received */}
          <section className="wx-sheet fbc-part">
            <div className="fbc-part-head">
              <span className="fbc-part-icon recv"><Star size={18} /></span>
              <div>
                <h2>Feedback received</h2>
                <p>Customers' replies to the form · receiving replies is free on WhatsApp</p>
              </div>
              <span className="fbc-part-total"><small>Cost per reply</small><b>{inr(p.cost_per_reply)}</b></span>
            </div>
            <div className="fbc-kpis">
              <div><span>Replies</span><b className="tabular">{p.replies}</b><small>{p.reply_rate}% of sent replied</small></div>
              <div><span>Average rating</span><b className="tabular">{p.avg_rating ? p.avg_rating.toFixed(1) : "—"}</b><small><Stars value={p.avg_rating} size={11} /></small></div>
              <div><span>With concerns</span><b className="tabular">{p.with_concerns}</b><small>wrote something in the box</small></div>
              <div><span>Not replied</span><b className="tabular">{Math.max(0, p.sent - p.replies)}</b><small>sent, no answer</small></div>
            </div>
            <div className="fbc-groups">
              {([
                { k: "best", label: "😊 Best", range: "5–4★", n: p.best },
                { k: "good", label: "🙂 Good", range: "3★", n: p.good },
                { k: "worst", label: "😞 Worst", range: "≤2★", n: p.worst },
              ] as const).map((g) => (
                <div key={g.k} className={`fbc-group fbc-g-${g.k}`}>
                  <span>{g.label} <small>{g.range}</small></span>
                  <div className="fbc-group-bar"><i style={{ width: `${p.replies ? (g.n / p.replies) * 100 : 0}%` }} /></div>
                  <b className="tabular">{g.n}</b>
                </div>
              ))}
            </div>
            {p.replies > 0 && <p className="fbc-note"><Receipt size={13} /> {inr(p.cost)} spent on {p.sent} message(s) brought {p.replies} review(s): {inr(p.cost_per_reply)} per review.</p>}
          </section>

          {/* ---------------------------------------------------------------- 30 days */}
          <section className="wx-sheet">
            <div className="wx-sheet-head"><CalendarDays size={16} className="wfb-head-icon" /><h2>Last 30 days</h2>
              <span className="wx-sheet-aside fbc-legend"><i className="s" /> Messages sent <i className="r" /> Feedback received</span></div>
            <div className="fbc-bars" role="img" aria-label="Feedback messages sent and replies per day, last 30 days">
              {r.daily.map((d) => (
                <div key={d.date} className="fbc-bar" title={`${d.date}: ${d.sent} sent (${inr(d.cost)}), ${d.replies} replies`}>
                  <span className="s" style={{ height: `${(d.sent / max) * 100}%` }} />
                  <span className="r" style={{ height: `${(d.replies / max) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="fbc-axis"><span>{r.daily[0]?.date.slice(5)}</span><span>Today</span></div>
          </section>
        </>
      )}
    </div>
  );
}
