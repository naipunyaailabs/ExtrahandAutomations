import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Layers,
  LifeBuoy,
  MapPin,
  MessageCircle,
  PhoneCall,
  Search,
  Ticket as TicketIcon,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { fmtDateTime, fmtMoney, fmtRelative, fmtSlotParts } from "../format";
import { useUrlState } from "../hooks";
import type { FollowUp, Ticket } from "../types";
import { CallStart } from "./CallStart";
import { AnimatedNumber } from "./motion";
import { Empty, Phone as PhoneText, SkeletonRows, Tabs } from "./ui";
import "./task-board.css";

/**
 * The one task list used by both WhatsApp (Send Work Order) and Calling (Tickets & Tasks): same filters, same
 * sections, same row, so both pages always show the same tasks with the same data - including, per task, whether
 * the WhatsApp alert went out and whether helpers were called.
 */

type DateCat = "today" | "upcoming" | "overdue" | "past";

/** Calendar day (YYYY-MM-DD) of a timestamp in India time. */
const istDay = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

/** Completed or cancelled on ExtraHand (or closed by dispatch): nothing left to do. */
export const isClosedTicket = (t: Ticket) =>
  t.status === "completed" || t.status === "cancelled" || t.dispatch_status === "closed";

/** One status bucket per ticket: the ExtraHand outcome wins, otherwise the dispatch stage. */
export const statusBucket = (t: Ticket): string => {
  if (t.status === "completed") return "completed";
  if (t.status === "cancelled") return "cancelled";
  if (t.dispatch_status === "closed") return "completed";
  return t.dispatch_status || "new";
};

/** today / upcoming by schedule (India time); a past date is overdue until ExtraHand closes the task. */
export function dateCategory(t: Ticket): DateCat {
  const day = istDay(t.scheduled_at) || istDay(t.booked_at) || istDay(t.created_at);
  if (!day) return "past";
  const today = istDay(new Date().toISOString())!;
  if (day === today) return "today";
  if (day > today) return "upcoming";
  return isClosedTicket(t) ? "past" : "overdue";
}

/* ------------------------------------------------------------------------------------------------ cells */

function WorkStatus({ status }: { status: string | null }) {
  const s = (status || "open").toLowerCase();
  const [cls, dot, label] = s.includes("complete") || s.includes("done") ? ["status-completed", "green", "Completed"]
    : s.includes("progress") || s.includes("started") || s.includes("working") ? ["status-in-progress", "blue", "In Progress"]
    : s.includes("cancel") ? ["status-cancelled", "red", "Cancelled"]
    : s.includes("assign") ? ["status-assigned", "purple", "Assigned"]
    : ["status-open", "amber", "Open"];
  return (
    <span className={`task-status-pill ${cls}`} title={`ExtraHand work status: ${label}`}>
      <span className={`status-dot ${dot}`} />
      <span>{label}</span>
    </span>
  );
}

function FollowupCell({ fu }: { fu?: FollowUp | null }) {
  if (!fu) return <span className="tb-chip tb-none">— None</span>;
  const s = (fu.status || "").toLowerCase();
  if (s === "calling" || s === "active") {
    return <span className="tb-chip tb-live"><span className="live-dot" /> Calling…</span>;
  }
  if (s === "completed" || s === "done" || s === "confirmed") {
    return <span className="tb-chip tb-ok"><CheckCircle2 size={11} /> Confirmed</span>;
  }
  return (
    <span className="tb-chip tb-wait" title={`Reminder call due ${fmtDateTime(fu.due_at)}`}>
      <Clock size={11} /> Due {fmtRelative(fu.due_at)}
    </span>
  );
}

/** Did the WhatsApp task alert go out to the matching helpers, and did it arrive? */
function WhatsAppCell({ t }: { t: Ticket }) {
  const w = t.whatsapp;
  if (!w) return <span className="tb-chip tb-none" title="No WhatsApp task alert sent for this task">— Not sent</span>;
  if (w.no_match && !w.total) {
    return <span className="tb-chip tb-warn" title="No helper matched this service and location">No match</span>;
  }
  const sim = w.simulated ?? 0;
  const real = w.total - w.failed - sim; // went out to Meta
  const reached = w.delivered + w.read;
  const when = w.last_at ? ` · ${fmtDateTime(w.last_at)}` : "";
  const parts = [real && `${real} sent`, reached && `${reached} delivered`, w.read && `${w.read} read`,
    w.failed && `${w.failed} failed`, sim && `${sim} test only`].filter(Boolean).join(" · ");
  const [cls, label] = real > 0 ? ["tb-ok", `Sent to ${real}`]
    : w.failed > 0 ? ["tb-bad", `Failed (${w.failed})`]
    : ["tb-wait", `Test only (${sim})`];
  const sub = real > 0
    ? (reached ? `${reached} delivered${w.read ? ` · ${w.read} read` : ""}` : w.from_event ? "delivery not tracked" : "awaiting delivery")
      + (w.failed ? ` · ${w.failed} failed` : "")
    : w.failed > 0 ? "not delivered" : "test mode · reached nobody";
  return (
    <span className="tb-stack" title={`${parts}${when}`}>
      <span className={`tb-chip ${cls}`}><MessageCircle size={11} /> {label}</span>
      <span className="tb-sub">{sub}</span>
    </span>
  );
}

/** Dispatch calls to helpers: calling now, accepted, or how many were called. */
function CallsCell({ t }: { t: Ticket }) {
  const c = t.call_summary;
  if (t.active_call) {
    return (
      <span className="tb-stack">
        <span className="tb-chip tb-live"><span className="live-dot" /> Calling</span>
        <span className="tb-sub">{t.active_call.helper_name || "Helper"} {t.last_run ? `(${t.last_run.progress})` : ""}</span>
      </span>
    );
  }
  if (!c) {
    const why = t.dispatch_status === "escalated" ? "No helper to call" : "— Not called";
    return <span className={`tb-chip ${t.dispatch_status === "escalated" ? "tb-warn" : "tb-none"}`}>{why}</span>;
  }
  const label = c.accepted ? "Accepted" : `${c.placed} called`;
  return (
    <span className="tb-stack" title={`${c.placed} call(s), ${c.answered} answered${c.last_at ? ` · last ${fmtDateTime(c.last_at)}` : ""}`}>
      <span className={`tb-chip ${c.accepted ? "tb-ok" : c.answered ? "tb-wait" : "tb-none"}`}>
        <PhoneCall size={11} /> {label}
      </span>
      <span className="tb-sub">{c.answered} answered{c.accepted ? "" : c.last_outcome ? ` · ${c.last_outcome.replace(/_/g, " ")}` : ""}</span>
    </span>
  );
}

const VIA_LABEL: Record<string, string> = {
  extrahand: "On ExtraHand",
  call: "Via AI call",
  whatsapp: "Via WhatsApp",
};

/** Who has the task: helper + who assigned them (and whether ExtraHand has our assignment), or why nobody yet. */
function HelperCell({ t, cat, onOpenHelper, onOpenCare, onChanged }: {
  t: Ticket; cat: DateCat; onOpenHelper?: (name: string) => void; onOpenCare?: (id: string) => void; onChanged?: () => void;
}) {
  const [pushing, setPushing] = useState(false);
  if (cat === "past" && isClosedTicket(t) && !t.assignee) return <span className="tb-chip tb-none">Closed</span>;
  if (t.assignee) {
    const via = t.assigned_via || (t.assignment_local_only ? "call" : "extrahand");
    const ours = via !== "extrahand";
    const confirmed = !t.assignment_local_only || t.extrahand_push === "ok";
    const retry = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setPushing(true);
      try {
        await api.calling.pushAssignment(t.id);
      } catch (err) {
        window.alert(`ExtraHand update failed: ${(err as Error).message}`);
      } finally {
        setPushing(false);
        onChanged?.();
      }
    };
    return (
      <span className="tb-stack tb-helper" onClick={(e) => { if (onOpenHelper) { e.stopPropagation(); onOpenHelper(t.assignee?.name || ""); } }}
        title={onOpenHelper ? "View helper" : undefined}>
        <span className="tb-helper-name" title={t.assignee.name || ""}><CheckCircle2 size={13} /><span className="tb-ellipsis">{t.assignee.name || "Helper"}</span></span>
        <span className="tb-row-chips">
          <span className={`tb-chip ${ours ? "tb-ours" : "tb-eh"}`} title={t.assigned_at ? `Assigned ${fmtDateTime(t.assigned_at)}` : undefined}>
            {VIA_LABEL[via] || via}
          </span>
          {ours && (confirmed ? (
            <span className="tb-chip tb-ok" title="ExtraHand shows this helper too">✓ ExtraHand</span>
          ) : t.extrahand_push === "pending" ? (
            <span className="tb-chip tb-wait">Updating…</span>
          ) : (
            <button type="button" className="tb-chip tb-bad tb-btn" onClick={retry} disabled={pushing}
              title={`Not on ExtraHand${t.extrahand_push_error ? `: ${t.extrahand_push_error}` : ""}. Click to retry.`}>
              {pushing ? "Retrying…" : "Not on ExtraHand · Retry"}
            </button>
          ))}
        </span>
      </span>
    );
  }
  if (t.dispatch_status === "escalated") {
    return (
      <button type="button" className="tb-chip tb-bad tb-btn" title="Open the Customer Care case"
        onClick={(e) => { e.stopPropagation(); onOpenCare?.(t.id); }}>
        <LifeBuoy size={12} /> Customer Care
      </button>
    );
  }
  return <span className="tb-chip tb-warn"><AlertCircle size={12} /> Unassigned</span>;
}

/* ------------------------------------------------------------------------------------------------ board */

const KPI: { key: "all" | DateCat; label: string; badge: string; meta: string; color: string; Icon: typeof Layers }[] = [
  { key: "all", label: "All Tasks", badge: "All", meta: "Every real customer task", color: "#2563eb", Icon: Layers },
  { key: "today", label: "Current", badge: "Today", meta: "Scheduled for today", color: "#059669", Icon: Clock },
  { key: "upcoming", label: "Upcoming", badge: "Future", meta: "Scheduled for later dates", color: "#ea580c", Icon: Calendar },
  { key: "overdue", label: "Overdue", badge: "Needs action", meta: "Past · not completed", color: "#dc2626", Icon: AlertCircle },
  { key: "past", label: "Closed", badge: "Done", meta: "Past · completed or cancelled", color: "#16a34a", Icon: History },
];

const SECTIONS: { key: DateCat; title: string; note?: string; color: string }[] = [
  { key: "today", title: "Current Tasks", color: "#047857" },
  { key: "upcoming", title: "Upcoming Tasks", color: "#c2410c" },
  { key: "overdue", title: "Overdue Tasks", note: "Scheduled date has passed but the task is not completed on ExtraHand", color: "#b91c1c" },
  { key: "past", title: "Closed Tasks", note: "Completed or cancelled", color: "#15803d" },
];

interface TaskBoardProps {
  tickets: Ticket[] | null | undefined;
  /** Row click; defaults to the task's detail page. */
  onOpenTask?: (id: string) => void;
  onOpenHelper?: (name: string) => void;
  onOpenCare?: (ticketId: string) => void;
  onChanged?: () => void;
}

export function TaskBoard({ tickets, onOpenTask, onOpenHelper, onOpenCare, onChanged }: TaskBoardProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useUrlState<string>("q", "");
  const [dateFilter, setDateFilter] = useUrlState<"all" | DateCat>("date", "all");
  const [statusFilter, setStatusFilter] = useUrlState<string>("status", "");
  const [dayKey, setDayKey] = useState(() => istDay(new Date().toISOString()));

  // Re-bucket at midnight (India time) without a reload
  useEffect(() => {
    const id = setInterval(() => setDayKey(istDay(new Date().toISOString())), 30000);
    return () => clearInterval(id);
  }, []);

  const all = tickets ?? [];
  const cats = useMemo(() => new Map(all.map((t) => [t.id, dateCategory(t)])), [all, dayKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, today: 0, upcoming: 0, overdue: 0, past: 0 };
    for (const t of all) c[cats.get(t.id)!] += 1;
    return c;
  }, [all, cats]);

  const statusTabs = useMemo(() => {
    const n: Record<string, number> = {};
    for (const t of all) n[statusBucket(t)] = (n[statusBucket(t)] ?? 0) + 1;
    return [
      { key: "", label: "All Status", count: all.length },
      { key: "new", label: "Unassigned", count: n.new ?? 0 },
      { key: "dispatching", label: "Calling", count: n.dispatching ?? 0 },
      { key: "assigned", label: "Assigned", count: n.assigned ?? 0 },
      { key: "escalated", label: "Escalated", count: n.escalated ?? 0 },
      { key: "completed", label: "Completed", count: n.completed ?? 0 },
      { key: "cancelled", label: "Cancelled", count: n.cancelled ?? 0 },
    ].filter((tab) => ["", "new", "assigned", "completed"].includes(tab.key) || tab.count > 0);
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((t) => dateFilter === "all" || cats.get(t.id) === dateFilter)
      .filter((t) => !statusFilter || statusBucket(t) === statusFilter)
      .filter((t) => !q || [t.id, t.title, t.category, t.customer?.name, t.customer?.phone, t.address, t.city, t.assignee?.name]
        .some((v) => v && String(v).toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.scheduled_at || b.created_at || 0).getTime() - new Date(a.scheduled_at || a.created_at || 0).getTime());
  }, [all, cats, dateFilter, statusFilter, search]);

  const open = (id: string) => (onOpenTask ? onOpenTask(id) : navigate(`/tickets/${encodeURIComponent(id)}`));

  // Whether new tasks get WhatsApp alerts / helper calls right now: explains a "Not sent" / "Not called"
  const [live, setLive] = useState<Awaited<ReturnType<typeof api.calling.outreachStatus>> | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => api.calling.outreachStatus().then((s) => on && setLive(s)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { on = false; clearInterval(id); };
  }, []);

  const row = (t: Ticket) => {
    const cat = cats.get(t.id)!;
    return (
      <div key={t.id} className={`tb-row tb-${cat}`} role="link" tabIndex={0} title="Open task"
        onClick={() => open(t.id)} onKeyDown={(e) => { if (e.key === "Enter") open(t.id); }}>
        <div className="tb-cell tb-task">
          <span className="tb-title">{t.title || "Customer Task"}</span>
          <span className="tb-meta">
            <span className="task-category-tag">{t.category || "Service"}</span>
            <span className="mono muted">#{t.id.slice(-6)}</span>
            <b className="tb-budget">{t.budget && t.budget > 0 ? fmtMoney(t.budget) : "—"}</b>
          </span>
        </div>
        <div className="tb-cell tb-stack">
          <span className="tb-strong" title={t.customer?.name || ""}><User size={12} /><span className="tb-ellipsis">{t.customer?.name || "Customer"}</span></span>
          {t.customer?.phone && <span className="tb-sub" onClick={(e) => e.stopPropagation()}><PhoneText value={t.customer.phone} /></span>}
        </div>
        <div className="tb-cell tb-stack">
          <span className="tb-strong" title={t.address || ""}><MapPin size={12} /><span className="tb-ellipsis">{t.city || t.address || "Location not set"}</span></span>
          <WhenBlock t={t} />
          <CallStart ticket={t} />
        </div>
        <div className="tb-cell"><WorkStatus status={t.status} /></div>
        <div className="tb-cell"><WhatsAppCell t={t} /></div>
        <div className="tb-cell"><CallsCell t={t} /></div>
        <div className="tb-cell"><FollowupCell fu={t.next_followup} /></div>
        <div className="tb-cell">
          <HelperCell t={t} cat={cat} onOpenHelper={onOpenHelper} onOpenCare={onOpenCare} onChanged={onChanged} />
        </div>
      </div>
    );
  };

  return (
    <div className="task-board">
      <div className="tb-kpis" role="tablist" aria-label="Filter by date">
        {KPI.map(({ key, label, meta, color, Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={dateFilter === key} title={meta}
            className={`tb-kpi ${dateFilter === key ? "is-active" : ""}`}
            style={{ ["--kpi" as string]: color }}
            onClick={() => setDateFilter(key)}>
            <span className="tb-kpi-icon"><Icon size={15} /></span>
            <span className="tb-kpi-text">
              <span className="tb-kpi-label">{label}</span>
              <span className="tb-kpi-meta">{meta}</span>
            </span>
            <span className="tb-kpi-value"><AnimatedNumber value={counts[key]} /></span>
          </button>
        ))}
      </div>

      <div className="tb-toolbar">
        <label className="search tb-search">
          <Search size={16} className="search-icon" />
          <input placeholder="Search task, customer, phone, area, helper…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="tb-tabs"><Tabs value={statusFilter} onChange={setStatusFilter} items={statusTabs} /></div>
        {live && (
          <div className="tb-channels" title="For new tasks right now. While a channel is OFF, new tasks show “Not sent” / “Not called”.">
            <span className={`tb-chip ${live.whatsapp_on ? (live.whatsapp_test_mode ? "tb-wait" : "tb-ok") : "tb-bad"}`}>
              <MessageCircle size={11} /> WhatsApp {live.whatsapp_on ? (live.whatsapp_test_mode ? "test mode" : "ON") : "OFF"}
            </span>
            <span className={`tb-chip ${live.calls_on ? (live.calling_hours_open ? "tb-ok" : "tb-wait") : "tb-bad"}`}>
              <PhoneCall size={11} /> Calls {live.calls_on ? (live.calling_hours_open ? "ON" : "after hours") : "OFF"}
            </span>
          </div>
        )}
      </div>

      {!tickets ? (
        <SkeletonRows rows={4} />
      ) : filtered.length === 0 ? (
        <div className="tb-empty"><Empty icon={TicketIcon}>No tasks match the selected filters.</Empty></div>
      ) : (
        <div className="tb-scroll">
          {SECTIONS.filter((s) => dateFilter === "all" || dateFilter === s.key).map((s) => {
            const list = filtered.filter((t) => cats.get(t.id) === s.key);
            if (!list.length) return null;
            return (
              <section key={s.key} className="tb-section">
                <div className="tb-section-title" style={{ color: s.color }}>
                  {s.title} <span className="tb-count" style={{ borderColor: s.color }}>{list.length}</span>
                  {s.note && <span className="tb-note">{s.note}</span>}
                </div>
                <div className="tb-row tb-head">
                  <div>Task &amp; Service</div><div>Customer</div><div>Where &amp; When</div><div>Work Status</div>
                  <div>WhatsApp</div><div>Calls</div><div>Follow-up</div><div>Helper</div>
                </div>
                {list.map(row)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Where & When: task day, start–end time and when the customer booked, each on its own line. */
function WhenBlock({ t }: { t: Ticket }) {
  const { day, time } = fmtSlotParts(t.scheduled_at, t.scheduled_end_at);
  const booked = t.booked_at || t.created_at;
  return (
    <span className="tb-when" title="Task time (India)">
      <span className="tb-when-day"><Calendar size={11} /> {day}</span>
      {time && <span className="tb-when-time"><Clock size={11} /> {time}</span>}
      {booked && <span className="tb-when-booked">Booked {fmtDateTime(booked)}</span>}
    </span>
  );
}
