import { motion } from "framer-motion";
import {
  BarChart3, CheckCheck, Clock3, HandHeart, MapPin, MessageCircle, RefreshCw, Send, UserRoundPlus, Users,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AnimatedNumber } from "../components/motion";
import { ErrorNote, SkeletonRows } from "../components/ui";
import { fmtRelative } from "../format";
import { usePoll, useUrlState } from "../hooks";
import type { WaWelcomerDashboard, WaWelcomerDashAudience } from "../types";
import "./wa-commercials.css";
import "./wa-welcomer-dashboard.css";

type PeriodKey = "today" | "week" | "month" | "last30";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "30 days" },
];
const HELPER = "#0ea5e9";
const CUSTOMER = "#8b5cf6";
const OUTCOMES: { key: keyof WaWelcomerDashAudience["outcomes"]; label: string; color: string }[] = [
  { key: "read", label: "Read", color: "#2563eb" },
  { key: "delivered", label: "Delivered", color: "#0d9488" },
  { key: "welcomed", label: "Sent", color: "#16a34a" },
  { key: "failed", label: "Failed", color: "#dc2626" },
  { key: "pending", label: "Pending", color: "#d97706" },
  { key: "no_phone", label: "No phone", color: "#e879f9" },
  { key: "welcomer_off", label: "Welcomer was off", color: "#64748b" },
];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Welcomer Dashboard: helper and customer registrations next to the welcome messages sent to them. */
export function WaWelcomerDashboard() {
  const [period, setPeriod] = useUrlState<PeriodKey>("period", "today");
  const [refreshing, setRefreshing] = useState(false);
  const data = usePoll<WaWelcomerDashboard>(() => api.whatsapp.welcomerDashboard(), 60000);
  const r = data.data;
  const h = r?.audiences.helper;
  const c = r?.audiences.customer;
  const label = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.whatsapp.welcomerDashboard(true);
      data.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="wx-page wd">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><BarChart3 size={13} /> Customer Engagement · Welcomers</span>
            <h1>Welcomer Dashboard</h1>
            <p className="wd-sub">New helper and customer registrations on ExtraHand, and the welcome messages sent to them.</p>
          </div>
          <div className="wx-banner-tools">
            <div className="wx-pills" role="tablist" aria-label="Period">
              {PERIODS.map((x) => (
                <button key={x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
              ))}
            </div>
            <button className="wx-ghost wx-square" onClick={refresh} disabled={refreshing} title="Read ExtraHand again" aria-label="Refresh">
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </div>
        {h && c && (
          <div className="wd-switches">
            <Link to="/engagement/welcomers/helper" className={h.active ? "on" : ""}><i /> Helper Welcomer {h.active ? "on" : "off"}</Link>
            <Link to="/engagement/welcomers/customer" className={c.active ? "on" : ""}><i /> Customer Welcomer {c.active ? "on" : "off"}</Link>
            <span className="wd-fresh" title="Registrations are read from ExtraHand every 5 minutes; welcomes are live">
              <i /> Updated {fmtRelative(r?.fetched_at)} · refreshes every minute
            </span>
          </div>
        )}
      </header>

      <ErrorNote error={data.error} />
      {r && r.errors.length > 0 && <div className="wd-warn">Could not read every registration from ExtraHand: {r.errors.join(" · ")}</div>}
      {!r && !data.error && (
        <div className="wx-sheet">
          <p className="wd-loading"><RefreshCw size={14} className="spin" /> Reading the last 30 days of registrations from ExtraHand… this takes a few seconds the first time.</p>
          <SkeletonRows rows={6} />
        </div>
      )}

      {r && h && c && (
        <>
          {/* ------------------------------------------------------------------ KPIs */}
          <div className="wd-kpis">
            <Kpi icon={HandHeart} color={HELPER} label="Helpers registered" value={h.periods[period].registered} note={`registered ${label}`} />
            <Kpi icon={UserRoundPlus} color={CUSTOMER} label="Customers registered" value={c.periods[period].registered} note={`registered ${label}`} />
            <Kpi icon={Send} color={HELPER} label="Welcomes to helpers" value={h.periods[period].sent}
              note={`${h.periods[period].read} read · ${h.periods[period].failed} failed`} />
            <Kpi icon={MessageCircle} color={CUSTOMER} label="Welcomes to customers" value={c.periods[period].sent}
              note={`${c.periods[period].read} read · ${c.periods[period].failed} failed`} />
          </div>

          {/* ------------------------------------------------------------------ 30 days */}
          <section className="wx-sheet">
            <div className="wd-head">
              <h2><BarChart3 size={16} /> Last 30 days</h2>
              <span className="wd-legend">
                <i style={{ background: HELPER }} /> Helpers registered <i style={{ background: CUSTOMER }} /> Customers registered
                <i className="line" /> Welcomes sent
              </span>
            </div>
            <Trend daily={r.daily} />
          </section>

          {/* ------------------------------------------------------------------ funnel + outcomes */}
          <div className="wd-two">
            <Funnel title="Helper journey" color={HELPER} a={h} />
            <Funnel title="Customer journey" color={CUSTOMER} a={c} />
          </div>

          <div className="wd-two">
            <section className="wx-sheet">
              <div className="wd-head"><h2><CheckCheck size={16} /> What happened to each welcome</h2><small>last 30 days</small></div>
              <Outcomes name="Helpers" a={h} />
              <Outcomes name="Customers" a={c} />
              <div className="wd-outcome-legend">
                {OUTCOMES.map((o) => <span key={o.key}><i style={{ background: o.color }} />{o.label}</span>)}
              </div>
            </section>

            <section className="wx-sheet">
              <div className="wd-head"><h2><MapPin size={16} /> Top cities</h2><small>registrations, last 30 days</small></div>
              {r.top_cities.length === 0 ? <p className="wd-empty">No city on the registrations yet.</p> : (
                <ul className="wd-cities">
                  {r.top_cities.map((x, i) => (
                    <li key={x.city}>
                      <span className="wd-rank">{i + 1}</span>
                      <span className="wd-city">{x.city}</span>
                      <span className="wd-city-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${pct(x.registered, r.top_cities[0].registered)}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05 }} /></span>
                      <b>{x.registered}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="wx-sheet">
            <div className="wd-head"><h2><Clock3 size={16} /> When people sign up</h2><small>registrations by hour (India time), last 30 days</small></div>
            <Hours hours={r.hours} />
          </section>

          <p className="wd-foot">
            <Users size={13} /> Registrations are real ExtraHand accounts (test accounts left out), read live and refreshed every
            5 minutes. All-time welcomes: {h.sent_all_time} helpers · {c.sent_all_time} customers.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: I, color, label, value, note }: { icon: typeof Users; color: string; label: string; value: number; note: string }) {
  return (
    <motion.div className="wd-kpi" style={{ "--c": color } as CSSProperties} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <span className="wd-kpi-icon"><I size={19} /></span>
      <span className="wd-kpi-label">{label}</span>
      <b className="wd-kpi-value"><AnimatedNumber value={value} /></b>
      <small>{note}</small>
    </motion.div>
  );
}

function Trend({ daily }: { daily: WaWelcomerDashboard["daily"] }) {
  const W = 900, H = 220, pad = 26;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.helper_registered + d.customer_registered, d.helper_sent + d.customer_sent)));
  const step = (W - pad * 2) / daily.length;
  const bw = Math.max(4, step * 0.62);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = daily.map((d, i) => `${i ? "L" : "M"}${(pad + i * step + step / 2).toFixed(1)},${y(d.helper_sent + d.customer_sent).toFixed(1)}`).join(" ");
  return (
    <div className="wd-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Registrations and welcomes per day, last 30 days">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad} x2={W - pad} y1={y(max * t)} y2={y(max * t)} className="wd-grid" />
            <text x={pad - 6} y={y(max * t) + 4} className="wd-axis" textAnchor="end">{Math.round(max * t)}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad + i * step + (step - bw) / 2;
          const hTop = y(d.helper_registered);
          const cTop = y(d.helper_registered + d.customer_registered);
          return (
            <g key={d.date}>
              <title>{`${short(d.date)}: ${d.helper_registered} helpers and ${d.customer_registered} customers registered · ${d.helper_sent} + ${d.customer_sent} welcomes sent`}</title>
              <motion.rect x={x} width={bw} rx={2} fill={HELPER} initial={{ y: H - pad, height: 0 }}
                animate={{ y: hTop, height: H - pad - hTop }} transition={{ duration: 0.5, delay: i * 0.012 }} />
              <motion.rect x={x} width={bw} rx={2} fill={CUSTOMER} initial={{ y: H - pad, height: 0 }}
                animate={{ y: cTop, height: hTop - cTop }} transition={{ duration: 0.5, delay: i * 0.012 }} />
              {(i % 5 === 0 || i === daily.length - 1) && (
                <text x={x + bw / 2} y={H - 6} className="wd-axis" textAnchor="middle">{short(d.date)}</text>
              )}
            </g>
          );
        })}
        <motion.path d={line} className="wd-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut" }} />
      </svg>
    </div>
  );
}

function Funnel({ title, color, a }: { title: string; color: string; a: WaWelcomerDashAudience }) {
  const f = a.funnel;
  const steps = [
    { label: "Registered", v: f.registered },
    { label: "With a phone", v: f.with_phone },
    { label: "Welcomed", v: f.welcomed },
    { label: "Delivered", v: f.delivered },
    { label: "Read", v: f.read },
  ];
  return (
    <section className="wx-sheet" style={{ "--c": color } as CSSProperties}>
      <div className="wd-head">
        <h2><span className="wd-dot" /> {title}</h2>
        <small>last 30 days</small>
      </div>
      <div className="wd-funnel">
        {steps.map((s, i) => (
          <div key={s.label} className="wd-step">
            <span className="wd-step-label">{s.label}</span>
            <span className="wd-step-bar">
              <motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(pct(s.v, f.registered), s.v ? 2 : 0)}%` }}
                transition={{ duration: 0.6, delay: i * 0.08 }} />
            </span>
            <b>{s.v}</b>
            <small>{i === 0 ? "" : `${pct(s.v, f.registered)}%`}</small>
          </div>
        ))}
      </div>
      <div className="wd-rates">
        <div><span>Welcomed</span><b>{a.coverage == null ? "—" : `${a.coverage}%`}</b><small>of people with a phone</small></div>
        <div><span>Read</span><b>{a.read_rate == null ? "—" : `${a.read_rate}%`}</b><small>of welcomes</small></div>
      </div>
    </section>
  );
}

function Outcomes({ name, a }: { name: string; a: WaWelcomerDashAudience }) {
  const total = OUTCOMES.reduce((s, o) => s + a.outcomes[o.key], 0);
  return (
    <div className="wd-outcome">
      <div className="wd-outcome-top"><b>{name}</b><small>{total} registered</small></div>
      <div className="wd-stack">
        {total === 0 ? <i style={{ width: "100%", background: "var(--border)" }} /> : OUTCOMES.map((o) => a.outcomes[o.key] > 0 && (
          <i key={o.key} style={{ width: `${(a.outcomes[o.key] / total) * 100}%`, background: o.color }} title={`${o.label}: ${a.outcomes[o.key]}`} />
        ))}
      </div>
    </div>
  );
}

function Hours({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const fmt = (hr: number) => `${hr % 12 || 12}${hr < 12 ? "am" : "pm"}`;
  return (
    <>
      <div className="wd-hours">
        {hours.map((v, i) => (
          <div key={i} className={`wd-hour ${i === peak && v > 0 ? "peak" : ""}`} title={`${fmt(i)}–${fmt((i + 1) % 24)}: ${v} registrations`}>
            <motion.i initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.015 }} />
            {i % 3 === 0 && <small>{fmt(i)}</small>}
          </div>
        ))}
      </div>
      {Math.max(...hours) > 0 && <p className="wd-peak">Busiest hour: <b>{fmt(peak)}–{fmt((peak + 1) % 24)}</b> · a good time for the welcome to arrive.</p>}
    </>
  );
}
