import {
  ArrowRight, CalendarRange, CheckCheck, ClipboardList, Clock3, FileText, Inbox, Loader2, MessageCircleHeart,
  Eye, IndianRupee, MessageSquareQuote, MessageSquareWarning, TrendingDown, MessagesSquare, Phone, RefreshCw, Search, Send, Table2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { CancelledWorks, WaCancelReplies, WaCancelReplyConversation } from "../types";
import { CANCEL_ROUTES, MSG_STATUS, StatusTag, TestTag, TestsSwitch, WebhookWarning, worksLink } from "./CancellationShared";
import {
  Avatar, Breakdown, CardHead, Kpi, Ranked, Skeleton, addDays, addMonths, fmtDate, fmtTime, istDay, monthOf, n, pct, pretty, rupees, weekOf,
  within, type Dated, type Group, type Range,
} from "./EngagementKit";
import "./cancellation.css";
import "./cancel-followup.css";

/** Cancellation Engagement → Messages & Replies: every customer who got the cancellation follow-up — whether the
 * message was delivered and read, the reason they picked in the form, anything they typed back on WhatsApp, the task
 * they cancelled and all their other cancelled tasks — plus who was not messaged and why, and what it all cost.
 * (Message Status & Reviews was merged in here.) Refreshes every 15 seconds. Backend: backend/whatsapp/cancel_followup.py (/replies);
 * the tasks come from the Cancelled Works data (user_engagement/cancellations.py).
 * Counts per period (Today / This week / This month / Last month / All time, India time): messages sent, replies
 * received (form answers + typed messages), customers who replied, reply rate, waiting, typical reply time. */

type Tab = "all" | "replied" | "form" | "typed" | "no_reply" | "not_sent";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "replied", label: "Replied" },
  { key: "form", label: "Form answers" },
  { key: "typed", label: "Typed replies" },
  { key: "no_reply", label: "No reply" },
  { key: "not_sent", label: "Not sent" },
];
const inTab = (c: WaCancelReplyConversation, t: Tab) => t !== "not_sent" && (
  t === "all" || (t === "replied" ? c.replied : t === "form" ? c.status === "answered" : t === "typed" ? c.texts.length > 0 : !c.replied));
const digits = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);

/** the newest reply as one line for the inbox list */
function lastLine(c: WaCancelReplyConversation): string {
  const last = c.texts[c.texts.length - 1];
  const formAt = c.answered_at ?? "";
  if (last && (last.at ?? "") >= formAt) return last.text;
  if (c.status === "answered") return `Form: ${c.answer_reason_label ?? "answered"}${c.answer_note ? ` — “${c.answer_note}”` : ""}`;
  return "No reply yet";
}

/** Today / This week / This month / Last month / All time, each with the period before it (for the comparison) */
function periods(today: string): Range[] {
  const ws = weekOf(today), ms = monthOf(today);
  return [
    { key: "today", label: "Today", from: today, to: addDays(today, 1), prev: [addDays(today, -1), today], prevLabel: "yesterday" },
    { key: "week", label: "This week", from: ws, to: addDays(ws, 7), prev: [addDays(ws, -7), ws], prevLabel: "last week" },
    { key: "month", label: "This month", from: ms, to: addMonths(ms, 1), prev: [addMonths(ms, -1), ms], prevLabel: "last month" },
    { key: "lastmonth", label: "Last month", from: addMonths(ms, -1), to: ms, prev: [addMonths(ms, -2), addMonths(ms, -1)], prevLabel: "the month before" },
    { key: "all", label: "All time", from: null, to: null },
  ];
}
const dayOf = (iso?: string | null) => (iso ? istDay(iso) : null);
const sentDay = (c: WaCancelReplyConversation) => dayOf(c.sent_at ?? c.created_at);
/** every reply as its own event: the form answer and each typed message */
const replyEvents = (c: WaCancelReplyConversation) => [
  ...(c.status === "answered" && c.answered_at ? [{ at: c.answered_at, form: true }] : []),
  ...c.texts.filter((t) => t.at).map((t) => ({ at: t.at as string, form: false })),
];
const firstReplyAt = (c: WaCancelReplyConversation) => replyEvents(c).map((e) => e.at).sort()[0] ?? null;

interface PeriodStats {
  sent: number; received: number; form: number; typed: number; customersReplied: number;
  replyRate: number | null; waiting: number; typicalMinutes: number | null;
}
/** What happened in [from, to): messages sent, replies received and who replied. Reply rate, waiting and reply time
 * are of the messages sent in the period. */
function statsFor(convs: WaCancelReplyConversation[], from: string | null, to: string | null): PeriodStats {
  const sentIn = convs.filter((c) => within(sentDay(c), from, to));
  let form = 0, typed = 0;
  const replied = new Set<number>();
  for (const c of convs) {
    for (const e of replyEvents(c)) {
      if (!within(dayOf(e.at), from, to)) continue;
      if (e.form) form += 1; else typed += 1;
      replied.add(c.id);
    }
  }
  const waits = sentIn.map((c) => {
    const first = firstReplyAt(c);
    const start = c.sent_at ?? c.created_at;
    return first && start ? (new Date(first).getTime() - new Date(start).getTime()) / 60000 : null;
  }).filter((m): m is number => m !== null && m >= 0).sort((a, b) => a - b);
  return {
    sent: sentIn.length, received: form + typed, form, typed, customersReplied: replied.size,
    replyRate: sentIn.length ? pct(sentIn.filter((c) => c.replied).length, sentIn.length) : null,
    waiting: sentIn.filter((c) => !c.replied).length,
    typicalMinutes: waits.length ? waits[Math.floor((waits.length - 1) / 2)] : null,
  };
}
const minutes = (m: number | null) =>
  m === null ? "—" : m < 1 ? "under a minute" : m < 60 ? `${Math.round(m)} min` : m < 48 * 60 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)} h` : `${Math.round(m / 1440)} days`;

/** one row per message in or out, for the Day / Week / Month table */
interface Activity extends Dated { kind: "sent" | "form" | "typed"; conv: number }

export function CancellationRepliesPage() {
  const [includeTests, setIncludeTests] = useState(true);
  const data = usePoll<WaCancelReplies>(() => api.whatsapp.cancelFollowupReplies(includeTests), 15000, [includeTests]);
  const works = usePoll<CancelledWorks>(api.engagement.cancellations, 60000);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null); // the conversation open in the side drawer
  const today = istDay(new Date().toISOString());
  const PERIODS = useMemo(() => periods(today), [today]);
  const [range, setRange] = useState<Range>(PERIODS[0]);
  const [group, setGroup] = useState<Group>("day");
  const listRef = useRef<HTMLDivElement>(null);
  const d = data.data;
  const convs = useMemo(() => d?.conversations ?? [], [d]);
  const activity: Activity[] = useMemo(() => convs.flatMap((c) => [
    { kind: "sent" as const, conv: c.id, day: sentDay(c) },
    ...replyEvents(c).map((e) => ({ kind: (e.form ? "form" : "typed") as Activity["kind"], conv: c.id, day: dayOf(e.at) })),
  ]), [convs]);
  const summary = useMemo(() => PERIODS.filter((p) => p.key !== "lastmonth").map((p) => ({ p, s: statsFor(convs, p.from, p.to) })), [convs, PERIODS]);
  const activeCol = summary.findIndex(({ p }) => p.key === range.key);
  const cur = statsFor(convs, range.from, range.to);
  const prev = range.prev ? statsFor(convs, range.prev[0], range.prev[1]) : null;

  // commercials: what the follow-up sends cost (tests included only when they are shown)
  const costItems = useMemo(() => (d?.costs?.items ?? []).filter((x) => includeTests || !x.test), [d, includeTests]);
  const costFor = (from: string | null, to: string | null) => {
    const xs = costItems.filter((x) => within(dayOf(x.at), from, to));
    return { cost: xs.reduce((a, x) => a + x.cost, 0), billed: xs.filter((x) => x.cost > 0).length, sent: xs.filter((x) => x.status !== "failed").length,
      tests: xs.filter((x) => x.test).reduce((a, x) => a + x.cost, 0), estimated: xs.some((x) => !x.reported && x.cost > 0) };
  };
  const curCost = costFor(range.from, range.to);
  const money = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 10 ? 3 : 2 })}`;
  const tests = convs.filter((x) => x.is_test).length;

  const query = q.trim().toLowerCase();
  // a conversation is in the period when the message was sent or a reply came in during it
  const inPeriod = useMemo(() => convs.filter((c) => range.from === null || within(sentDay(c), range.from, range.to)
    || replyEvents(c).some((e) => within(dayOf(e.at), range.from, range.to))), [convs, range]);
  const notSent = useMemo(() => (d?.not_sent ?? []).filter((r) => (includeTests || !r.is_test)
    && within(dayOf(r.created_at), range.from, range.to)), [d, includeTests, range]);
  const tabCounts = useMemo(() => ({
    ...Object.fromEntries(TABS.map((t) => [t.key, inPeriod.filter((c) => inTab(c, t.key)).length])), not_sent: notSent.length,
  }) as Record<Tab, number>, [inPeriod, notSent]);
  // reached the phone / read / answered, of the messages sent in the period (an answer means it was read)
  const sentInPeriod = convs.filter((c) => within(sentDay(c), range.from, range.to));
  const funnel = [
    { label: "Sent", v: sentInPeriod.length, icon: Send },
    { label: "Delivered", v: sentInPeriod.filter((c) => c.status === "answered" || c.delivery === "delivered" || c.delivery === "read").length, icon: CheckCheck },
    { label: "Read", v: sentInPeriod.filter((c) => c.status === "answered" || c.delivery === "read").length, icon: Eye },
    { label: "Answered", v: sentInPeriod.filter((c) => c.replied).length, icon: MessageSquareQuote },
  ];
  const answeredIn = inPeriod.filter((c) => c.status === "answered");
  const notes = answeredIn.filter((c) => c.answer_note).sort((a, b) => (b.answered_at ?? "").localeCompare(a.answered_at ?? ""));
  const list = useMemo(() => inPeriod.filter((c) => inTab(c, tab) && (!query ||
    [c.customer_name, c.customer_phone, c.task_title, c.city, c.answer_note, c.answer_reason_label, ...c.texts.map((t) => t.text)]
      .some((v) => (v ?? "").toLowerCase().includes(query)))), [inPeriod, tab, query]);
  const current = convs.find((c) => c.id === selected) ?? null;
  useEffect(() => { // Esc closes the drawer
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // every cancelled task of the selected customer (by phone), from the Cancelled Works data
  const tasks = useMemo(() => {
    if (!current) return [];
    const key = digits(current.customer_phone);
    return (works.data?.rows ?? []).filter((w) => key && digits(w.customer_phone) === key)
      .sort((a, b) => (b.cancelled_at ?? b.booked_at ?? "").localeCompare(a.cancelled_at ?? a.booked_at ?? ""));
  }, [current, works.data]);

  if (!d) {
    return (
      <div className="cw-page cf-page">
        {data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading the replies…</>} />}
      </div>
    );
  }
  const c = d.counts;

  return (
    <div className="cw-page cf-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><MessageCircleHeart size={13} /> Cancellation Engagement</span>
            <h1>Messages & Replies</h1>
            <p>Every follow-up sent to customers who cancelled: whether it reached them, what they replied, their tasks, and what it cost.</p>
          </div>
          <div className="cw-head-tools">
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <div className="cw-controls">
          <div className="cw-pills" role="tablist" aria-label="Period">
            <CalendarRange size={14} />
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={range.key === p.key} className={range.key === p.key ? "on" : ""} onClick={() => setRange(p)}>{p.label}</button>
            ))}
            {!PERIODS.some((p) => p.key === range.key) && (
              <button className="on custom" onClick={() => setRange(PERIODS[0])} title="Back to today">{range.label} ✕</button>
            )}
          </div>
        </div>
        <p className="cw-banner-foot">
          Typed messages from the customer's number within {d.reply_window_days} days of the follow-up count as replies. Days are India time. Refreshes every 15 seconds.
        </p>
        <TestsSwitch on={includeTests} onChange={setIncludeTests} count={tests} />
      </header>

      <WebhookWarning lastSeen={d.webhook_last_seen}
        lastSent={convs.map((x) => x.sent_at).filter((x): x is string => !!x).sort().pop() ?? null} />

      <div className="cw-kpis">
        <Kpi lead icon={Send} label={`Sent · ${range.label}`} value={n(cur.sent)} sub="follow-up messages to customers who cancelled"
          delta={prev ? cur.sent - prev.sent : null} prevLabel={range.prevLabel} goodWhenDown={false} />
        <Kpi icon={MessagesSquare} label={`Received · ${range.label}`} value={n(cur.received)}
          sub={`${n(cur.form)} form ${cur.form === 1 ? "answer" : "answers"} · ${n(cur.typed)} typed`}
          delta={prev ? cur.received - prev.received : null} prevLabel={range.prevLabel} goodWhenDown={false} />
        <Kpi icon={CheckCheck} label="Customers who replied" value={n(cur.customersReplied)}
          sub={cur.replyRate === null ? "no messages sent in this period" : `${cur.replyRate}% of the messages sent got a reply`} />
        <Kpi icon={Clock3} label="Waiting for a reply" value={n(cur.waiting)} sub={`typical reply time ${minutes(cur.typicalMinutes)}`} />
      </div>

      <div className="cw-row">
        <section className="cw-card">
          <CardHead icon={Table2} title="Sent and received" note="click a period to see it" />
          <div className="cw-scroll">
            <table className="cr-matrix">
              <thead>
                <tr><th />{summary.map(({ p }) => <th key={p.key} className={`num ${range.key === p.key ? "on" : ""}`}><button onClick={() => setRange(p)}>{p.label}</button></th>)}</tr>
              </thead>
              <tbody>
                <MatrixRow label="Messages sent" icon={Send} values={summary.map(({ s }) => n(s.sent))} active={activeCol} strong />
                <MatrixRow label="Replies received" icon={MessagesSquare} values={summary.map(({ s }) => n(s.received))} active={activeCol} strong />
                <MatrixRow label="form answers" values={summary.map(({ s }) => n(s.form))} active={activeCol} sub />
                <MatrixRow label="typed messages" values={summary.map(({ s }) => n(s.typed))} active={activeCol} sub />
                <MatrixRow label="Customers who replied" icon={CheckCheck} values={summary.map(({ s }) => n(s.customersReplied))} active={activeCol} />
                <MatrixRow label="Reply rate" icon={ClipboardList} values={summary.map(({ s }) => (s.replyRate === null ? "—" : `${s.replyRate}%`))} active={activeCol} />
                <MatrixRow label="Waiting for a reply" icon={Clock3} values={summary.map(({ s }) => n(s.waiting))} active={activeCol} />
                <MatrixRow label="Typical reply time" icon={MessageSquareQuote} values={summary.map(({ s }) => minutes(s.typicalMinutes))} active={activeCol} />
                <MatrixRow label="Cost" icon={IndianRupee} values={summary.map(({ p }) => money(costFor(p.from, p.to).cost))} active={activeCol} strong />
                <MatrixRow label="Cost per reply" values={summary.map(({ p, s }) => (s.received ? money(costFor(p.from, p.to).cost / s.received) : "—"))} active={activeCol} sub />
              </tbody>
            </table>
          </div>
          <p className="cw-chart-foot">Replies are counted on the day they came in. Reply rate, waiting and reply time are for the messages sent in that period.</p>
        </section>
        <section className="cw-card cr-commercials">
          <CardHead icon={IndianRupee} title="Commercials" note={range.label} />
          <div className="cr-cost">
            <b className="tabular">{money(curCost.cost)}</b>
            <span>spent on {n(curCost.billed)} follow-up {curCost.billed === 1 ? "message" : "messages"}</span>
          </div>
          <ul className="cr-alltime">
            <li><span>Rate per message (utility)</span><b className="tabular">{money(d.costs?.rates.utility ?? 0)}</b><small /></li>
            <li><span>Cost per reply received</span><b className="tabular">{cur.received ? money(curCost.cost / cur.received) : "—"}</b><small /></li>
            <li><span>Cost per customer who replied</span><b className="tabular">{cur.customersReplied ? money(curCost.cost / cur.customersReplied) : "—"}</b><small /></li>
            {curCost.tests > 0 && <li><span>of which test messages</span><b className="tabular">{money(curCost.tests)}</b><small /></li>}
          </ul>
          <p className="cw-chart-foot">
            {curCost.estimated ? "Estimated from the utility rate until Meta's pricing report arrives. " : ""}
            Rates are set on the WhatsApp commercials pages.
          </p>
        </section>
      </div>

      <div className="cw-grid three">
        <section className="cw-card">
          <CardHead icon={TrendingDown} title="From sent to answered" note={range.label} />
          <ul className="cx-funnel">
            {funnel.map((st, i) => {
              const I = st.icon;
              const base = funnel[0].v;
              return (
                <li key={st.label}>
                  <span className="cx-funnel-label"><I size={14} /> {st.label}</span>
                  <span className="cx-funnel-bar"><i style={{ width: `${base ? Math.max(st.v ? 2 : 0, (st.v / base) * 100) : 0}%` }} /></span>
                  <b className="tabular">{n(st.v)}</b>
                  <small className="tabular">{i === 0 || !base ? "" : `${pct(st.v, base)}%`}</small>
                </li>
              );
            })}
          </ul>
          {funnel[0].v === 0 && <p className="cw-chart-foot">Nothing sent in this period.</p>}
        </section>
        <section className="cw-card">
          <CardHead icon={MessageSquareWarning} title="Reasons customers gave" note={range.label} />
          <Ranked rows={answeredIn} keyOf={(x) => x.answer_reason_label ?? "Answered"} limit={5}
            empty="No form answers in this period. They appear here as customers fill in the form." />
        </section>
        <section className="cw-card">
          <CardHead icon={MessageSquareQuote} title="What customers wrote" note={`${n(notes.length)} ${notes.length === 1 ? "note" : "notes"}`} />
          {notes.length === 0 ? <p className="cw-empty small">No notes in this period. Customers can add one under "Other concerns".</p> : (
            <ul className="cx-reviews">
              {notes.slice(0, 5).map((x) => (
                <li key={x.id}>
                  <button className="cr-note-btn" onClick={() => setSelected(x.id)}>
                    <p>“{x.answer_note}”</p>
                    <small><b>{x.customer_name || "Customer"}</b> · {x.answer_reason_label} · {fmtDate(x.answered_at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {c.all > 0 && (
        <Breakdown rows={activity} group={group} setGroup={setGroup} today={today} active={range.key}
          onView={(rg) => { setRange(rg); requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }}
          noun="Messages" countLabel="In + out" columns={[
            { label: "Sent", cell: (rs) => n(rs.filter((r) => r.kind === "sent").length) },
            { label: "Received", cell: (rs) => n(rs.filter((r) => r.kind !== "sent").length) },
            { label: "Form answers", cell: (rs) => n(rs.filter((r) => r.kind === "form").length) },
            { label: "Typed", cell: (rs) => n(rs.filter((r) => r.kind === "typed").length) },
            { label: "Customers replied", cell: (rs) => n(new Set(rs.filter((r) => r.kind !== "sent").map((r) => r.conv)).size) },
          ]} />
      )}

      {c.all === 0 ? (
        <section className="cw-card">
          <p className="cw-empty">
            No customer has been messaged yet, so there are no replies. Once the follow-up is on (on the{" "}
            <Link to={CANCEL_ROUTES.dashboard}>Cancellation Dashboard</Link>) and Meta has approved the template, customers who
            cancel get the message and their replies appear here.
          </p>
        </section>
      ) : (
        <div className="cw-tablebox" ref={listRef}>
          <div className="cw-tablecap">
            <div>
              <h2>{tab === "not_sent" ? "Not messaged" : "Customers messaged"}</h2>
              <small>{tab === "not_sent"
                ? <>{range.label}: {n(notSent.length)} {notSent.length === 1 ? "customer" : "customers"} who cancelled but were not messaged, and why</>
                : <>{range.label}: {n(list.length)} {list.length === 1 ? "customer" : "customers"} with a message or reply · click one to read the conversation</>}</small>
            </div>
            <div className="cx-cap-tools">
              <div className="cw-search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, task or reply" aria-label="Search replies" />
                {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
              </div>
              <div className="cw-seg" role="tablist" aria-label="Show">
                {TABS.map((t) => (
                  <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                    {t.label} <span className="tabular">{n(tabCounts[t.key])}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {tab === "not_sent" ? (notSent.length === 0 ? <p className="cw-empty">Everyone who cancelled in {range.label.toLowerCase()} was messaged.</p> : (
            <div className="cw-scroll">
              <table className="cw-table">
                <thead><tr><th>Customer</th><th>Cancelled task</th><th>Why not sent</th><th>When</th></tr></thead>
                <tbody>
                  {notSent.map((r) => (
                    <tr key={r.id}>
                      <td className="c-who">
                        <div className="cw-who">
                          <Avatar name={r.customer_name || "?"} />
                          <div><b className="cw-name">{r.customer_name || "Unknown"} {r.is_test && <TestTag />}</b>{r.customer_phone && <small>{r.customer_phone}</small>}</div>
                        </div>
                      </td>
                      <td className="c-work"><b className="cw-work">{r.task_title || "—"}</b><small>{[r.category && pretty(r.category), r.city].filter(Boolean).join(" · ")}</small></td>
                      <td className="c-reason">
                        <StatusTag r={r} />
                        <small>{r.status === "skipped_repeat" ? "Already got the message in the last 7 days" : r.status === "no_phone" ? "No phone number on ExtraHand"
                          : r.status === "failed" ? (r.error || "WhatsApp did not accept it") : (MSG_STATUS[r.status]?.label ?? r.status)}</small>
                      </td>
                      <td className="c-side cr-last">{fmtDate(r.created_at)}<small>{fmtTime(r.created_at)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : list.length === 0 ? <p className="cw-empty">Nothing in {range.label.toLowerCase()}. Try “All time”.</p> : (
            <div className="cw-scroll">
              <table className="cw-table cr-table">
                <thead>
                  <tr><th>Customer</th><th>Cancelled task</th><th>Message</th><th>Their reply</th><th>Last activity</th><th aria-label="Open" /></tr>
                </thead>
                <tbody>
                  {list.map((x) => (
                    <tr key={x.id} className={`cr-row ${x.id === selected ? "open" : ""}`} onClick={() => setSelected(x.id)}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(x.id); } }}>
                      <td className="c-who">
                        <div className="cw-who">
                          <Avatar name={x.customer_name || "?"} />
                          <div>
                            <b className="cw-name">{x.customer_name || "Unknown"} {x.is_test && <TestTag />}</b>
                            {x.customer_phone && <small>{x.customer_phone}</small>}
                          </div>
                        </div>
                      </td>
                      <td className="c-work">
                        <b className="cw-work">{x.task_title || "—"}</b>
                        <small>{x.is_test ? "Sent from Test mode" : [x.category && pretty(x.category), x.city].filter(Boolean).join(" · ")}</small>
                      </td>
                      <td className="c-when">
                        <StatusTag r={x} />
                        <small>{fmtDate(x.sent_at)} {fmtTime(x.sent_at)}</small>
                      </td>
                      <td className="c-reason cr-reply-cell">
                        {x.replied ? (
                          <>
                            <span className="cr-reply-kinds">
                              {x.status === "answered" && <span className="cr-kind form"><ClipboardList size={11} /> Form</span>}
                              {x.texts.length > 0 && <span className="cr-kind typed"><MessageSquareQuote size={11} /> {x.texts.length} typed</span>}
                            </span>
                            <span className="cr-reply-line">{lastLine(x)}</span>
                          </>
                        ) : <span className="cw-muted">No reply yet</span>}
                      </td>
                      <td className="c-side cr-last">{fmtDate(x.last_activity)}<small>{fmtTime(x.last_activity)}</small></td>
                      <td className="cr-open"><span aria-hidden="true"><ArrowRight size={15} /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* the conversation, in a drawer from the right */}
      {current && (
        <>
          <div className="cr-backdrop" onClick={() => setSelected(null)} aria-hidden="true" />
          <aside className="cr-drawer" role="dialog" aria-modal="true" aria-label={`Conversation with ${current.customer_name || "customer"}`}>
            <header className="cr-detail-head">
              <Avatar name={current.customer_name || "?"} />
              <div>
                <b>{current.customer_name || "Unknown"} {current.is_test && <TestTag />}</b>
                {current.customer_phone && <a className="cw-phone" href={`tel:${current.customer_phone}`}><Phone size={11} /> {current.customer_phone}</a>}
              </div>
              <StatusTag r={current} />
              <button className="cr-close" onClick={() => setSelected(null)} aria-label="Close" autoFocus><X size={17} /></button>
            </header>

            <div className="cr-drawer-body">
              <div className="cr-thread">
                <div className="cr-day">{fmtDate(current.sent_at ?? current.created_at)}</div>
                <div className="cr-msg out">
                  <span className="cr-msg-label"><FileText size={12} /> Cancellation follow-up (English + Telugu) with the reason form</span>
                  <p>Hi {(current.customer_name || "there").split(" ")[0]}! 👋 We noticed that you recently cancelled your task on ExtraHand. We'd love to know what went wrong…</p>
                  <small>{fmtTime(current.sent_at)} · <CheckCheck size={12} /> {current.delivery ?? current.status}</small>
                </div>
                {timeline(current).map((m, i) => (
                  <div key={i} className={`cr-msg in ${m.form ? "form" : ""}`}>
                    {m.form ? (
                      <>
                        <span className="cr-msg-label"><ClipboardList size={12} /> Form answer</span>
                        <b className="cr-reason">{m.reason}</b>
                        {m.text && <p>“{m.text}”</p>}
                      </>
                    ) : <p>{m.text}</p>}
                    <small>{fmtDate(m.at)} {fmtTime(m.at)}</small>
                  </div>
                ))}
                {!current.replied && <p className="cr-wait">No reply yet. Replies show here as soon as the customer answers.</p>}
              </div>

              {current.is_test ? (
                <p className="cr-test-note">This is a test message from Test mode on the Template page, so there is no cancelled task to show.</p>
              ) : (
                <div className="cr-panels">
                  <div className="cr-panel">
                    <b className="cr-panel-title"><Inbox size={14} /> The task they cancelled</b>
                    <dl>
                      <div><dt>Task</dt><dd>{current.task_title || "—"}</dd></div>
                      <div><dt>Service</dt><dd>{current.category ? pretty(current.category) : "—"}</dd></div>
                      <div><dt>City</dt><dd>{current.city || "—"}</dd></div>
                      <div><dt>Cancelled</dt><dd>{fmtDate(current.cancelled_at)} {fmtTime(current.cancelled_at)}</dd></div>
                      <div className="wide"><dt>Reason on ExtraHand</dt><dd>{current.cancel_reason || "No reason given"}</dd></div>
                    </dl>
                    <Link className="cx-link" to={worksLink({ side: "all", q: current.task_id })}>Full task details <ArrowRight size={13} /></Link>
                  </div>
                  <div className="cr-panel">
                    <b className="cr-panel-title"><ClipboardList size={14} /> All their cancelled tasks <span>{tasks.length ? n(tasks.length) : ""}</span></b>
                    {works.data?.loading || !works.data ? <p className="cw-empty small"><Loader2 size={13} className="spin" /> Loading tasks…</p>
                      : tasks.length === 0 ? <p className="cw-empty small">No other cancelled tasks found for this number.</p> : (
                        <ul className="cr-tasks">
                          {tasks.slice(0, 8).map((w) => (
                            <li key={w.id} className={w.id === current.task_id ? "this" : ""}>
                              <Link to={worksLink({ side: "all", q: w.id })}>
                                <span><b>{w.title}</b><small>{pretty(w.category)} · {w.cancelled_at ? fmtDate(w.cancelled_at) : `booked ${fmtDate(w.booked_at)}`}{w.reason ? ` · “${w.reason}”` : ""}</small></span>
                                <em className="tabular">{rupees(w.amount)}</em>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/** the customer's side of the conversation, oldest first: the form answer and typed messages */
function timeline(c: WaCancelReplyConversation): { at: string | null; text: string; form?: boolean; reason?: string }[] {
  const items: { at: string | null; text: string; form?: boolean; reason?: string }[] = c.texts.map((t) => ({ at: t.at, text: t.text }));
  if (c.status === "answered") items.push({ at: c.answered_at, text: c.answer_note ?? "", form: true, reason: c.answer_reason_label ?? "Answered" });
  return items.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

function MatrixRow({ label, values, active, icon: I, strong, sub }: {
  label: string; values: string[]; active: number; icon?: ElementType; strong?: boolean; sub?: boolean;
}) {
  return (
    <tr className={`${strong ? "strong" : ""} ${sub ? "sub" : ""}`}>
      <th scope="row">{I && <I size={13} />} {label}</th>
      {values.map((v, i) => <td key={i} className={`num tabular ${i === active ? "on" : ""}`}>{v}</td>)}
    </tr>
  );
}
