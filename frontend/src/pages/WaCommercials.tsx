import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCheck,
  Check,
  Clock3,
  FileText,
  Lightbulb,
  Megaphone,
  MessageCircleReply,
  Receipt,
  RefreshCw,
  SlidersHorizontal,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { Button, ErrorNote, SkeletonRows, useToastAction } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { WaAutomationReport, WaBulkReport, WaCampaign, WaCategory, WaPeriod, WaPeriodKey, WaRates, WaReport } from "../types";
import "./wa-commercials.css";

/* ------------------------------------------------------------------------------------------------ formatting */

const inr = (x: number, exact = false) => {
  const small = Math.abs(x) < 100 || exact;
  return "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: small ? 2 : 0, maximumFractionDigits: small ? 2 : 0 });
};
const num = (x: number, d = 0) => x.toLocaleString("en-IN", { maximumFractionDigits: d });
const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

const PERIODS: { key: WaPeriodKey; label: string; prev?: string }[] = [
  { key: "today", label: "Today", prev: "yesterday" },
  { key: "week", label: "This week", prev: "last week" },
  { key: "month", label: "This month", prev: "last month" },
  { key: "all", label: "All time" },
];

const CATEGORY: Record<string, { label: string; note: string }> = {
  marketing: { label: "Marketing", note: "promotions, offers" },
  utility: { label: "Utility", note: "work orders, updates" },
  authentication: { label: "Authentication", note: "one-time codes" },
  service: { label: "Service", note: "replies in 24 h window · free" },
};

const PURPOSE: Record<string, string> = {
  work_order: "Work orders",
  broadcast: "Location broadcasts",
  agent_broadcast: "Agent broadcasts",
  assignment: "Assignment confirmations",
  reminder: "Reminders",
  reply: "Replies to helpers",
  other: "Other",
};

/** Start of a period in India time, as a UTC timestamp (for filtering campaigns client-side). */
function periodStart(key: WaPeriodKey): number | null {
  if (key === "all") return null;
  const IST = 330 * 60000;
  const now = new Date(Date.now() + IST);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (key === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (key === "month") d.setUTCDate(1);
  return d.getTime() - IST;
}

/* ============================================================================================== pages */

export function WaAutomationCommercials() {
  const [period, setPeriod] = useUrlState<WaPeriodKey>("period", "month");
  const data = usePoll<WaAutomationReport>(api.whatsapp.commercialsAutomation, 60000);
  const [drawer, setDrawer] = useState(false);
  const r = data.data;
  const p = r?.periods[period];
  const o = r?.outcomes[period];

  return (
    <div className="wx-page">
      <ErrorNote error={data.error} />
      {!r && !data.error && <div className="wx-sheet"><SkeletonRows rows={10} /></div>}
      {r && p && o && (
        <>
          <Banner
            kicker="WhatsApp Agent · Automation"
            title="Automation Commercials"
            icon={Receipt}
            report={r}
            period={period}
            setPeriod={setPeriod}
            onRefresh={data.refresh}
            onRates={() => setDrawer(true)}
            figures={[
              { label: "Messages sent", value: num(p.accepted), sub: `${num(p.recipients)} helpers reached` },
              { label: "Delivered", value: `${p.delivery_rate}%`, sub: `${num(p.delivered)} messages` },
              { label: "Read", value: `${p.read_rate}%`, sub: "of delivered" },
              { label: "Per accepted job", value: o.jobs_accepted ? inr(o.cost_per_acceptance, true) : "—", sub: `${num(o.jobs_accepted)} jobs accepted on WhatsApp` },
            ]}
          />

          <Insights p={p} report={r} kind="automation" onRates={() => setDrawer(true)} />

          <div className="wx-grid">
            <Section n="01" title="Delivery" aside={<Pending p={p} />}>
              <Staircase p={p} />
            </Section>
            <Section n="02" title="What Meta bills it as">
              <Categories p={p} />
            </Section>
          </div>

          <Section n="03" title="Last 30 days" aside={<span className="wx-aside">Messages per day · cost per day below</span>}>
            <Activity daily={r.daily} />
          </Section>

          <div className="wx-grid">
            <Section n="04" title="What the automation sends">
              {o.purposes.length === 0 ? <Empty text="No automated messages in this period." /> : (
                <table className="wx-ledger">
                  <thead><tr><th>Message</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th><th>Cost</th></tr></thead>
                  <tbody>
                    {o.purposes.map((x) => (
                      <tr key={x.purpose}>
                        <td>{PURPOSE[x.purpose] ?? x.purpose}</td>
                        <td className="tabular">{num(x.sent)}</td>
                        <td className="tabular">{num(x.delivered)} <small>{x.delivery_rate}%</small></td>
                        <td className="tabular">{num(x.read)}</td>
                        <td className={`tabular ${x.failed ? "wx-bad" : ""}`}>{num(x.failed)}</td>
                        <td className="tabular"><b>{inr(x.cost)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            <Section n="05" title="Unit economics">
              <div className="wx-units">
                <Unit label="Tickets messaged" value={num(o.tickets)} />
                <Unit label="Messages per ticket" value={num(o.messages_per_ticket, 1)} />
                <Unit label="Cost per ticket" value={inr(o.cost_per_ticket, true)} />
                <Unit label="Cost per delivered msg" value={inr(p.cost_per_delivered, true)} />
                <Unit label="Jobs accepted on WhatsApp" value={num(o.jobs_accepted)} />
                <Unit label="Cost per accepted job" value={o.jobs_accepted ? inr(o.cost_per_acceptance, true) : "—"} accent />
              </div>
            </Section>
          </div>

          <Section n="06" title="Why messages failed">
            <Failures p={p} />
          </Section>

          <RateDrawer open={drawer} rates={r.rates} onClose={() => setDrawer(false)} onSaved={data.refresh} />
        </>
      )}
    </div>
  );
}

export function WaBulkCommercials() {
  const [period, setPeriod] = useUrlState<WaPeriodKey>("period", "month");
  const data = usePoll<WaBulkReport>(api.whatsapp.commercialsBulk, 60000);
  const [drawer, setDrawer] = useState(false);
  const r = data.data;
  const p = r?.periods[period];
  const start = periodStart(period);
  const campaigns = useMemo(() => (r?.campaigns ?? []).filter((c) => start === null || Date.parse(c.created_at) >= start), [r, start]);

  return (
    <div className="wx-page">
      <ErrorNote error={data.error} />
      {!r && !data.error && <div className="wx-sheet"><SkeletonRows rows={10} /></div>}
      {r && p && (
        <>
          <Banner
            kicker="WhatsApp Agent · Bulk Msgs"
            title="Bulk Commercials"
            icon={Megaphone}
            report={r}
            period={period}
            setPeriod={setPeriod}
            onRefresh={data.refresh}
            onRates={() => setDrawer(true)}
            figures={[
              { label: "Campaigns", value: num(campaigns.length), sub: `${num(p.accepted)} messages sent` },
              { label: "Read rate", value: `${p.read_rate}%`, sub: `${num(p.read)} people read it` },
              { label: "Reply rate", value: `${p.reply_rate}%`, sub: `${num(p.replied)} replied in 48 h` },
              { label: "Cost per read", value: p.read ? inr(p.cost_per_read, true) : "—", sub: `${inr(p.cost_per_delivered, true)} per delivered` },
            ]}
          />

          <Insights p={p} report={r} kind="bulk" onRates={() => setDrawer(true)} />

          <Section n="01" title="Campaigns" aside={<span className="wx-aside">{num(campaigns.length)} in {PERIODS.find((x) => x.key === period)!.label.toLowerCase()}</span>}>
            <CampaignList campaigns={campaigns} />
          </Section>

          <div className="wx-grid">
            <Section n="02" title="Delivery" aside={<Pending p={p} />}>
              <Staircase p={p} withReplies />
            </Section>
            <Section n="03" title="What Meta bills it as">
              <Categories p={p} />
            </Section>
          </div>

          <Section n="04" title="Last 30 days" aside={<span className="wx-aside">Messages per day · cost per day below</span>}>
            <Activity daily={r.daily} />
          </Section>

          <Section n="05" title="Why messages failed">
            <Failures p={p} />
          </Section>

          <RateDrawer open={drawer} rates={r.rates} onClose={() => setDrawer(false)} onSaved={data.refresh} />
        </>
      )}
    </div>
  );
}

/* ============================================================================================ banner */

function Banner({ kicker, title, icon: Icon, report, period, setPeriod, onRefresh, onRates, figures }: {
  kicker: string; title: string; icon: typeof Receipt; report: WaReport; period: WaPeriodKey; setPeriod: (k: WaPeriodKey) => void;
  onRefresh: () => void; onRates: () => void; figures: { label: string; value: string; sub: string }[];
}) {
  const p = report.periods[period];
  const meta = PERIODS.find((x) => x.key === period)!;
  const prev = period === "all" ? null : report.previous_cost[period];
  const b = report.budget;
  const used = Math.min(100, pctOf(b.month_to_date, b.budget));
  const proj = Math.min(100, pctOf(b.projected, b.budget));
  const over = b.projected > b.budget && b.budget > 0;

  return (
    <motion.header className="wx-banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="wx-banner-top">
        <div className="wx-banner-title">
          <span className="wx-kicker"><Icon size={13} /> {kicker}</span>
          <h1>{title}</h1>
        </div>
        <div className="wx-banner-tools">
          <div className="wx-pills" role="tablist" aria-label="Period">
            {PERIODS.map((x) => (
              <button key={x.key} role="tab" aria-selected={x.key === period} className={x.key === period ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
            ))}
          </div>
          <button className="wx-ghost" onClick={onRates}><SlidersHorizontal size={14} /> Rates</button>
          <button className="wx-ghost wx-square" onClick={onRefresh} aria-label="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="wx-banner-body">
        <div className="wx-spend">
          <span className="wx-spend-label">Meta charges · {meta.label.toLowerCase()}</span>
          <div className="wx-spend-value tabular">{inr(p.cost)}</div>
          <div className="wx-spend-meta">
            {prev !== null && <Trend now={p.cost} prev={prev} label={meta.prev!} />}
            <span className="wx-tag">{p.estimated_cost > 0 || p.awaiting_report > 0 ? `${inr(p.measured_cost)} reported by Meta · ${inr(p.estimated_cost)} estimated` : "All reported by Meta"}</span>
          </div>
          <div className="wx-budget" title={`Projected ${inr(b.projected)} by month-end`}>
            <div className="wx-budget-bar"><span className="wx-budget-proj" style={{ width: `${proj}%` }} /><span className="wx-budget-used" style={{ width: `${used}%` }} /></div>
            <span className="tabular">{inr(b.month_to_date)} of {inr(b.budget)} monthly budget · {over ? <b className="wx-over">projected {inr(b.projected)}</b> : <>projected {inr(b.projected)}</>}</span>
          </div>
        </div>
        <dl className="wx-figures">
          {figures.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd className="tabular">{f.value}</dd><span>{f.sub}</span></div>
          ))}
        </dl>
      </div>
      <div className="wx-banner-foot">
        <span><i className="wx-live" /> Live · updated {new Date(report.generated_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        {p.simulated > 0 && <span>{num(p.simulated)} test-mode messages not counted</span>}
        {!report.ledger_since && <span>Counting starts with the next message sent</span>}
      </div>
    </motion.header>
  );
}

function Trend({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (!prev) return <span className="wx-tag">{now ? `nothing ${label}` : `nothing ${label} either`}</span>;
  const c = ((now - prev) / prev) * 100;
  const Icon = c >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`wx-tag ${c >= 0 ? "wx-tag-up" : "wx-tag-down"}`}><Icon size={12} /> {num(Math.abs(c))}% vs {label}</span>;
}

/* =========================================================================================== layout */

function Section({ n, title, aside, children }: { n: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <motion.section className="wx-sheet" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}>
      <header className="wx-sheet-head">
        <span className="wx-num">{n}</span>
        <h2>{title}</h2>
        {aside && <div className="wx-sheet-aside">{aside}</div>}
      </header>
      {children}
    </motion.section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="wx-empty">{text}</p>;

function Unit({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className={`wx-unit ${accent ? "wx-unit-accent" : ""}`}><span>{label}</span><b className="tabular">{value}</b></div>;
}

function Pending({ p }: { p: WaPeriod }) {
  return p.awaiting_report > 0 ? <span className="wx-aside"><Clock3 size={12} /> {num(p.awaiting_report)} awaiting Meta's report</span> : null;
}

/* ========================================================================================= insights */

function Insights({ p, report, kind, onRates }: { p: WaPeriod; report: WaReport; kind: "automation" | "bulk"; onRates: () => void }) {
  const items: { tone: "warn" | "info" | "good"; title: string; body: ReactNode; action?: ReactNode }[] = [];
  if (p.texts_outside_window > 0) {
    items.push({
      tone: "warn",
      title: `${num(p.texts_outside_window)} free-text messages went outside the 24-hour window`,
      body: <>Meta only delivers free-form text to people who wrote to you in the last 24 hours; the rest fail with error 131047. To reach everyone, send approved templates. At your {CATEGORY[p.template_category].label.toLowerCase()} rate that would cost about <b>{inr(p.template_equivalent_cost)}</b> for this period's {num(p.accepted)} messages.</>,
    });
  }
  if (p.accepted > 0 && p.delivery_rate < 80 && p.awaiting_report < p.accepted) {
    items.push({ tone: "warn", title: `Only ${p.delivery_rate}% delivered`, body: "Check the failure reasons below: invalid numbers, the 24-hour rule and spam limits are the usual causes." });
  }
  if (!report.rates_customized) {
    items.push({ tone: "info", title: "Rates are Meta's list-price estimates", body: "Enter the per-message rates from your Meta invoice so the rupee figures match your bill.", action: <button className="wx-link" onClick={onRates}>Set rates</button> });
  }
  if (kind === "bulk" && p.read > 0 && p.cost_per_read > 0) {
    items.push({ tone: "good", title: `${inr(p.cost_per_read, true)} per person who read it`, body: `${p.read_rate}% of delivered messages were read and ${p.reply_rate}% of recipients replied within 48 hours.` });
  }
  if (items.length === 0) return null;
  return (
    <div className="wx-insights">
      {items.map((i) => (
        <motion.div key={i.title} className={`wx-insight wx-insight-${i.tone}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
          {i.tone === "warn" ? <AlertTriangle size={16} /> : <Lightbulb size={16} />}
          <div><b>{i.title}</b><p>{i.body}</p></div>
          {i.action}
        </motion.div>
      ))}
    </div>
  );
}

/* ======================================================================================== staircase */

function Staircase({ p, withReplies }: { p: WaPeriod; withReplies?: boolean }) {
  const steps = [
    { key: "sent", label: "Sent", icon: Check, v: p.accepted, of: "" },
    { key: "delivered", label: "Delivered", icon: CheckCheck, v: p.delivered, of: "of sent" },
    { key: "read", label: "Read", icon: CheckCheck, v: p.read, of: "of delivered" },
    ...(withReplies ? [{ key: "replied", label: "Replied", icon: MessageCircleReply, v: p.replied, of: "of recipients" }] : []),
  ];
  const base = Math.max(p.accepted, 1);
  const rates = [100, p.delivery_rate, p.read_rate, p.reply_rate];
  return (
    <div className="wx-stairs">
      {steps.map((s, i) => (
        <div key={s.key} className={`wx-step wx-s-${s.key}`}>
          <div className="wx-step-head">
            <s.icon size={15} className="wx-step-icon" />
            <span>{s.label}</span>
          </div>
          <b className="tabular">{num(s.v)}</b>
          <div className="wx-step-col"><span style={{ height: `${Math.max(s.v ? 3 : 0, pctOf(s.v, base))}%` }} /></div>
          <em className="tabular">{i === 0 ? `${num(p.recipients)} people` : `${num(rates[i], 1)}% ${s.of}`}</em>
        </div>
      ))}
      <div className="wx-step wx-s-failed">
        <div className="wx-step-head"><XCircle size={15} className="wx-step-icon" /><span>Failed</span></div>
        <b className="tabular">{num(p.failed)}</b>
        <div className="wx-step-col"><span style={{ height: `${Math.max(p.failed ? 3 : 0, pctOf(p.failed, Math.max(p.attempted, 1)))}%` }} /></div>
        <em className="tabular">{num(pctOf(p.failed, p.attempted), 1)}% of attempts</em>
      </div>
    </div>
  );
}

/* ======================================================================================= categories */

function Categories({ p }: { p: WaPeriod }) {
  const total = p.categories.reduce((a, c) => a + c.messages, 0);
  const r = 46, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="wx-cats">
      <div className="wx-donut">
        <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label="Messages by Meta billing category">
          <circle cx="60" cy="60" r={r} className="wx-donut-track" />
          {total > 0 && p.categories.map((cat) => {
            const len = (cat.messages / total) * c;
            const gap = p.categories.length > 1 ? 2 : 0;
            const el = <circle key={cat.category} cx="60" cy="60" r={r} className={`wx-donut-seg wx-k-${cat.category}`}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
            offset += len;
            return el;
          })}
        </svg>
        <div className="wx-donut-center"><b className="tabular">{num(p.billable)}</b><span>billable</span></div>
      </div>
      <ul className="wx-cat-list">
        {(["marketing", "utility", "authentication", "service"] as WaCategory[]).map((k) => {
          const cat = p.categories.find((x) => x.category === k);
          return (
            <li key={k} className={cat ? "" : "wx-dim"}>
              <i className={`wx-swatch wx-k-${k}`} />
              <div><b>{CATEGORY[k].label}</b><span>{CATEGORY[k].note}</span></div>
              <span className="tabular">{num(cat?.messages ?? 0)}</span>
              <b className="tabular">{inr(cat?.cost ?? 0)}</b>
            </li>
          );
        })}
      </ul>
      <p className="wx-foot"><FileText size={12} /> {num(p.texts)} free-form texts · {num(p.templates)} templates · {num(p.free)} free</p>
    </div>
  );
}

/* ========================================================================================= activity */

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const LINES = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
] as const;

function Activity({ daily }: { daily: WaReport["daily"] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180, padL = 36, padR = 8, padT = 10, padB = 4;
  const max = Math.max(4, ...daily.map((d) => d.sent));
  const step = (w - padL - padR) / Math.max(1, daily.length - 1);
  const x = (i: number) => padL + i * step;
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const path = (k: "sent" | "delivered" | "read") => daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const costMax = Math.max(...daily.map((d) => d.cost), 0);
  const empty = daily.every((d) => d.sent === 0);
  const h = hover !== null ? daily[hover] : null;
  const label = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const onMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - padL) / step);
    setHover(Math.max(0, Math.min(daily.length - 1, i)));
  };

  return (
    <div className="wx-activity" ref={ref}>
      <div className="wx-legend">
        {LINES.map((l) => <span key={l.key}><i className={`wx-line-key wx-l-${l.key}`} />{l.label}</span>)}
      </div>
      <div className="wx-chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} role="img" aria-label="Messages per day, last 30 days">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={w - padR} y1={y(max * f)} y2={y(max * f)} className="wx-grid-line" />
              <text x={0} y={y(max * f) + 4} className="wx-axis">{num(max * f)}</text>
            </g>
          ))}
          {!empty && LINES.map((l) => <path key={l.key} d={path(l.key)} className={`wx-path wx-l-${l.key}`} />)}
          {!empty && <path d={`${path("read")} L${x(daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="wx-area" />}
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="wx-cross" />
              {LINES.map((l) => <circle key={l.key} cx={x(hover)} cy={y(h[l.key])} r={4} className={`wx-dot wx-l-${l.key}`} />)}
            </g>
          )}
        </svg>
        {empty && <div className="wx-chart-empty">No messages in the last 30 days</div>}
        {h && hover !== null && (
          <div className="wx-tip" style={{ left: Math.min(Math.max(x(hover), 90), w - 90) }}>
            <b>{label(h.date)}</b>
            {LINES.map((l) => <div key={l.key}><i className={`wx-line-key wx-l-${l.key}`} />{l.label}<span className="tabular">{num(h[l.key])}</span></div>)}
            <div>Failed<span className="tabular">{num(h.failed)}</span></div>
            <div className="wx-tip-cost">Cost<span className="tabular">{inr(h.cost)}</span></div>
          </div>
        )}
      </div>
      <div className="wx-coststrip" style={{ paddingLeft: padL, paddingRight: padR }} aria-label="Cost per day">
        {daily.map((d, i) => (
          <span key={d.date} className={hover === i ? "on" : ""} title={`${label(d.date)}: ${inr(d.cost)}`}>
            <i style={{ height: `${costMax ? Math.max(d.cost ? 8 : 0, (d.cost / costMax) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="wx-xaxis" style={{ paddingLeft: padL, paddingRight: padR }}>
        {[0, 7, 14, 21, 29].map((i) => <span key={i}>{label(daily[i].date)}</span>)}
      </div>
    </div>
  );
}

/* ========================================================================================= failures */

function Failures({ p }: { p: WaPeriod }) {
  if (!p.failure_reasons.length) return <Empty text={p.attempted ? "No failures in this period." : "Nothing sent in this period."} />;
  const max = p.failure_reasons[0].count;
  return (
    <ul className="wx-fails">
      {p.failure_reasons.map((f) => {
        const [code, ...rest] = f.reason.split(" · ");
        return (
          <li key={f.reason}>
            <code>{code}</code>
            <span className="wx-fail-text">{rest.join(" · ") || "Failed"}{code === "131047" && <em> · outside the 24-hour window: use a template</em>}</span>
            <span className="wx-fail-bar"><i style={{ width: `${pctOf(f.count, max)}%` }} /></span>
            <b className="tabular">{num(f.count)}</b>
          </li>
        );
      })}
    </ul>
  );
}

/* ======================================================================================== campaigns */

type Sort = "recent" | "cost" | "read";

function CampaignList({ campaigns }: { campaigns: WaCampaign[] }) {
  const [sort, setSort] = useState<Sort>("recent");
  const list = useMemo(() => {
    const l = [...campaigns];
    if (sort === "cost") l.sort((a, b) => b.cost - a.cost);
    if (sort === "read") l.sort((a, b) => b.read_rate - a.read_rate);
    return l;
  }, [campaigns, sort]);
  const best = campaigns.filter((c) => c.delivered >= 5).sort((a, b) => b.read_rate - a.read_rate)[0];

  if (!campaigns.length) return <Empty text="No bulk campaigns in this period. Campaigns appear here as soon as you send from Bulk Msgs." />;
  return (
    <div className="wx-camps">
      <div className="wx-sortbar">
        {(["recent", "cost", "read"] as Sort[]).map((s) => (
          <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>
            {s === "recent" ? "Most recent" : s === "cost" ? "Highest cost" : "Best read rate"}
          </button>
        ))}
      </div>
      {list.map((c) => {
        const base = Math.max(c.total, 1);
        const undelivered = Math.max(0, c.sent - c.delivered - 0);
        return (
          <article key={c.id} className="wx-camp">
            <div className="wx-camp-main">
              <div className="wx-camp-title">
                <b>Campaign #{c.id}</b>
                <span>{new Date(c.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                {best?.id === c.id && <span className="wx-badge">Best read rate</span>}
                {c.simulated > 0 && <span className="wx-badge wx-badge-muted">{num(c.simulated)} test</span>}
              </div>
              <p className="wx-camp-msg">“{c.message_preview || "—"}”</p>
              <div className="wx-camp-bar" aria-label={`${c.read} read, ${c.delivered - c.read} delivered unread, ${undelivered} not yet delivered, ${c.failed} failed`}>
                <span className="wx-seg-read" style={{ flexGrow: c.read }} />
                <span className="wx-seg-delivered" style={{ flexGrow: c.delivered - c.read }} />
                <span className="wx-seg-sent" style={{ flexGrow: undelivered }} />
                <span className="wx-seg-failed" style={{ flexGrow: c.failed }} />
                <span className="wx-seg-rest" style={{ flexGrow: Math.max(0, base - c.sent - c.failed - c.simulated) }} />
              </div>
              <div className="wx-camp-keys tabular">
                <span><i className="wx-seg-read" />{num(c.read)} read</span>
                <span><i className="wx-seg-delivered" />{num(c.delivered)} delivered</span>
                <span><i className="wx-seg-sent" />{num(c.sent)} sent</span>
                <span><i className="wx-seg-failed" />{num(c.failed)} failed</span>
                <span><MessageCircleReply size={12} />{num(c.replied)} replied</span>
              </div>
            </div>
            <div className="wx-camp-money">
              <b className="tabular">{inr(c.cost)}</b>
              <span>{c.estimated ? "estimated" : "reported by Meta"}</span>
              <dl>
                <div><dt>Contacts</dt><dd className="tabular">{num(c.total)}</dd></div>
                <div><dt>Read rate</dt><dd className="tabular">{c.read_rate}%</dd></div>
                <div><dt>Per read</dt><dd className="tabular">{c.read ? inr(c.cost_per_read, true) : "—"}</dd></div>
              </dl>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* =========================================================================================== rates */

const RATE_FIELDS: { key: "marketing" | "utility" | "authentication" | "service"; label: string; note: string }[] = [
  { key: "marketing", label: "Marketing", note: "offers, promotions" },
  { key: "utility", label: "Utility", note: "work orders, updates" },
  { key: "authentication", label: "Authentication", note: "one-time codes" },
  { key: "service", label: "Service", note: "free inside 24 h window" },
];

function RateDrawer({ open, rates, onClose, onSaved }: { open: boolean; rates: WaRates; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<WaRates>(rates);
  const action = useToastAction();
  useEffect(() => { if (open) setForm(rates); }, [open, rates]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  const set = (k: keyof WaRates, v: string | number) => setForm({ ...form, [k]: v });
  const save = async () => {
    const ok = await action.run(() => api.whatsapp.saveCommercialRates(form), "WhatsApp rates saved");
    if (ok) { onSaved(); onClose(); }
  };
  const cats = ["marketing", "utility", "authentication", "service"] as WaCategory[];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="wx-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside className="wx-drawer" role="dialog" aria-label="WhatsApp rates"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 38 }}>
            <header>
              <div><b>Meta rate card</b><span>Per delivered message, in ₹. Shared by both WhatsApp spend pages.</span></div>
              <button className="wx-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="wx-drawer-body">
              <h3>Per-message rates</h3>
              {RATE_FIELDS.map((f) => (
                <label key={f.key} className="wx-field">
                  <span><i className={`wx-swatch wx-k-${f.key}`} />{f.label}<small>{f.note}</small></span>
                  <div><em>₹</em><input type="number" min={0} step={0.001} value={form[f.key]} onChange={(e) => set(f.key, e.target.value === "" ? 0 : Number(e.target.value))} /></div>
                </label>
              ))}
              <h3>How templates are billed</h3>
              <label className="wx-field">
                <span>Automation templates</span>
                <select value={form.automation_category} onChange={(e) => set("automation_category", e.target.value)}>
                  {cats.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
                </select>
              </label>
              <label className="wx-field">
                <span>Bulk templates</span>
                <select value={form.bulk_category} onChange={(e) => set("bulk_category", e.target.value)}>
                  {cats.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
                </select>
              </label>
              <h3>Monthly budgets</h3>
              <label className="wx-field"><span>Automation</span><div><em>₹</em><input type="number" min={0} step={100} value={form.automation_budget} onChange={(e) => set("automation_budget", Number(e.target.value) || 0)} /></div></label>
              <label className="wx-field"><span>Bulk</span><div><em>₹</em><input type="number" min={0} step={100} value={form.bulk_budget} onChange={(e) => set("bulk_budget", Number(e.target.value) || 0)} /></div></label>
              <p className="wx-note">Once Meta reports a message's pricing, its real category and billable flag are used instead of these settings.</p>
            </div>
            <footer>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" loading={action.busy} onClick={save}>Save rates</Button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
