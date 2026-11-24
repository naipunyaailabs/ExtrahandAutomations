import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, CalendarRange, CheckCircle2, Pencil, Clock3, Hand, Inbox, LifeBuoy, Loader2, Phone, Plus, RefreshCw, Table2, UserX,
  UsersRound, X, XCircle,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/ui";
import { usePoll } from "../hooks";
import type { CareStats, Escalation } from "../types";
import { CardHead, Kpi, Skeleton, fmtTime, istDay, n } from "./EngagementKit";
import "./care-dashboard.css";

/** Calling Agent → Customer Care → Dashboard: how many customer care cases (tasks the calling agent handed to people)
 * came in, were done (solved = achieved, closed without a solution = rejected) and are still pending, today / this week
 * / this month / all time; what is waiting right now; and the team around a round table, with a + seat to add a
 * person. Backend: app/api/escalations.py (/api/escalations/stats, /api/care-team). */

type PeriodKey = "today" | "week" | "month" | "all";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "all", label: "All time" },
];
const CASES = "/calling/care";
const TEAM = "/calling/care/team";

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};
function waitingFor(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
}

export function CareDashboardPage() {
  const data = usePoll<CareStats>(api.careStats, 15000);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const d = data.data;

  if (!d) {
    return (
      <div className="cw-page care-page">
        {data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading customer care…</>} />}
      </div>
    );
  }
  const p = d.periods[period];
  const label = PERIODS.find((x) => x.key === period)!.label;

  return (
    <div className="cw-page care-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><LifeBuoy size={13} /> Calling Agent · Customer Care</span>
            <h1>Customer Care Dashboard</h1>
            <p>Cases the calling agent handed to the team: how many came in, were solved or not, and what is still waiting.</p>
          </div>
          <div className="cw-head-tools">
            <span className="cw-updated">Live · refreshes every 15 seconds</span>
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <div className="cw-controls">
          <div className="cw-pills" role="tablist" aria-label="Period">
            <CalendarRange size={14} />
            {PERIODS.map((x) => (
              <button key={x.key} role="tab" aria-selected={period === x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
            ))}
          </div>
          <Link className="cx-link" to={CASES}>Open the cases <ArrowRight size={13} /></Link>
        </div>
      </header>

      <div className="care-kpis">
        <Kpi lead icon={Inbox} label={`Calls received · ${label}`} value={n(p.received)} sub="cases handed to customer care" />
        <Kpi icon={CheckCircle2} label="Done" value={n(p.done)} sub={`cases closed ${label.toLowerCase()}`} />
        <Kpi icon={Clock3} label="Pending" value={n(p.pending)} sub={`of the ${n(p.received)} received, not closed yet`} />
        <Kpi icon={Hand} label="Achieved" value={n(p.achieved)} color="var(--cw-green)"
          sub={p.achieved_rate === null ? "solved by customer care" : `solved · ${p.achieved_rate}% of the cases done`} />
        <Kpi icon={UserX} label="Rejected" value={n(p.rejected)} color="#dc2626" sub="closed without a solution" />
      </div>

      <div className="cw-row">
        <section className="cw-card">
          <CardHead icon={Table2} title="Today, this week, this month" note="click a period to see it above" />
          <div className="cw-scroll">
            <table className="care-matrix">
              <thead>
                <tr><th />{PERIODS.map((x) => <th key={x.key} className={period === x.key ? "on" : ""}><button onClick={() => setPeriod(x.key)}>{x.label}</button></th>)}</tr>
              </thead>
              <tbody>
                {([["Calls received", "received"], ["Done", "done"], ["Achieved (solved)", "achieved"], ["Rejected (not solved)", "rejected"], ["Pending", "pending"]] as const)
                  .map(([name, k]) => (
                    <tr key={k} className={k}>
                      <th scope="row">{name}</th>
                      {PERIODS.map((x) => <td key={x.key} className={`tabular ${period === x.key ? "on" : ""}`}>{n(d.periods[x.key][k])}</td>)}
                    </tr>
                  ))}
                <tr className="rate">
                  <th scope="row">Achieved rate</th>
                  {PERIODS.map((x) => <td key={x.key} className={`tabular ${period === x.key ? "on" : ""}`}>{d.periods[x.key].achieved_rate === null ? "—" : `${d.periods[x.key].achieved_rate}%`}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="cw-card">
          <CardHead icon={Clock3} title="Waiting right now" />
          <ul className="care-now">
            <li><span>Open, nobody on it</span><b className={`tabular ${d.now.open ? "warn" : ""}`}>{n(d.now.open)}</b></li>
            <li><span>In progress</span><b className="tabular">{n(d.now.in_progress)}</b></li>
            <li><span>Not assigned to anyone</span><b className={`tabular ${d.now.unassigned ? "warn" : ""}`}>{n(d.now.unassigned)}</b></li>
            <li><span>Oldest waiting for</span><b className="tabular">{waitingFor(d.now.oldest_waiting_since)}</b></li>
          </ul>
          <Link className="cx-link" to={CASES}>Go to the cases <ArrowRight size={13} /></Link>
        </section>
      </div>

      <section className="cw-card care-team-link">
        <CardHead icon={UsersRound} title="Customer care team" note={`${n(d.members.length)} ${d.members.length === 1 ? "person" : "people"}`}>
          <Link className="cx-link" to={TEAM}>Open Care Team <ArrowRight size={13} /></Link>
        </CardHead>
      </section>
    </div>
  );
}

/** Calling Agent → Customer Care → Care Team: the round table, the picked person's status, add / edit / remove. */
export function CareTeamPage() {
  const data = usePoll<CareStats>(api.careStats, 15000);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const d = data.data;
  if (!d) {
    return (
      <div className="cw-page care-page">
        {data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading the team…</>} />}
      </div>
    );
  }
  return (
    <div className="cw-page care-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><LifeBuoy size={13} /> Calling Agent · Customer Care</span>
            <h1>Care Team</h1>
            <p>The people who handle customer care cases. Click a person to see their status; add, edit or remove people here.</p>
          </div>
          <div className="cw-head-tools">
            <span className="cw-updated">Live · refreshes every 15 seconds</span>
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
      </header>

      <RoundTable members={d.members} onAdd={() => setAdding(true)} onEdit={setEditing} onChange={data.refresh} />

      <AnimatePresence>
        {(adding || editing) && (
          <MemberDialog key={editing?.id ?? "new"} member={editing}
            onClose={() => { setAdding(false); setEditing(null); }}
            onSaved={() => { setAdding(false); setEditing(null); data.refresh(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

type Member = CareStats["members"][number];

/** The team around a round table (60% of the card) with the picked person's status beside it (40%).
 * "Add a person" sits in the card header, not in the circle. */
function RoundTable({ members, onAdd, onEdit, onChange }: {
  members: Member[]; onAdd: () => void; onEdit: (m: Member) => void; onChange: () => void;
}) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  const picked = members.find((m) => m.id === pickedId) ?? members[0] ?? null;
  const working = members.reduce((a, m) => a + m.working_on, 0);
  const cases = usePoll(() => api.escalations(), 30000);
  const loaded = Array.isArray(cases.data);
  const key = picked?.name.trim().toLowerCase();
  const mine = (Array.isArray(cases.data) ? cases.data : [])
    .filter((e) => (e.assigned_to ?? "").trim().toLowerCase() === key)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section className="cw-card care-team">
      <CardHead icon={UsersRound} title="Customer care team"
        note={`${n(members.length)} ${members.length === 1 ? "person" : "people"} · click a person to see their status`}>
        <button className="cw-btn primary" onClick={onAdd}><Plus size={13} /> Add a person</button>
      </CardHead>
      <div className="care-team-grid">
        <div className="care-table-wrap">
          <div className="care-table">
            {/* spokes from the table to each seat; the picked person's spoke glows */}
            <svg className="care-spokes" viewBox="0 0 100 100" aria-hidden>
              <circle className="care-orbit" cx="50" cy="50" r="58" />
              {members.map((m, i) => {
                const rad = ((i / members.length) * 360 - 90) * (Math.PI / 180);
                const on = picked?.id === m.id;
                return (
                  <line key={m.id} className={on ? "on" : ""} x1={50 + 27 * Math.cos(rad)} y1={50 + 27 * Math.sin(rad)}
                    x2={50 + 50 * Math.cos(rad)} y2={50 + 50 * Math.sin(rad)} />
                );
              })}
            </svg>
            <motion.div className="care-table-top" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 20 }}>
              <span className="care-table-icon"><LifeBuoy size={18} /></span>
              <b>Customer Care</b>
              <span><b className="tabular">{n(members.length)}</b> in the team</span>
              <span><b className="tabular">{n(working)}</b> {working === 1 ? "case" : "cases"} active</span>
            </motion.div>
            {members.map((m, i) => {
              const angle = (i / members.length) * 360 - 90;
              const on = picked?.id === m.id;
              return (
                <div key={m.id} className="care-seat" style={{ ["--a" as string]: `${angle}deg` }}>
                  <div className="care-pos">
                    <motion.button type="button" className={`care-person ${on ? "on" : ""}`} onClick={() => setPickedId(m.id)}
                      aria-pressed={on} initial={{ opacity: 0, scale: 0.6, y: 8 }} animate={{ opacity: 1, scale: on ? 1.06 : 1, y: 0 }}
                      whileHover={{ y: -4, scale: on ? 1.08 : 1.05, transition: { duration: 0.15 } }}
                      whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
                      transition={{ type: "spring", stiffness: 320, damping: 22, delay: i * 0.05 }}>
                      <span className="care-avatar">
                        {initials(m.name)}
                        {m.working_on > 0 && <i className="care-busy-dot" title="On a case" />}
                      </span>
                      <b title={m.name}>{m.name}</b>
                      <span className="care-person-stats">
                        <span title="Cases being worked on"><Clock3 size={10} /> {n(m.working_on)}</span>
                        <span className="ok" title="Solved"><CheckCircle2 size={10} /> {n(m.achieved)}</span>
                        <span className="bad" title="Not solved"><XCircle size={10} /> {n(m.rejected)}</span>
                      </span>
                    </motion.button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <AnimatePresence mode="wait">
          <PersonPanel key={picked?.id ?? "none"} member={picked} mine={mine} loaded={loaded} onAdd={onAdd} onEdit={onEdit}
            onChange={() => { setPickedId(null); onChange(); }} />
        </AnimatePresence>
      </div>
      <AnimatePresence mode="wait">
        {picked && <PersonActivity key={picked.id} name={picked.name} mine={mine} loaded={loaded} />}
      </AnimatePresence>
      <p className="cw-chart-foot">
        Cases are counted for a person when the case's "Handled by" is their name (pick it from the list on a case).
        Updated {fmtTime(new Date().toISOString())}.
      </p>
    </section>
  );
}

/** The picked person's status: their numbers and latest cases. */
function PersonPanel({ member, mine, loaded, onAdd, onEdit, onChange }: {
  member: Member | null; mine: Escalation[]; loaded: boolean; onAdd: () => void; onEdit: (m: Member) => void; onChange: () => void;
}) {
  const toast = useToast();
  if (!member) {
    return (
      <aside className="care-panel care-panel-empty">
        <UsersRound size={26} />
        <b>No one in the team yet</b>
        <span>Add the people who handle customer care cases.</span>
        <button className="cw-btn primary" onClick={onAdd}><Plus size={13} /> Add a person</button>
      </aside>
    );
  }
  const done = member.achieved + member.rejected;
  const rate = done ? Math.round((100 * member.achieved) / done) : null;
  const remove = async () => {
    if (!window.confirm(`Remove ${member.name} from the customer care team? Their cases stay as they are.`)) return;
    try {
      await api.removeCareMember(member.id);
      toast.success(`${member.name} removed from the team`);
      onChange();
    } catch (e) {
      toast.error("Could not remove", (e as Error).message);
    }
  };
  return (
    <motion.aside className="care-panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.22, ease: "easeOut" }}>
      <header className="care-panel-head">
        <span className="care-avatar big">{initials(member.name)}</span>
        <div>
          <b title={member.name}>{member.name}</b>
          {member.role && <small>{member.role}</small>}
          {member.phone && <a href={`tel:${member.phone}`} className="care-phone"><Phone size={11} /> {member.phone}</a>}
        </div>
        <span className={`care-state ${member.working_on ? "busy" : ""}`}>{member.working_on ? "On a case" : "Free"}</span>
      </header>
      <div className="care-panel-stats">
        {([
          ["Working on", member.working_on, "", Clock3], ["Solved", member.achieved, "ok", CheckCircle2],
          ["Not solved", member.rejected, "bad", XCircle], ["Total cases", member.assigned, "", Inbox],
        ] as const).map(([label, v, tone, Icon], i) => (
          <motion.div key={label} className={tone} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.04, duration: 0.2 }}>
            <span><Icon size={12} /> {label}</span><b className="tabular">{n(v)}</b>
          </motion.div>
        ))}
      </div>
      <div className="care-rate">
        <div className="care-rate-top"><span>Solved rate</span><b className="tabular">{rate === null ? "—" : `${rate}%`}</b></div>
        <div className="care-rate-bar">
          <motion.i initial={{ width: 0 }} animate={{ width: `${rate ?? 0}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }} />
        </div>
      </div>
      <div className="care-panel-cases">
        <h4>Latest cases</h4>
        {!loaded ? (
          <span className="care-muted"><Loader2 size={13} className="spin" /> Loading…</span>
        ) : mine.length === 0 ? (
          <span className="care-muted">No cases handled yet.</span>
        ) : (
          <ul>
            {mine.slice(0, 4).map((e) => <CaseRow key={e.id} e={e} />)}
          </ul>
        )}
      </div>
      <footer className="care-panel-foot">
        <Link className="cx-link" to={CASES}>Open the cases <ArrowRight size={13} /></Link>
        <span className="care-panel-actions">
          <button className="cw-btn" onClick={() => onEdit(member)}><Pencil size={13} /> Edit</button>
          <button className="cw-btn care-remove-btn" onClick={remove}><X size={13} /> Remove</button>
        </span>
      </footer>
    </motion.aside>
  );
}

function CaseRow({ e, time = "created" }: { e: Escalation; time?: "created" | "resolved" }) {
  const tag = e.status !== "resolved" ? (e.status === "in_progress" ? "In progress" : "Open")
    : e.outcome === "rejected" ? "Not solved" : "Solved";
  const tone = e.status !== "resolved" ? "wait" : e.outcome === "rejected" ? "bad" : "ok";
  const at = time === "resolved" && e.resolved_at ? `closed ${fmtTime(e.resolved_at)}` : fmtTime(e.created_at);
  return (
    <li>
      <div>
        <b>{e.ticket?.title || e.ticket?.category || e.ticket_id}</b>
        <small>{e.reason.replace(/_/g, " ")} · {at}</small>
      </div>
      <span className={`care-tag ${tone}`}>{tag}</span>
    </li>
  );
}

/* India-time day keys (yyyy-mm-dd) for today and the start of this week (Monday) / month */
function dayKeys() {
  const today = istDay(new Date().toISOString());
  const d = new Date(`${today}T00:00:00Z`);
  const week = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  return { today, week, month: `${today.slice(0, 8)}01` };
}
const dayLabel = (day: string, today: string) => {
  if (day === today) return "Today";
  const y = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  if (day === y) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** Below the table: the picked person's cases today / this week / this month / all time, and a day-by-day history
 * (click a date to see that day's cases). A case counts as assigned on the day it came in, completed on the day it was closed. */
function PersonActivity({ name, mine, loaded }: { name: string; mine: Escalation[]; loaded: boolean }) {
  const k = dayKeys();
  const periods = [
    { key: "today", label: "Today", from: k.today }, { key: "week", label: "This week", from: k.week },
    { key: "month", label: "This month", from: k.month }, { key: "all", label: "All time", from: "" },
  ];
  const count = (from: string) => {
    const assigned = mine.filter((e) => istDay(e.created_at) >= from);
    const closed = mine.filter((e) => e.status === "resolved" && e.resolved_at && istDay(e.resolved_at) >= from);
    const solved = closed.filter((e) => e.outcome !== "rejected").length;
    return { assigned: assigned.length, completed: closed.length, solved, notSolved: closed.length - solved,
      pending: assigned.filter((e) => e.status !== "resolved").length };
  };
  // history: every day this person got or closed a case
  const days = new Map<string, { assigned: Escalation[]; closed: Escalation[] }>();
  const slot = (d: string) => days.get(d) ?? (days.set(d, { assigned: [], closed: [] }), days.get(d)!);
  for (const e of mine) {
    slot(istDay(e.created_at)).assigned.push(e);
    if (e.status === "resolved" && e.resolved_at) slot(istDay(e.resolved_at)).closed.push(e);
  }
  const history = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60);
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? history[0]?.[0] ?? null;
  const day = shown ? days.get(shown) : undefined;
  const max = Math.max(1, ...history.map(([, v]) => Math.max(v.assigned.length, v.closed.length)));

  return (
    <motion.div className="care-activity" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: "easeOut" }}>
      <div className="care-activity-periods">
        <h4><CalendarRange size={14} /> {name}'s calls</h4>
        <div className="care-period-cards">
          {periods.map((p, i) => {
            const c = count(p.from);
            const pct = c.assigned ? Math.min(100, Math.round((100 * c.completed) / c.assigned)) : 0;
            return (
              <motion.div key={p.key} className="care-period" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.22 }}>
                <span className="care-period-label">{p.label}</span>
                <div className="care-period-main">
                  <b className="tabular">{loaded ? n(c.assigned) : "…"}</b><small>assigned</small>
                </div>
                <div className="care-period-done">
                  <span><b className="tabular">{loaded ? n(c.completed) : "…"}</b> completed</span>
                  {c.assigned > 0 && <span className="tabular">{pct}%</span>}
                </div>
                <div className="care-period-bar">
                  <motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, delay: 0.15 + i * 0.05 }} />
                </div>
                <div className="care-period-chips">
                  <span className="ok" title="Solved"><CheckCircle2 size={11} /> {n(c.solved)}</span>
                  <span className="bad" title="Not solved"><XCircle size={11} /> {n(c.notSolved)}</span>
                  <span className="wait" title="Still pending"><Clock3 size={11} /> {n(c.pending)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
      <div className="care-history">
        <h4><Clock3 size={14} /> History <small>click a date</small></h4>
        {!loaded ? (
          <span className="care-muted"><Loader2 size={13} className="spin" /> Loading…</span>
        ) : history.length === 0 ? (
          <span className="care-muted">No calls assigned to {name} yet.</span>
        ) : (
          <div className="care-history-grid">
            <ul className="care-days">
              {history.map(([d, v], i) => (
                <motion.li key={d} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
                  <button className={shown === d ? "on" : ""} onClick={() => setOpen(d)} aria-pressed={shown === d}>
                    <span className="care-day-name">{dayLabel(d, k.today)}</span>
                    <span className="care-day-bars" aria-hidden>
                      <motion.i initial={{ width: 0 }} animate={{ width: `${(100 * v.assigned.length) / max}%` }} transition={{ duration: 0.5 }} />
                      <motion.i className="done" initial={{ width: 0 }} animate={{ width: `${(100 * v.closed.length) / max}%` }} transition={{ duration: 0.5, delay: 0.08 }} />
                    </span>
                    <span className="care-day-nums tabular">
                      <span className="in">{v.assigned.length} assigned</span> · <span className="done">{v.closed.length} completed</span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <div className="care-day-detail">
              <AnimatePresence mode="wait">
                {shown && day && (
                  <motion.div key={shown} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                    <h5>{dayLabel(shown, k.today)} · {new Date(`${shown}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</h5>
                    <p className="care-day-sum">
                      <span className="in">{n(day.assigned.length)} assigned</span>
                      <span className="done">{n(day.closed.length)} completed</span>
                    </p>
                    {day.assigned.length > 0 && <><h6>Assigned this day</h6><ul className="care-day-cases">{day.assigned.map((e) => <CaseRow key={e.id} e={e} />)}</ul></>}
                    {day.closed.length > 0 && <><h6>Completed this day</h6><ul className="care-day-cases">{day.closed.map((e) => <CaseRow key={e.id} e={e} time="resolved" />)}</ul></>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Add a person, or edit one (member given). */
function MemberDialog({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(member?.name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, phone: phone || undefined, role: role || undefined };
      if (member) {
        await api.updateCareMember(member.id, body);
        toast.success(`${name.trim()} updated`);
      } else {
        await api.addCareMember(body);
        toast.success(`${name.trim()} added to the customer care team`);
      }
      onSaved();
    } catch (err) {
      toast.error(member ? "Could not save" : "Could not add", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="care-modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form className="care-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}
        initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} role="dialog" aria-modal="true" aria-label={member ? `Edit ${member.name}` : "Add a customer care person"}>
        <header>
          <h3>{member ? <><Pencil size={15} /> Edit {member.name}</> : <><Plus size={16} /> Add a customer care person</>}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <label><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anitha Reddy" required /></label>
        <label><span>Phone (optional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" /></label>
        <label><span>Role (optional)</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Team lead, Telugu calls" /></label>
        <footer>
          <button type="button" className="cw-btn" onClick={onClose}>Cancel</button>
          <button className="cw-btn primary" disabled={busy || !name.trim()}>{busy ? <Loader2 size={13} className="spin" /> : member ? <Pencil size={13} /> : <Plus size={13} />} {member ? "Save changes" : "Add to the team"}</button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
