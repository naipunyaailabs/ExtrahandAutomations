import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Hand,
  Inbox,
  MapPin,
  MessageSquareWarning,
  Phone as PhoneIcon,
  PhoneOutgoing,
  Search,
  SearchX,
  Tag,
  UserRound,
  UsersRound,
  UserX,
  Wrench,
  XCircle,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, useToastAction } from "../components/ui";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import { usePoll, useUrlState } from "../hooks";
import type { Escalation } from "../types";
import "./customer-care.css";

export const REASONS: Record<string, { label: string; icon: LucideIcon; helperRelated: boolean }> = {
  no_helper_accepted: { label: "No helper accepted", icon: UsersRound, helperRelated: true },
  no_eligible_helpers: { label: "No eligible helpers nearby", icon: SearchX, helperRelated: true },
  helper_cannot_attend: { label: "Helper cannot attend", icon: UserX, helperRelated: true },
  helper_unconfirmed: { label: "Helper did not confirm", icon: Clock3, helperRelated: true },
  customer_complaint: { label: "Customer complaint", icon: MessageSquareWarning, helperRelated: false },
  // WhatsApp Support (whatsapp/support/tickets.py)
  whatsapp_cancel_request: { label: "WhatsApp · Cancellation request", icon: MessageCircle, helperRelated: false },
  whatsapp_reschedule_request: { label: "WhatsApp · Reschedule request", icon: MessageCircle, helperRelated: false },
  whatsapp_helper_issue: { label: "WhatsApp · Helper problem", icon: MessageCircle, helperRelated: false },
  whatsapp_payment_issue: { label: "WhatsApp · Payment problem", icon: MessageCircle, helperRelated: false },
  whatsapp_incomplete_service: { label: "WhatsApp · Service not completed", icon: MessageCircle, helperRelated: false },
  whatsapp_refund_request: { label: "WhatsApp · Refund request", icon: MessageCircle, helperRelated: false },
  whatsapp_human_request: { label: "WhatsApp · Asked for a person", icon: MessageCircle, helperRelated: false },
  whatsapp_unresolved: { label: "WhatsApp · AI could not answer", icon: MessageCircle, helperRelated: false },
  whatsapp_other: { label: "WhatsApp · Other", icon: MessageCircle, helperRelated: false },
};
const isWhatsApp = (e: Escalation) => (e.source ?? "").startsWith("whatsapp");
const reasonOf = (r: string) =>
  REASONS[r] ?? { label: r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), icon: Inbox, helperRelated: false };

const STATUS: Record<Escalation["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "open" },
  in_progress: { label: "In progress", tone: "progress" },
  resolved: { label: "Resolved", tone: "done" },
};

type Filter = "active" | "open" | "in_progress" | "resolved" | "all";

const age = (iso: string) => {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

/** Customer Care: the cases the calling agent could not finish on its own, as an inbox (list + case panel). */
export function CustomerCareView({ escalations, loading, onChange }: { escalations: Escalation[]; loading?: boolean; onChange: () => void }) {
  const [filter, setFilter] = useUrlState<Filter>("care", "active");
  const [q, setQ] = useUrlState<string>("cq", "");
  const [selectedId, setSelectedId] = useUrlState<string>("case", "");

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, resolved: 0 };
    for (const e of escalations) c[e.status]++;
    return c;
  }, [escalations]);
  const oldestOpen = useMemo(
    () => escalations.filter((e) => e.status !== "resolved").sort((a, b) => a.created_at.localeCompare(b.created_at))[0],
    [escalations],
  );

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rank = { open: 0, in_progress: 1, resolved: 2 };
    return escalations
      .filter((e) =>
        filter === "all" ? true : filter === "active" ? e.status !== "resolved" : e.status === filter)
      .filter((e) => {
        if (!query) return true;
        const t = e.ticket;
        return [t?.id, t?.title, t?.customer?.name, t?.customer?.phone, t?.category, t?.city, t?.address,
          t?.assignee?.name, e.reason, reasonOf(e.reason).label, e.notes, e.details, e.assigned_to]
          .some((v) => v && String(v).toLowerCase().includes(query));
      })
      // open first, then in progress, then resolved; the longest-waiting first
      .sort((a, b) => rank[a.status] - rank[b.status] ||
        (a.status === "resolved" ? (b.resolved_at ?? "").localeCompare(a.resolved_at ?? "") : a.created_at.localeCompare(b.created_at)));
  }, [escalations, filter, q]);

  const selected = list.find((e) => String(e.id) === selectedId) ?? list[0];
  useEffect(() => {
    if (selected && String(selected.id) !== selectedId) setSelectedId(String(selected.id));
  }, [selected, selectedId, setSelectedId]);

  const tabs: { k: Filter; label: string; n?: number }[] = [
    { k: "active", label: "To do", n: counts.open + counts.in_progress },
    { k: "open", label: "Open", n: counts.open },
    { k: "in_progress", label: "In progress", n: counts.in_progress },
    { k: "resolved", label: "Resolved", n: counts.resolved },
    { k: "all", label: "All", n: escalations.length },
  ];

  return (
    <div className="cc">
      <div className="cc-stats">
        <Stat tone="open" label="Open" value={counts.open} sub="nobody has taken these" />
        <Stat tone="progress" label="In progress" value={counts.in_progress} sub="someone is on it" />
        <Stat tone="done" label="Resolved" value={counts.resolved} sub="closed cases" />
        <Stat tone="age" label="Oldest waiting" value={oldestOpen ? age(oldestOpen.created_at).replace("d", " days").replace("h", " hours").replace("m", " min") : "—"}
          sub={oldestOpen ? (oldestOpen.ticket?.title ?? reasonOf(oldestOpen.reason).label) : "nothing waiting"} />
      </div>

      <div className="cc-tools">
        <label className="cc-search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, phone, task, helper or notes" />
        </label>
        <div className="cc-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.k} role="tab" aria-selected={filter === t.k} className={filter === t.k ? "on" : ""} onClick={() => setFilter(t.k)}>
              {t.label}<span>{t.n}</span>
            </button>
          ))}
        </div>
      </div>

      {loading && !escalations.length ? (
        <div className="cc-empty"><Clock3 size={26} /><b>Loading cases…</b></div>
      ) : list.length === 0 ? (
        <div className="cc-empty">
          <CheckCircle2 size={30} />
          <b>{q || filter !== "active" ? "No cases match" : "All clear"}</b>
          <span>{q || filter !== "active" ? "Try another search or filter." : "Every task is placed with a helper. New cases appear here on their own."}</span>
        </div>
      ) : (
        <div className="cc-body">
          <div className="cc-list" role="listbox" aria-label="Cases">
            {list.map((e) => {
              const R = reasonOf(e.reason);
              return (
                <button key={e.id} role="option" aria-selected={selected?.id === e.id}
                  className={`cc-row s-${STATUS[e.status].tone} ${selected?.id === e.id ? "on" : ""}`} onClick={() => setSelectedId(String(e.id))}>
                  <span className="cc-row-icon"><R.icon size={16} /></span>
                  <span className="cc-row-main">
                    <b>{e.ticket?.title ?? (isWhatsApp(e) ? (e.customer_name || `+${e.customer_phone ?? ""}`) : `Task ${e.ticket_id}`)}</b>
                    <small>{R.label}{e.ticket?.customer?.name ? ` · ${e.ticket.customer.name}` : ""}{e.source === "whatsapp_test" ? " · test" : ""}</small>
                  </span>
                  <span className="cc-row-side">
                    <span className={`cc-dot s-${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
                    <small title={fmtDateTime(e.created_at)}>{age(e.created_at)} ago</small>
                  </span>
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait">
            {selected && <CasePanel key={selected.id} esc={selected} onChange={onChange} />}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function Stat({ tone, label, value, sub }: { tone: string; label: string; value: number | string; sub: string }) {
  return (
    <div className={`cc-stat t-${tone}`}>
      <span>{label}</span>
      <b className="tabular">{value}</b>
      <small title={sub}>{sub}</small>
    </div>
  );
}

function CasePanel({ esc, onChange }: { esc: Escalation; onChange: () => void }) {
  const t = esc.ticket;
  const R = reasonOf(esc.reason);
  const [notes, setNotes] = useState(esc.notes ?? "");
  const [owner, setOwner] = useState(esc.assigned_to ?? "");
  const action = useToastAction();
  const dirty = notes !== (esc.notes ?? "") || owner !== (esc.assigned_to ?? "");
  const scheduledPast = t?.scheduled_at ? new Date(t.scheduled_at).getTime() < Date.now() : false;

  const team = usePoll(api.careTeam, 60000);
  const update = (status?: Escalation["status"], outcome?: "achieved" | "rejected") =>
    action.run(async () => {
      await api.updateEscalation(esc.id, { status, outcome, notes, assigned_to: owner });
      onChange();
    }, status === "resolved" ? (outcome === "rejected" ? "Case closed as not solved" : "Case solved")
      : status === "in_progress" ? "You're on it" : "Notes saved");

  return (
    <motion.section className="cc-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <header className="cc-panel-head">
        <span className={`cc-panel-icon s-${STATUS[esc.status].tone}`}><R.icon size={20} /></span>
        <div>
          <h2>{R.label}</h2>
          <small>Case #{esc.id} · raised {fmtRelative(esc.created_at)} · {fmtDateTime(esc.created_at)}</small>
        </div>
        <span className={`cc-dot big s-${STATUS[esc.status].tone}`}>{STATUS[esc.status].label}</span>
      </header>

      {esc.details && <p className="cc-what"><b>What happened</b>{esc.details}</p>}

      {!t && isWhatsApp(esc) && (
        <dl className="cc-facts">
          <div><dt><UserRound size={13} /> Customer</dt><dd>{esc.customer_name || "—"}{esc.customer_phone ? <> · <a href={`tel:+${esc.customer_phone.replace(/^t/, "")}`}>+{esc.customer_phone.replace(/^t/, "")}</a></> : null}</dd></div>
          {esc.booking_id && <div><dt><Tag size={13} /> Booking</dt><dd>{esc.booking_id}</dd></div>}
          {esc.conversation_id && (
            <div><dt><MessageCircle size={13} /> WhatsApp</dt><dd><Link to={`/engagement/support/conversations?c=${esc.conversation_id}`}>Open the chat</Link></dd></div>
          )}
        </dl>
      )}

      {t && (
        <>
          <div className="cc-people">
            <Person role="Customer" icon={UserRound} name={t.customer?.name} phone={t.customer?.phone} />
            <Person role="Helper" icon={Wrench} name={t.assignee?.name} phone={t.assignee?.phone} empty="No helper assigned" />
          </div>
          <dl className="cc-facts">
            <div><dt><Tag size={13} /> Task</dt><dd><Link to={`/tickets/${encodeURIComponent(t.id)}`}>{t.title ?? t.id}</Link></dd></div>
            <div><dt><Wrench size={13} /> Service</dt><dd>{t.category ?? "—"} · {fmtMoney(t.budget)}</dd></div>
            <div>
              <dt><CalendarClock size={13} /> Scheduled</dt>
              <dd>{fmtDateTime(t.scheduled_at)} <span className={scheduledPast ? "cc-late" : "cc-muted"}>({fmtRelative(t.scheduled_at)})</span></dd>
            </div>
            <div><dt><MapPin size={13} /> Location</dt><dd>{[t.address, t.city].filter(Boolean).join(", ") || "—"}</dd></div>
          </dl>
        </>
      )}

      {esc.status === "resolved" ? (
        <div className={`cc-resolved ${esc.outcome === "rejected" ? "rejected" : ""}`}>
          {esc.outcome === "rejected" ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <b>{esc.outcome === "rejected" ? "Closed, not solved" : "Solved"} {fmtRelative(esc.resolved_at)}{esc.assigned_to ? ` by ${esc.assigned_to}` : ""}</b>
            {esc.notes && <p>{esc.notes}</p>}
          </div>
        </div>
      ) : (
        <div className="cc-act">
          <div className="cc-act-row">
            {esc.status === "open" && (
              <Button icon={Hand} disabled={action.busy} onClick={() => update("in_progress")}>Take it</Button>
            )}
            {R.helperRelated && (
              <Button variant="primary" icon={PhoneOutgoing} disabled={action.busy}
                onClick={() => action.run(async () => { await api.redispatch(esc.id); onChange(); }, "Calling helpers again")}>
                Call helpers again
              </Button>
            )}
            <span className="cc-spacer" />
            <Button icon={XCircle} disabled={action.busy} onClick={() => update("resolved", "rejected")}
              title="Close the case without a solution (customer declined, could not be done)">Not solved</Button>
            <Button variant="success" icon={CheckCircle2} disabled={action.busy} onClick={() => update("resolved", "achieved")}>Solved</Button>
          </div>
          <div className="cc-notes">
            <input placeholder="Handled by (pick a team member or type a name)" value={owner} onChange={(e) => setOwner(e.target.value)} list={`cc-team-${esc.id}`} />
            <datalist id={`cc-team-${esc.id}`}>{(team.data ?? []).map((m) => <option key={m.id} value={m.name} />)}</datalist>
            <textarea placeholder="Notes: what was done, who was called…" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="cc-notes-foot">
              <small>{dirty ? "Unsaved changes" : esc.notes ? "Notes saved" : "Notes are saved with the case"}</small>
              <Button size="sm" disabled={action.busy || !dirty} onClick={() => update()}>Save notes</Button>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function Person({ role, icon: Icon, name, phone, empty }: { role: string; icon: LucideIcon; name?: string | null; phone?: string | null; empty?: string }) {
  return (
    <div className="cc-person">
      <span className="cc-person-icon"><Icon size={16} /></span>
      <div className="cc-person-main">
        <small>{role}</small>
        <b>{name || empty || "—"}</b>
        {phone && <span className="mono">{phone}</span>}
      </div>
      {phone && (
        <a className="cc-call" href={`tel:${phone}`} title={`Call ${name ?? role.toLowerCase()}`}>
          <PhoneIcon size={14} /> Call
        </a>
      )}
    </div>
  );
}

/** Stand-alone page (same view, with its own data). */
export default function CustomerCare() {
  const { data, refresh } = usePoll(() => api.escalations(), 4000);
  return <div className="page"><CustomerCareView escalations={data ?? []} loading={!data} onChange={refresh} /></div>;
}
