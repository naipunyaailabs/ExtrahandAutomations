import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  Bot,
  CalendarRange,
  ChevronDown,
  Cpu,
  Gauge,
  Info,
  ListOrdered,
  Megaphone,
  PhoneCall,
  PhoneForwarded,
  Receipt,
  RefreshCw,
  Save,
  Settings2,
  Table2,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Card, ErrorNote, SkeletonRows, useToastAction } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import "./commercials.css";
import type { CallingBulkCampaign, CallingBulkSummary, CommercialBucket, CommercialPeriod, CommercialPeriodKey, CommercialRates, CommercialSummary } from "../types";

/* ------------------------------------------------------------------------------------------------ formatting */

const inr = (x: number, exact = false) => {
  const small = Math.abs(x) < 100 || exact;
  return "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: small ? 2 : 0, maximumFractionDigits: small ? 2 : 0 });
};
const inrShort = (x: number) => (x >= 10 || x === 0 ? "₹" + Math.round(x).toLocaleString("en-IN") : inr(x));
const num = (x: number, digits = 0) => x.toLocaleString("en-IN", { maximumFractionDigits: digits });
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);

const PERIODS: { key: CommercialPeriodKey; label: string; prev?: string }[] = [
  { key: "today", label: "Today", prev: "yesterday" },
  { key: "week", label: "This week", prev: "last week" },
  { key: "month", label: "This month", prev: "last month" },
  { key: "all", label: "All time" },
];

const PURPOSE_LABEL: Record<string, { label: string; win: string }> = {
  dispatch: { label: "Job offers", win: "accepted" },
  followup: { label: "Reminders", win: "confirmed" },
  feedback: { label: "Rating calls", win: "rated" },
  callback: { label: "Callbacks", win: "" },
  bulk: { label: "Bulk campaigns", win: "" },
};

const SERIES = [
  { key: "ivr", label: "IVR line · Vobiz" },
  { key: "sarvam", label: "Sarvam AI" },
  { key: "infra", label: "LLM + LiveKit" },
] as const;

/** Marks a figure calculated from minutes rather than measured. */
const Est = () => <span className="cm-est" title="Estimated from agent minutes; the voice agent does not report this directly">est.</span>;

/* ------------------------------------------------------------------------------------------------------ page */

export function CallingAutomationCommercials() {
  const [period, setPeriod] = useUrlState<CommercialPeriodKey>("period", "month");
  const data = usePoll<CommercialSummary>(api.calling.commercialsAutomation, 60000);
  const [ratesOpen, setRatesOpen] = useState(false);
  const ratesRef = useRef<HTMLDivElement>(null);
  const s = data.data;
  const p = s?.periods[period];
  const meta = PERIODS.find((x) => x.key === period)!;

  const openRates = () => {
    setRatesOpen(true);
    setTimeout(() => ratesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <Stagger className="page cm-page">
      <motion.header className="cm-top" variants={itemVariants}>
        <div className="cm-title">
          <span className="cm-eyebrow"><Receipt size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} /> Calling Agent · Automation</span>
          <h1>Automation Spend</h1>
          <p className="muted">Usage and spend of automated IVR dispatch lines, reminder calls, feedback surveys, and the Maya voice stack.</p>
        </div>
        <div className="cm-top-controls">
          <div className="cm-seg" role="tablist" aria-label="Period">
            {PERIODS.map((x) => (
              <button key={x.key} role="tab" aria-selected={period === x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>
                {period === x.key && <motion.span layoutId="cm-seg-pill" className="cm-seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="cm-seg-text">{x.label}</span>
              </button>
            ))}
          </div>
          <div className="cm-live">
            {s && <span><i className="cm-live-dot" />Live · {new Date(s.generated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
            <button className="cm-icon-btn" onClick={data.refresh} aria-label="Refresh" title="Refresh"><RefreshCw size={15} /></button>
          </div>
        </div>
      </motion.header>

      <ErrorNote error={data.error} />
      {!s && !data.error && <Card><SkeletonRows rows={10} /></Card>}

      {s && p && (
        <>
          {!s.rates_customized && (
            <motion.div className="cm-ribbon" variants={itemVariants}>
              <AlertTriangle size={16} />
              <span><b>Prices are estimates.</b> Usage is live, but rupee amounts use default list prices until you enter your Vobiz and Sarvam rates.</span>
              <Button size="sm" variant="secondary" icon={Settings2} onClick={openRates}>Set my rates</Button>
            </motion.div>
          )}

          <Hero s={s} p={p} period={period} />

          <div className="cm-providers">
            <IvrCard p={p} rates={s.rates} />
            <SarvamCard p={p} metered={!!s.stack.tts_metered_since} />
            <InfraCard p={p} rates={s.rates} />
          </div>

          <div className="cm-row-trend">
            <DailyCard s={s} />
            <BudgetCard s={s} />
          </div>

          <PeriodTable s={s} active={period} />

          <div className="cm-row-2">
            <PurposeCard p={p} label={meta.label} />
            <MonthlyCard s={s} />
          </div>

          <div ref={ratesRef}>
            <RateCard rates={s.rates} open={ratesOpen} onToggle={() => setRatesOpen((o) => !o)} onSaved={data.refresh} />
          </div>
        </>
      )}
    </Stagger>
  );
}

export function CallingBulkCommercials() {
  const [period, setPeriod] = useUrlState<CommercialPeriodKey>("period", "month");
  const data = usePoll<CallingBulkSummary>(api.calling.commercialsBulk, 60000);
  const [ratesOpen, setRatesOpen] = useState(false);
  const ratesRef = useRef<HTMLDivElement>(null);
  const s = data.data;
  const p = s?.periods[period];
  const campaigns = s?.campaigns || [];

  const openRates = () => {
    setRatesOpen(true);
    setTimeout(() => ratesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <Stagger className="page cm-page">
      <motion.header className="cm-top" variants={itemVariants}>
        <div className="cm-title">
          <span className="cm-eyebrow"><Megaphone size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} /> Calling Agent · Bulk Calling</span>
          <h1>Bulk Spend</h1>
          <p className="muted">Commercials and campaign-level spend for outbound voice broadcasts and bulk announcements.</p>
        </div>
        <div className="cm-top-controls">
          <div className="cm-seg" role="tablist" aria-label="Period">
            {PERIODS.map((x) => (
              <button key={x.key} role="tab" aria-selected={period === x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>
                {period === x.key && <motion.span layoutId="cm-seg-pill-bulk" className="cm-seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="cm-seg-text">{x.label}</span>
              </button>
            ))}
          </div>
          <div className="cm-live">
            {s && <span><i className="cm-live-dot" />Live · {new Date(s.generated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
            <button className="cm-icon-btn" onClick={data.refresh} aria-label="Refresh" title="Refresh"><RefreshCw size={15} /></button>
          </div>
        </div>
      </motion.header>

      <ErrorNote error={data.error} />
      {!s && !data.error && <Card><SkeletonRows rows={10} /></Card>}

      {s && p && (
        <>
          {!s.rates_customized && (
            <motion.div className="cm-ribbon" variants={itemVariants}>
              <AlertTriangle size={16} />
              <span><b>Prices are estimates.</b> Usage is live, but rupee amounts use default list prices until you enter your Vobiz and Sarvam rates.</span>
              <Button size="sm" variant="secondary" icon={Settings2} onClick={openRates}>Set my rates</Button>
            </motion.div>
          )}

          <BulkHero s={s} p={p} period={period} campaignsCount={campaigns.length} />

          <BulkCampaignsTable campaigns={campaigns} />

          <BulkProviders p={p} rates={s.rates} />

          <div className="cm-row-trend">
            <DailyCard s={s} />
            <BudgetCard s={s} />
          </div>

          <PeriodTable s={s} active={period} />

          <div ref={ratesRef}>
            <RateCard rates={s.rates} open={ratesOpen} onToggle={() => setRatesOpen((o) => !o)} onSaved={data.refresh} />
          </div>
        </>
      )}
    </Stagger>
  );
}

export default CallingAutomationCommercials;

/* ----------------------------------------------------------------------------------------------------- hero */

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (!prev) return <span className="cm-chip cm-chip-muted">{now ? `Nothing spent ${label}` : `No spend ${label} either`}</span>;
  const change = ((now - prev) / prev) * 100;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`cm-chip ${up ? "cm-chip-up" : "cm-chip-down"}`} title={`${label}: ${inr(prev)}`}>
      <Icon size={13} /> {num(Math.abs(change))}% vs {label}
    </span>
  );
}

function Hero({ s, p, period }: { s: CommercialSummary; p: CommercialPeriod; period: CommercialPeriodKey }) {
  const meta = PERIODS.find((x) => x.key === period)!;
  const parts = [
    { key: "ivr", label: "IVR · Vobiz", v: p.ivr.cost },
    { key: "sarvam", label: "Sarvam AI", v: p.sarvam.cost },
    { key: "infra", label: "LLM + LiveKit", v: p.agent_infra.cost },
  ];
  const spend = s.daily.map((d) => d.ivr + d.sarvam + d.infra);
  const calls = s.daily.map((d) => d.calls);
  const perCall = s.daily.map((d, i) => (d.calls ? spend[i] / d.calls : 0));

  return (
    <motion.section className="cm-hero" variants={itemVariants}>
      <div className="cm-hero-main">
        <span className="cm-label">Total spend · {meta.label.toLowerCase()}</span>
        <div className="cm-hero-value tabular">{inr(p.total_cost)}</div>
        <div className="cm-hero-meta">
          {period !== "all" ? <Delta now={p.total_cost} prev={s.previous[period as Exclude<CommercialPeriodKey, "all">]} label={meta.prev!} /> : <span className="cm-chip cm-chip-muted">Since the first call</span>}
          {p.test_calls > 0 && <span className="cm-chip cm-chip-muted" title="Simulator calls cost nothing and are not counted"><Info size={12} /> {num(p.test_calls)} test calls excluded</span>}
        </div>
        <div className="cm-split" aria-hidden>
          {p.total_cost > 0
            ? parts.map((x) => x.v > 0 && <span key={x.key} className={`cm-c-${x.key}`} style={{ flexGrow: x.v }} />)
            : <span className="cm-split-empty" />}
        </div>
        <ul className="cm-split-legend">
          {parts.map((x) => (
            <li key={x.key}>
              <i className={`cm-dot cm-c-${x.key}`} />
              <span>{x.label}</span>
              <b className="tabular">{inr(x.v)}</b>
              <em className="tabular">{num(pct(x.v, p.total_cost))}%</em>
            </li>
          ))}
        </ul>
      </div>

      <div className="cm-hero-tiles">
        <Tile label="Calls placed" value={num(p.calls)} sub={`${num(p.connected)} connected`} spark={calls} />
        <Tile label="Connect rate" value={`${p.connect_rate}%`} sub={`${num(p.calls - p.connected)} not answered`} ring={p.connect_rate} />
        <Tile label="Cost per call" value={inr(p.cost_per_call, true)} sub={`${inr(p.cost_per_connected, true)} per connected`} spark={perCall} />
        <Tile label="Cost per talk minute" value={inr(p.cost_per_minute, true)} sub={`${num(p.ivr.talk_minutes, 1)} min talked`} spark={spend} />
      </div>
    </motion.section>
  );
}

function BulkHero({ s, p, period, campaignsCount }: { s: CallingBulkSummary; p: CommercialPeriod; period: CommercialPeriodKey; campaignsCount: number }) {
  const meta = PERIODS.find((x) => x.key === period)!;
  const parts = [
    { key: "ivr", label: "Outbound Calls · Vobiz", v: p.ivr.cost },
    { key: "sarvam", label: "Broadcast Voice · Sarvam", v: p.sarvam.cost },
  ];
  const spend = s.daily.map((d) => d.ivr + d.sarvam + d.infra);
  const calls = s.daily.map((d) => d.calls);
  const perCall = s.daily.map((d, i) => (d.calls ? spend[i] / d.calls : 0));

  return (
    <motion.section className="cm-hero" variants={itemVariants}>
      <div className="cm-hero-main">
        <span className="cm-label">Bulk spend · {meta.label.toLowerCase()}</span>
        <div className="cm-hero-value tabular">{inr(p.total_cost)}</div>
        <div className="cm-hero-meta">
          {period !== "all" ? <Delta now={p.total_cost} prev={s.previous[period as Exclude<CommercialPeriodKey, "all">]} label={meta.prev!} /> : <span className="cm-chip cm-chip-muted">Since first campaign</span>}
          <span className="cm-chip cm-chip-muted"><Megaphone size={12} /> {num(campaignsCount)} campaigns</span>
        </div>
        <div className="cm-split" aria-hidden>
          {p.total_cost > 0
            ? parts.map((x) => x.v > 0 && <span key={x.key} className={`cm-c-${x.key}`} style={{ flexGrow: x.v }} />)
            : <span className="cm-split-empty" />}
        </div>
        <ul className="cm-split-legend">
          {parts.map((x) => (
            <li key={x.key}>
              <i className={`cm-dot cm-c-${x.key}`} />
              <span>{x.label}</span>
              <b className="tabular">{inr(x.v)}</b>
              <em className="tabular">{num(pct(x.v, p.total_cost))}%</em>
            </li>
          ))}
        </ul>
      </div>

      <div className="cm-hero-tiles">
        <Tile label="Broadcast calls" value={num(p.calls)} sub={`${num(p.connected)} answered`} spark={calls} />
        <Tile label="Connect rate" value={`${p.connect_rate}%`} sub={`${num(p.calls - p.connected)} failed / busy`} ring={p.connect_rate} />
        <Tile label="Cost per call" value={inr(p.cost_per_call, true)} sub={`${inr(p.cost_per_connected, true)} per connected`} spark={perCall} />
        <Tile label="Cost per talk minute" value={inr(p.cost_per_minute, true)} sub={`${num(p.ivr.talk_minutes, 1)} min talked`} spark={spend} />
      </div>
    </motion.section>
  );
}

function BulkProviders({ p, rates }: { p: CommercialPeriod; rates: CommercialRates }) {
  return (
    <div className="cm-providers" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <Provider kind="ivr" icon={PhoneCall} name="Outbound Telephony" role="Vobiz batch dialing" cost={p.ivr.cost} share={pct(p.ivr.cost, p.total_cost)}
        foot={<CostLine label="Billed minutes" note={`${num(p.ivr.billed_minutes, 1)} min × ${inr(rates.vobiz_per_min, true)}`} value={p.ivr.call_cost} />}>
        <div className="cm-stats">
          <Stat label="Total calls" value={num(p.calls)} />
          <Stat label="Connected" value={num(p.connected)} hint={`${p.connect_rate}% answer rate`} />
          <Stat label="Talk duration" value={`${num(p.ivr.talk_minutes, 1)} min`} />
        </div>
      </Provider>

      <Provider kind="sarvam" icon={AudioLines} name="Broadcast Voice" role="Sarvam AI audio synthesis" cost={p.sarvam.cost} share={pct(p.sarvam.cost, p.total_cost)}
        foot={<CostLine label="Broadcast audio (Bulbul TTS)" value={p.sarvam.ivr_tts_cost} />}>
        <div className="cm-stats">
          <Stat label="Audio requests" value={num(p.sarvam.ivr_tts_requests)} hint="pre-synthesized per campaign" />
          <Stat label="Characters spoken" value={num(p.sarvam.ivr_tts_chars)} />
        </div>
      </Provider>
    </div>
  );
}

function BulkCampaignsTable({ campaigns }: { campaigns: CallingBulkCampaign[] }) {
  return (
    <Card title="Bulk Calling Campaigns" icon={ListOrdered}>
      {campaigns.length === 0 ? (
        <div className="cm-empty">
          <PhoneForwarded size={20} />
          <span>No bulk calling campaigns recorded yet.</span>
        </div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Campaign</th>
                <th>Date</th>
                <th>Contacts</th>
                <th>Answered / Failed</th>
                <th>Connect Rate</th>
                <th>Talk Duration</th>
                <th>Total Cost</th>
                <th>Cost / Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: "left" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxWidth: 220 }}>
                      <b style={{ color: "var(--text)" }}>{c.title}</b>
                      <small style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.script}>
                        {c.script}
                      </small>
                    </div>
                  </td>
                  <td className="tabular">{c.created_at ? new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="tabular">{num(c.total_contacts)}</td>
                  <td className="tabular">{num(c.completed_calls)} / {num(c.failed_calls)}</td>
                  <td className="tabular">{num(c.connect_rate, 1)}%</td>
                  <td className="tabular">{secs(c.duration_seconds)}</td>
                  <td className="tabular" style={{ fontWeight: 700, color: "var(--text)" }}>{inr(c.cost)}</td>
                  <td className="tabular">{inr(c.cost_per_contact, true)}</td>
                  <td>
                    <span className={`cm-chip ${c.status === "active" ? "cm-chip-up" : c.status === "completed" ? "cm-chip-muted" : "cm-chip-down"}`}>
                      {c.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, sub, spark, ring }: { label: string; value: string; sub: string; spark?: number[]; ring?: number }) {
  return (
    <div className="cm-tile">
      <div className="cm-tile-text">
        <span className="cm-label">{label}</span>
        <b className="tabular">{value}</b>
        <span className="cm-tile-sub">{sub}</span>
      </div>
      {spark && <Sparkline values={spark} />}
      {ring !== undefined && <Ring value={ring} />}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 96, h = 34;
  const max = Math.max(...values, 0);
  if (max <= 0) return <svg className="cm-spark" width={w} height={h} aria-hidden><line x1="0" y1={h - 2} x2={w} y2={h - 2} className="cm-spark-flat" /></svg>;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="cm-spark" width={w} height={h} aria-label="Last 30 days" role="img">
      <title>Last 30 days</title>
      <polygon points={`0,${h} ${line} ${w},${h}`} className="cm-spark-area" />
      <polyline points={line} className="cm-spark-line" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.5" className="cm-spark-end" />
    </svg>
  );
}

function Ring({ value }: { value: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg className="cm-ring" width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r={r} className="cm-ring-track" />
      {value > 0 && <circle cx="20" cy="20" r={r} className="cm-ring-value" strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} transform="rotate(-90 20 20)" />}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------- provider cards */

function Provider({ kind, icon: Icon, name, role, cost, share, children, foot }: {
  kind: "ivr" | "sarvam" | "infra"; icon: typeof PhoneCall; name: string; role: string; cost: number; share: number; children: ReactNode; foot?: ReactNode;
}) {
  return (
    <motion.section className={`cm-prov cm-prov-${kind}`} variants={itemVariants}>
      <header>
        <span className={`cm-prov-icon cm-t-${kind}`}><Icon size={18} /></span>
        <div className="cm-prov-name"><b>{name}</b><span>{role}</span></div>
        <div className="cm-prov-cost"><b className="tabular">{inr(cost)}</b><span className="tabular">{num(share)}% of spend</span></div>
      </header>
      <div className="cm-prov-body">{children}</div>
      {foot && <footer>{foot}</footer>}
    </motion.section>
  );
}

function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="cm-stat">
      <span>{label}</span>
      <b className="tabular">{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function CostLine({ label, value, note }: { label: ReactNode; value: number; note?: ReactNode }) {
  return (
    <div className="cm-costline">
      <span>{label}</span>
      {note && <em>{note}</em>}
      <b className="tabular">{inr(value)}</b>
    </div>
  );
}

function IvrCard({ p, rates }: { p: CommercialPeriod; rates: CommercialRates }) {
  const placed = p.ivr.calls + p.ivr.bulk_calls;
  const steps = [
    { label: "Placed", v: placed },
    { label: "Connected", v: p.ivr.connected },
    { label: "Handed to Maya", v: p.sarvam.handoffs },
  ];
  return (
    <Provider kind="ivr" icon={PhoneCall} name="IVR line" role="Vobiz telephony" cost={p.ivr.cost} share={pct(p.ivr.cost, p.total_cost)}
      foot={<>
        <CostLine label="Call minutes" note={`${num(p.ivr.billed_minutes, 1)} min × ${inr(rates.vobiz_per_min, true)}`} value={p.ivr.call_cost} />
        <CostLine label="Hand-off leg" note={`× ${inr(rates.handoff_leg_per_min, true)}/min`} value={p.ivr.handoff_leg_cost} />
      </>}>
      <div className="cm-funnel">
        {steps.map((st) => (
          <div key={st.label} className="cm-funnel-row">
            <span className="cm-funnel-label">{st.label}</span>
            <span className="cm-funnel-track"><span className="cm-c-ivr" style={{ width: `${placed ? Math.max(st.v ? 2 : 0, pct(st.v, placed)) : 0}%` }} /></span>
            <b className="tabular">{num(st.v)}</b>
            <em className="tabular">{placed ? `${num(pct(st.v, placed))}%` : "—"}</em>
          </div>
        ))}
      </div>
      <div className="cm-stats">
        <Stat label="Talk time" value={`${num(p.ivr.talk_minutes, 1)} min`} />
        <Stat label="Billed" value={`${num(p.ivr.billed_minutes, 1)} min`} hint={`${rates.vobiz_pulse_seconds}s pulse`} />
        <Stat label="Avg call" value={secs(p.ivr.avg_call_seconds)} hint={p.ivr.bulk_calls ? `${num(p.ivr.bulk_calls)} bulk calls` : undefined} />
      </div>
    </Provider>
  );
}

function SarvamCard({ p, metered }: { p: CommercialPeriod; metered: boolean }) {
  const sv = p.sarvam;
  return (
    <Provider kind="sarvam" icon={AudioLines} name="Sarvam AI" role="Telugu voice · speech AI" cost={sv.cost} share={pct(sv.cost, p.total_cost)}
      foot={<>
        <CostLine label="IVR audio (Bulbul TTS)" value={sv.ivr_tts_cost} />
        <CostLine label="Maya listening (Saaras STT)" value={sv.stt_cost} />
        <CostLine label={<>Maya speaking (Bulbul TTS) <Est /></>} value={sv.agent_tts_cost} />
      </>}>
      <div className="cm-split-panels">
        <div className="cm-panel">
          <span className="cm-panel-title"><AudioLines size={13} /> IVR voice</span>
          <Stat label="Characters" value={num(sv.ivr_tts_chars)} />
          <Stat label="Requests" value={num(sv.ivr_tts_requests)} hint="repeats are cached" />
        </div>
        <div className="cm-panel">
          <span className="cm-panel-title"><Bot size={13} /> Maya agent</span>
          <Stat label="Hand-offs" value={num(sv.handoffs)} hint={`${num(sv.handoffs_connected)} reached Maya`} />
          <Stat label="Agent time" value={`${num(sv.agent_minutes, 1)} min`} hint={sv.handoffs_connected ? `avg ${secs(sv.avg_handoff_seconds)}` : undefined} />
        </div>
      </div>
      {!metered && <p className="cm-hint"><Info size={12} /> IVR audio is counted from this update onwards.</p>}
    </Provider>
  );
}

function InfraCard({ p, rates }: { p: CommercialPeriod; rates: CommercialRates }) {
  return (
    <Provider kind="infra" icon={Cpu} name="Agent infra" role="LLM + LiveKit" cost={p.agent_infra.cost} share={pct(p.agent_infra.cost, p.total_cost)}
      foot={<>
        <CostLine label={<>Gemini 2.5 Flash <Est /></>} value={p.agent_infra.llm_cost} />
        <CostLine label={<>LiveKit session <Est /></>} value={p.agent_infra.livekit_cost} />
      </>}>
      <div className="cm-stats cm-stats-col">
        <Stat label="Agent minutes" value={`${num(p.sarvam.agent_minutes, 1)} min`} />
        <Stat label="Per agent minute" value={inr(rates.llm_per_min + rates.livekit_per_min, true)} hint="LLM + LiveKit" />
      </div>
    </Provider>
  );
}

/* ---------------------------------------------------------------------------------------------------- trend */

const dayLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

function DailyCard({ s }: { s: CommercialSummary }) {
  const totals = s.daily.map((d) => d.ivr + d.sarvam + d.infra);
  const sum = totals.reduce((a, b) => a + b, 0);
  const active = totals.filter((t) => t > 0).length;
  const peakIdx = totals.indexOf(Math.max(...totals));
  return (
    <Card title="Daily spend · last 30 days" icon={BarChart3}>
      <div className="cm-chart-stats">
        <Stat label="30-day total" value={inr(sum)} />
        <Stat label="Avg per active day" value={inr(active ? sum / active : 0)} hint={`${active} active day${active === 1 ? "" : "s"}`} />
        <Stat label="Peak day" value={sum ? inr(totals[peakIdx]) : "—"} hint={sum ? dayLabel(s.daily[peakIdx].date) : undefined} />
      </div>
      <StackedBars rows={s.daily.map((d) => ({ ...d, label: d.date }))} fmtLabel={dayLabel} every={5} height={190} />
    </Card>
  );
}

function MonthlyCard({ s }: { s: CommercialSummary }) {
  return (
    <Card title="Monthly spend · last 6 months" icon={CalendarRange}>
      <StackedBars rows={s.monthly.map((m) => ({ ...m, label: m.month }))} fmtLabel={monthLabel} every={1} height={210} />
    </Card>
  );
}

function niceMax(x: number) {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function StackedBars({ rows, fmtLabel, every, height }: { rows: (CommercialBucket & { label: string })[]; fmtLabel: (l: string) => string; every: number; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = rows.map((r) => r.ivr + r.sarvam + r.infra);
  const max = niceMax(Math.max(...totals));
  const empty = totals.every((t) => t === 0);
  const h = hover !== null ? rows[hover] : null;
  const tipLeft = hover !== null ? Math.min(85, Math.max(15, ((hover + 0.5) / rows.length) * 100)) : 0;

  return (
    <div className="cm-chart">
      <div className="cm-legend">
        {SERIES.map((x) => <span key={x.key}><i className={`cm-dot cm-c-${x.key}`} />{x.label}</span>)}
      </div>
      <div className="cm-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="cm-gridlines" aria-hidden>
          {[1, 0.5, 0].map((f) => <div key={f}><span className="tabular">{inrShort(max * f)}</span></div>)}
        </div>
        {empty && <div className="cm-chart-empty">No billed usage in this window yet</div>}
        <div className="cm-bars">
          {rows.map((r, i) => (
            <div key={r.label} className={`cm-col ${hover === i ? "cm-hover" : ""} ${hover !== null && hover !== i ? "cm-dim" : ""}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
              aria-label={`${fmtLabel(r.label)}: ${inr(totals[i])}`}>
              <div className="cm-stackcol" style={{ height: `${(totals[i] / max) * 100}%` }}>
                {SERIES.map((x) => r[x.key] > 0 && <span key={x.key} className={`cm-c-${x.key}`} style={{ flexGrow: r[x.key] }} />)}
              </div>
            </div>
          ))}
        </div>
        {h && hover !== null && (
          <div className="cm-tip" style={{ left: `${tipLeft}%` }}>
            <b>{fmtLabel(h.label)}</b>
            {SERIES.map((x) => <div key={x.key}><i className={`cm-dot cm-c-${x.key}`} />{x.label}<span className="tabular">{inr(h[x.key])}</span></div>)}
            <div className="cm-tip-total">Total<span className="tabular">{inr(totals[hover])}</span></div>
            <div className="cm-tip-calls">{num(h.calls)} calls</div>
          </div>
        )}
      </div>
      <div className="cm-xlabels">
        {rows.map((r, i) => <span key={r.label}>{i % every === 0 || i === rows.length - 1 ? fmtLabel(r.label) : ""}</span>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------- budget */

function BudgetCard({ s }: { s: CommercialSummary }) {
  const pr = s.projection;
  const used = pr.budget_used_pct ?? 0;
  const proj = pr.projected_budget_pct ?? 0;
  const over = proj > 100;
  const r = 58, c = 2 * Math.PI * r;
  const arc = (v: number) => `${(Math.min(100, v) / 100) * c} ${c}`;
  return (
    <Card title="Month vs budget" icon={Gauge}>
      <div className="cm-budget">
        <div className="cm-gauge">
          <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={`${used}% of budget used`}>
            <circle cx="70" cy="70" r={r} className="cm-gauge-track" />
            {proj > 0 && <circle cx="70" cy="70" r={r} className={`cm-gauge-proj ${over ? "cm-over" : ""}`} strokeDasharray={arc(proj)} transform="rotate(-90 70 70)" />}
            {used > 0 && <circle cx="70" cy="70" r={r} className="cm-gauge-used" strokeDasharray={arc(used)} transform="rotate(-90 70 70)" />}
          </svg>
          <div className="cm-gauge-center">
            <b className="tabular">{num(used, 1)}%</b>
            <span>of {inrShort(pr.budget)}</span>
          </div>
        </div>
        <div className="cm-budget-facts">
          <Stat label="Spent so far" value={inr(pr.month_to_date)} />
          <Stat label="Projected month-end" value={inr(pr.projected_month)} hint={`${num(proj)}% of budget`} />
          <Stat label="Daily run-rate" value={inr(pr.days_elapsed ? pr.month_to_date / pr.days_elapsed : 0, true)} hint={`day ${Math.ceil(pr.days_elapsed)} of ${pr.days_in_month}`} />
        </div>
      </div>
      <div className={`cm-verdict ${over ? "cm-verdict-bad" : "cm-verdict-ok"}`}>
        {over
          ? <><AlertTriangle size={14} /> At this pace you'll exceed budget by {inr(pr.projected_month - pr.budget)}.</>
          : <>On pace · {inr(Math.max(0, pr.budget - pr.projected_month))} headroom left this month.</>}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------------------------- period comparison */

function PeriodTable({ s, active }: { s: CommercialSummary; active: CommercialPeriodKey }) {
  const rows: { label: string; get: (p: CommercialPeriod) => string; strong?: boolean; group?: string; dot?: string }[] = [
    { label: "Total spend", get: (p) => inr(p.total_cost), strong: true },
    { label: "Calls placed", get: (p) => num(p.calls) },
    { label: "Connected", get: (p) => num(p.connected) },
    { label: "Cost per call", get: (p) => inr(p.cost_per_call, true) },
    { label: "Billed minutes", get: (p) => num(p.ivr.billed_minutes, 1), group: "IVR line · Vobiz", dot: "ivr" },
    { label: "IVR cost", get: (p) => inr(p.ivr.cost), strong: true },
    { label: "IVR audio characters", get: (p) => num(p.sarvam.ivr_tts_chars), group: "Sarvam AI", dot: "sarvam" },
    { label: "Maya hand-offs", get: (p) => num(p.sarvam.handoffs) },
    { label: "Agent minutes", get: (p) => num(p.sarvam.agent_minutes, 1) },
    { label: "Sarvam cost", get: (p) => inr(p.sarvam.cost), strong: true },
    { label: "LLM + LiveKit cost", get: (p) => inr(p.agent_infra.cost), group: "Agent infra", dot: "infra", strong: true },
  ];
  return (
    <Card title="Usage at a glance" icon={Table2}>
      <div className="cm-table-wrap">
        <table className="cm-table cm-table-periods">
          <thead>
            <tr>
              <th />
              {PERIODS.map((p) => <th key={p.key} className={p.key === active ? "cm-active" : ""}>{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.label}>
                {r.group && <tr className="cm-group"><td colSpan={5}><i className={`cm-dot cm-c-${r.dot}`} />{r.group}</td></tr>}
                <tr className={r.strong ? "cm-strong" : ""}>
                  <td>{r.label}</td>
                  {PERIODS.map((p) => <td key={p.key} className={`tabular ${p.key === active ? "cm-active" : ""}`}>{r.get(s.periods[p.key])}</td>)}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------- purposes */

function PurposeCard({ p, label }: { p: CommercialPeriod; label: string }) {
  const max = Math.max(...p.by_purpose.map((x) => x.cost), 0);
  return (
    <Card title={`Cost by call type · ${label.toLowerCase()}`} icon={ListOrdered}>
      {p.by_purpose.length === 0 ? (
        <div className="cm-empty"><PhoneCall size={20} /><span>No billed calls in this period.</span></div>
      ) : (
        <ul className="cm-purposes">
          {p.by_purpose.map((x) => {
            const meta = PURPOSE_LABEL[x.purpose] ?? { label: x.purpose, win: "" };
            return (
              <li key={x.purpose}>
                <div className="cm-purpose-head">
                  <b>{meta.label}</b>
                  <span className="tabular">{inr(x.cost)}</span>
                </div>
                <span className="cm-purpose-track"><span className="cm-c-ivr" style={{ width: `${max ? pct(x.cost, max) : 0}%` }} /></span>
                <div className="cm-purpose-meta tabular">
                  <span>{num(x.calls)} calls</span>
                  <span>{num(pct(x.connected, x.calls))}% connected</span>
                  <span>{inr(x.cost_per_call, true)} / call</span>
                  {x.cost_per_win != null && <span className="cm-win">{inr(x.cost_per_win, true)} per {meta.win}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------------------- rates */

const RATE_GROUPS: { title: string; dot: string; fields: { key: keyof CommercialRates; label: string; unit: string; step: number }[] }[] = [
  { title: "Vobiz", dot: "ivr", fields: [
    { key: "vobiz_per_min", label: "Outbound call", unit: "₹ / min", step: 0.01 },
    { key: "vobiz_pulse_seconds", label: "Billing pulse", unit: "sec", step: 1 },
    { key: "handoff_leg_per_min", label: "Hand-off leg (SIP)", unit: "₹ / min", step: 0.01 },
  ] },
  { title: "Sarvam", dot: "sarvam", fields: [
    { key: "sarvam_tts_per_10k_chars", label: "TTS · Bulbul v3", unit: "₹ / 10K chars", step: 0.5 },
    { key: "sarvam_stt_per_hour", label: "STT · Saaras v3", unit: "₹ / hour", step: 0.5 },
    { key: "agent_tts_chars_per_min", label: "Maya speech", unit: "chars / min", step: 10 },
  ] },
  { title: "Agent infra & budgets", dot: "infra", fields: [
    { key: "llm_per_min", label: "LLM · Gemini Flash", unit: "₹ / min", step: 0.01 },
    { key: "livekit_per_min", label: "LiveKit session", unit: "₹ / min", step: 0.01 },
    { key: "automation_budget", label: "Automation budget", unit: "₹", step: 100 },
    { key: "bulk_budget", label: "Bulk budget", unit: "₹", step: 100 },
  ] },
];

function RateCard({ rates, open, onToggle, onSaved }: { rates: CommercialRates; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CommercialRates>(rates);
  const action = useToastAction();
  useEffect(() => setForm(rates), [rates]);
  const dirty = RATE_GROUPS.some((g) => g.fields.some((f) => form[f.key] !== rates[f.key]));

  const save = async () => {
    const ok = await action.run(() => api.saveCommercialRates(form), "Rate card saved");
    if (ok) onSaved();
  };

  return (
    <motion.section className="cm-rates-card" variants={itemVariants}>
      <button className="cm-rates-head" onClick={onToggle} aria-expanded={open}>
        <span className="cm-prov-icon cm-t-neutral"><Settings2 size={16} /></span>
        <div><b>Rate card</b><span>Prices behind every rupee on this page · recalculates past periods too</span></div>
        <ChevronDown size={18} className={`cm-chev ${open ? "open" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="cm-rates-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="cm-rate-groups">
              {RATE_GROUPS.map((g) => (
                <fieldset key={g.title}>
                  <legend><i className={`cm-dot cm-c-${g.dot}`} />{g.title}</legend>
                  {g.fields.map((f) => (
                    <label key={f.key}>
                      <span>{f.label}</span>
                      <div className="cm-input">
                        <input type="number" min={0} step={f.step} value={form[f.key]}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "" ? 0 : Number(e.target.value) })} />
                        <em>{f.unit}</em>
                      </div>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="cm-rates-actions">
              {dirty && <Button size="sm" variant="ghost" onClick={() => setForm(rates)}>Discard</Button>}
              <Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={action.busy} onClick={save}>Save rates</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
