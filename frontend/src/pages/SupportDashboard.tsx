import { motion } from "framer-motion";
import {
  ArrowRight, Bot, CalendarRange, Clock3, Hand, Inbox, Languages, LifeBuoy, Loader2, MessageCircle, MessagesSquare,
  RefreshCw, Sparkles, Tags, UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { WsCount, WsOverview } from "../types";
import { CardHead, Kpi, Skeleton, n } from "./EngagementKit";
import { HealthWarnings, Kicker, SUPPORT_ROUTES, SupportSwitch, TestsToggle } from "./SupportShared";

/** Customer Engagement → WhatsApp Support → Dashboard: how many customers wrote, how many the AI solved and how many
 * went to the team, in which languages and about what. Backend: /api/whatsapp/support/overview. */

type PeriodKey = "today" | "week" | "month" | "all";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "all", label: "All time" },
];

export function SupportDashboardPage() {
  const [tests, setTests] = useState(false);
  const data = usePoll<WsOverview>(() => api.whatsapp.supportOverview(tests), 15000, [tests]);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const d = data.data;
  if (!d) {
    return (
      <div className="cw-page ws-page">
        {data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading WhatsApp Support…</>} />}
      </div>
    );
  }
  const p = d.periods[period];
  const label = PERIODS.find((x) => x.key === period)!.label.toLowerCase();

  return (
    <div className="cw-page ws-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <Kicker />
            <h1>WhatsApp Support</h1>
            <p>The AI agent answers customers on WhatsApp in Telugu, Hindi and English from their own ExtraHand data, and hands the rest to the care team.</p>
          </div>
          <div className="cw-head-tools">
            <SupportSwitch settings={d.settings} onChange={data.refresh} />
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /></button>
          </div>
        </div>
        <div className="cw-controls">
          <div className="cw-pills" role="tablist" aria-label="Period">
            <CalendarRange size={14} />
            {PERIODS.map((x) => (
              <button key={x.key} role="tab" aria-selected={period === x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
            ))}
          </div>
          <TestsToggle on={tests} set={setTests} />
        </div>
      </header>

      <HealthWarnings health={d.health} compact />

      <div className="ws-kpis">
        <Kpi lead icon={MessagesSquare} label="Conversations" value={n(p.conversations)} sub={`customers who wrote ${label}`} />
        <Kpi icon={Inbox} label="Messages received" value={n(p.messages_in)} sub={`${n(p.ai_replies)} AI replies · ${n(p.team_replies)} by the team`} />
        <Kpi icon={Sparkles} label="Solved by AI" value={n(p.solved_by_ai)} color="var(--ws-ai)"
          sub={p.ai_share === null ? "no conversations yet" : `${p.ai_share}% of conversations, no person needed`} />
        <Kpi icon={Hand} label="Handed to the team" value={n(p.handed_to_team)} color="var(--ws-team)" sub={`${n(p.cases)} support cases created`} />
        <Kpi icon={Clock3} label="Open cases" value={n(d.open_now.open_cases)} color="var(--cw-amber)"
          sub={`${n(d.open_now.with_team)} chats with a person · ${n(d.open_now.waiting_yes)} waiting for YES`} />
      </div>

      <div className="cw-row">
        <section className="cw-card">
          <CardHead icon={CalendarRange} title="Last 30 days" note="messages received and cases created per day" />
          <DayBars days={d.days} />
        </section>
        <section className="cw-card">
          <CardHead icon={Bot} title="The agent" />
          <ul className="ws-facts">
            <li><span>AI model</span><b>{d.health.ai_configured ? d.health.ai_model.split("/").pop() : "Not set: fixed replies"}</b></li>
            <li><span>Average AI answer time</span><b className="tabular">{d.avg_ai_ms ? `${(d.avg_ai_ms / 1000).toFixed(1)} s` : "—"}</b></li>
            <li><span>AI cost {label}</span><b className="tabular">{p.ai_cost_usd ? `$${p.ai_cost_usd.toFixed(3)}` : "$0"}</b></li>
            <li><span>Replies not delivered {label}</span><b className={`tabular ${p.failed_sends ? "warn" : ""}`}>{n(p.failed_sends)}</b></li>
            <li><span>Replies to customers' messages</span><b>Free (within 24 h)</b></li>
          </ul>
          <div className="ws-links">
            <Link className="cx-link" to={SUPPORT_ROUTES.conversations}>Open conversations <ArrowRight size={13} /></Link>
            <Link className="cx-link" to={SUPPORT_ROUTES.settings}>Try the agent <ArrowRight size={13} /></Link>
          </div>
        </section>
      </div>

      <div className="cw-grid three">
        <section className="cw-card">
          <CardHead icon={Languages} title="Languages" note="of customers' messages" />
          <Bars rows={d.languages} empty="No messages yet." />
        </section>
        <section className="cw-card">
          <CardHead icon={MessageCircle} title="What customers ask" />
          <Bars rows={d.intents} empty="No questions yet." />
        </section>
        <section className="cw-card">
          <CardHead icon={Tags} title="Cases for the team" />
          <Bars rows={d.case_categories} empty="No cases yet." tone="team" />
          <Link className="cx-link" to={SUPPORT_ROUTES.cases}>Support cases <ArrowRight size={13} /></Link>
        </section>
      </div>

      <section className="cw-card">
        <CardHead icon={LifeBuoy} title="Today, this week, this month" note="click a period to see it above" />
        <div className="cw-scroll">
          <table className="ws-matrix">
            <thead><tr><th />{PERIODS.map((x) => <th key={x.key} className={period === x.key ? "on" : ""}><button onClick={() => setPeriod(x.key)}>{x.label}</button></th>)}</tr></thead>
            <tbody>
              {([["Conversations", "conversations"], ["Messages received", "messages_in"], ["AI replies", "ai_replies"],
                ["Team replies", "team_replies"], ["Solved by AI", "solved_by_ai"], ["Handed to the team", "handed_to_team"],
                ["Support cases", "cases"]] as const).map(([name, k]) => (
                <tr key={k}>
                  <th scope="row">{name}</th>
                  {PERIODS.map((x) => <td key={x.key} className={`tabular ${period === x.key ? "on" : ""}`}>{n(d.periods[x.key][k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="cw-chart-foot"><UsersRound size={12} /> Cases go to the same Customer Care team (Calling Agent → Customer Care).</p>
    </div>
  );
}

function Bars({ rows, empty, tone }: { rows: WsCount[]; empty: string; tone?: "team" }) {
  if (!rows.length) return <p className="ws-empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <ul className={`ws-bars ${tone ?? ""}`}>
      {rows.map((r, i) => (
        <li key={r.key}>
          <span className="ws-bar-label">{r.label}</span>
          <span className="ws-bar-track">
            <motion.i initial={{ width: 0 }} animate={{ width: `${(100 * r.count) / max}%` }} transition={{ duration: 0.5, delay: i * 0.04 }} />
          </span>
          <b className="tabular">{n(r.count)}</b>
          <small className="tabular">{Math.round((100 * r.count) / total)}%</small>
        </li>
      ))}
    </ul>
  );
}

function DayBars({ days }: { days: WsOverview["days"] }) {
  // the last 30 days, empty days included
  const today = new Date();
  const list = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getTime() - (29 - i) * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const hit = days.find((x) => x.day === d);
    return { day: d, messages: hit?.messages ?? 0, cases: hit?.cases ?? 0 };
  });
  const max = Math.max(1, ...list.map((x) => x.messages));
  if (!days.length) return <p className="ws-empty">No messages in the last 30 days yet.</p>;
  return (
    <div className="ws-days">
      <div className="ws-days-plot">
        {list.map((x) => (
          <div key={x.day} className="ws-day" title={`${new Date(`${x.day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}: ${x.messages} messages, ${x.cases} cases`}>
            <i style={{ height: `${(100 * x.messages) / max}%` }} />
            {x.cases > 0 && <em style={{ height: `${(100 * Math.min(x.cases, x.messages || x.cases)) / max}%` }} />}
          </div>
        ))}
      </div>
      <div className="ws-days-axis"><span>{list[0].day.slice(5).split("-").reverse().join("/")}</span><span>Today</span></div>
      <div className="ws-legend"><span><i /> Messages received</span><span className="team"><i /> Cases created</span></div>
    </div>
  );
}
