import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  BookOpenText,
  CalendarSearch,
  CircleCheck,
  CircleX,
  Clock3,
  Image as ImageIcon,
  PenLine,
  RefreshCw,
  ScanEye,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { Button, ErrorNote, SkeletonRows, useToastAction } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { AdCommercialReport, AdFestival, AdOperation, AdPeriodKey, AdRates } from "../types";
import "./ad-commercials.css";

/* ------------------------------------------------------------------------------------------------ helpers */

const inr = (x: number) => {
  if (x > 0 && x < 0.01) return "<₹0.01";
  const d = Math.abs(x) < 100 ? 2 : 0;
  return "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const num = (x: number) => x.toLocaleString("en-IN");
const compact = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(x);

const STEPS: Record<AdOperation, { label: string; what: string; model: string; icon: typeof Sparkles }> = {
  scan: { label: "Festival scan", what: "Reads the festival calendar websites and picks the month's big festivals", model: "GPT-OSS-20B", icon: CalendarSearch },
  research: { label: "Research", what: "Studies the festival: religion, symbols, colours, what to avoid", model: "GPT-OSS-20B", icon: BookOpenText },
  brief: { label: "Poster brief", what: "Writes a fresh concept, headline and drawing prompt", model: "GPT-OSS-20B", icon: PenLine },
  draw: { label: "Drawing", what: "Draws the poster picture with the offer text", model: "Seedream 5.0 Flash", icon: ImageIcon },
  check: { label: "Quality check", what: "Reads the poster: coupon, discount, date, spelling, imagery", model: "Gemini 2.5 Flash", icon: ScanEye },
};
const POSTER_ORDER = ["research", "brief", "draw", "check"] as const;
const PERIODS: { key: AdPeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];
const PREV_LABEL: Record<AdPeriodKey, string> = { today: "yesterday", week: "last week", month: "last month", all: "" };

/* ============================================================================================== page */

export function AdCommercials() {
  const [period, setPeriod] = useUrlState<AdPeriodKey>("period", "month");
  const data = usePoll<AdCommercialReport>(api.marketing.commercials, 60000);
  const [rates, setRates] = useState(false);
  const r = data.data;

  return (
    <div className="ad-page">
      <ErrorNote error={data.error} />
      {!r && !data.error && <div className="ad-panel"><SkeletonRows rows={10} /></div>}
      {r && (
        <>
          <Masthead r={r} period={period} setPeriod={setPeriod} onRefresh={data.refresh} onRates={() => setRates(true)} />
          <FestivalLedger r={r} />
          <div className="ad-grid-2">
            <Anatomy r={r} />
            <Scaler r={r} />
          </div>
          <p className="ad-foot">
            Every AI request of the Advertisement Agent goes through OpenRouter and is recorded with its tokens, images and
            cost. <b>Reported</b> costs come from OpenRouter itself; <b>estimated</b> ones use the rate card
            {r.rates_customized ? "" : " (still the default list prices: set your own)"}. USD is converted at ₹{r.rates.usd_to_inr}.
          </p>
        </>
      )}
      <AnimatePresence>
        {rates && r && <RateCard rates={r.rates} onClose={() => setRates(false)} onSaved={data.refresh} />}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ masthead */

function Masthead({ r, period, setPeriod, onRefresh, onRates }: {
  r: AdCommercialReport; period: AdPeriodKey; setPeriod: (p: AdPeriodKey) => void; onRefresh: () => void; onRates: () => void;
}) {
  const p = r.periods[period];
  const prev = r.previous[period];
  const delta = prev != null && prev > 0 ? ((p.cost - prev) / prev) * 100 : null;
  const measured = r.unit.recipe_source === "measured";
  return (
    <header className="ad-mast">
      <div className="ad-mast-top">
        <div className="ad-mast-title">
          <span className="ad-kicker"><Sparkles size={13} /> Advertisement Agent · AI spend</span>
          <h1>Advertisement Commercials</h1>
          <p>What it costs to find festivals and make each festival poster.</p>
        </div>
        <div className="ad-tag" title={measured ? `Average of ${r.unit.posters_measured} posters made` : "Estimate from the rate card: no poster made yet"}>
          <span className="ad-tag-hole" />
          <span className="ad-tag-label">One poster</span>
          <b className="ad-tag-price">{inr(r.unit.per_poster)}</b>
          <span className="ad-tag-sub">{measured ? `avg of ${r.unit.posters_measured} made` : "estimate"}</span>
        </div>
      </div>

      <div className="ad-mast-bar">
        <div className="ad-tickets" role="tablist">
          {PERIODS.map((x) => (
            <button key={x.key} role="tab" aria-selected={period === x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>
              {period === x.key && <motion.span layoutId="ad-ticket" className="ad-ticket-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span>{x.label}</span>
            </button>
          ))}
        </div>
        <div className="ad-mast-tools">
          <button className="ad-ghost" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
          <button className="ad-ghost" onClick={onRates}><SlidersHorizontal size={14} /> Rate card</button>
        </div>
      </div>

      <div className="ad-figs">
        <Fig label="AI spend" value={inr(p.cost)}>
          {delta != null ? (
            <span className={`ad-delta ${delta > 0 ? "up" : "down"}`}>
              {delta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(delta).toFixed(0)}% vs {PREV_LABEL[period]}
            </span>
          ) : <span>{period === "all"
            ? (r.festivals.before_metering.cost > 0 ? `+ ≈${inr(r.festivals.before_metering.cost)} before metering (est.)` : "since metering started")
            : `nothing ${PREV_LABEL[period]}`}</span>}
        </Fig>
        <Fig label="Posters made" value={num(p.posters)}>
          <span>{p.cost_per_poster != null ? `${inr(p.cost_per_poster)} each, incl. redraws` : "none in this period"}</span>
        </Fig>
        <Fig label="Festival scans" value={num(p.scans)}>
          <span>{inr(r.unit.per_scan)} per scan{r.unit.scans_measured ? "" : " (est.)"}</span>
        </Fig>
        <Fig label="AI requests" value={num(p.requests)}>
          <span>{p.failed ? `${num(p.failed)} failed (not billed)` : "none failed"} · {compact(p.tokens_in + p.tokens_out)} tokens</span>
        </Fig>
      </div>
    </header>
  );
}

function Fig({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="ad-fig">
      <span className="ad-fig-label">{label}</span>
      <b className="tabular">{value}</b>
      <small>{children}</small>
    </div>
  );
}

function Panel({ title, kicker, aside, children, className = "" }: { title: string; kicker?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ad-panel ${className}`}>
      <div className="ad-panel-head">
        <div>
          {kicker && <span className="ad-panel-kicker">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ festival ledger */

type StatusKind = "good" | "wait" | "bad";
const statusKind = (s: string): StatusKind => {
  const x = s.toLowerCase();
  return x === "approved" ? "good" : x === "rejected" ? "bad" : "wait";
};
const STATUS_ICON = { good: CircleCheck, wait: Clock3, bad: CircleX };
const fromNow = (d: number | null) =>
  d == null ? "" : d < 0 ? `${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;

function FestivalLedger({ r }: { r: AdCommercialReport }) {
  const f = r.festivals;
  const items = f.items.filter((x) => x.status.toLowerCase() === "approved"); // only approved festivals are listed
  const total = f.items.reduce((s, x) => s + x.cost, 0) + f.before_metering.scans * r.unit.per_scan;
  const steps = [
    { n: f.scans_run, label: "Festival scans run", sub: "festival finder" },
    { n: f.found, label: "Festivals noticed", sub: "from Drik Panchang" },
    { n: f.approved, label: "Approved", sub: `${f.pending} waiting${f.rejected ? ` · ${f.rejected} rejected` : ""}` },
    { n: f.with_poster, label: "With a poster", sub: `of ${f.approved} approved` },
    { n: f.versions, label: "Posters drawn", sub: "every regenerate is paid" },
  ];
  const bar: { k: StatusKind; n: number; label: string }[] = [
    { k: "good", n: f.approved, label: "Approved" },
    { k: "wait", n: f.pending, label: "Waiting for review" },
    { k: "bad", n: f.rejected, label: "Rejected" },
  ];
  return (
    <Panel
      kicker="Festivals"
      title="Noticed, approved and what they cost"
      aside={<span className="ad-chip">Total so far ≈ <b className="tabular">{inr(total)}</b></span>}
    >
      <div className="ad-funnel">
        {steps.map((x, i) => (
          <div key={x.label} className="ad-funnel-step">
            <b className="tabular">{num(x.n)}</b>
            <span>{x.label}</span>
            <small>{x.sub}</small>
            {i < steps.length - 1 && <i className="ad-funnel-arrow" aria-hidden />}
          </div>
        ))}
      </div>

      {f.found > 0 && (
        <div className="ad-status-bar" aria-label="Festivals by status">
          {bar.filter((x) => x.n > 0).map((x) => (
            <span key={x.k} className={`ad-st-${x.k}`} style={{ flexGrow: x.n }} title={`${x.label}: ${x.n}`}>
              {x.n / f.found > 0.12 && `${x.label} · ${x.n}`}
            </span>
          ))}
        </div>
      )}

      {(f.soon_pending.length > 0 || f.past_pending.length > 0 || f.before_metering.cost > 0) && (
        <div className="ad-alerts">
          {f.soon_pending.length > 0 && (
            <div className="ad-alert hot">
              <AlertTriangle size={16} />
              <span>
                <b>Coming up, still waiting for review, no poster:</b>{" "}
                {f.soon_pending.map((x) => `${x.title} (${fromNow(x.days)})`).join(", ")}
              </span>
            </div>
          )}
          {f.past_pending.length > 0 && (
            <div className="ad-alert">
              <Clock3 size={16} />
              <span><b>Date passed while waiting:</b> {f.past_pending.map((x) => x.title).join(", ")}. These can be rejected.</span>
            </div>
          )}
          {f.before_metering.cost > 0 && (
            <div className="ad-alert info">
              <Sparkles size={16} />
              <span>
                <b>
                  {num(f.before_metering.posters)} posters
                  {f.before_metering.scans ? ` and ${f.before_metering.scans} scan${f.before_metering.scans > 1 ? "s" : ""}` : ""}
                </b>{" "}
                were made before cost metering started: ≈ <b>{inr(f.before_metering.cost)}</b>, estimated at {inr(r.unit.per_poster)} per
                poster. Everything made from now on is measured.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="ad-ledger-head">
        <h3>Approved festivals <span className="ad-muted">· {items.length}</span></h3>
      </div>
      {items.length === 0 ? (
        <p className="ad-muted">No festival is approved yet. Approve one on the Dashboard and it appears here with its poster cost.</p>
      ) : (
        <div className="ad-ledger" role="table">
          <div className="ad-ledger-row ad-ledger-th" role="row">
            <span>Date</span><span>Festival</span><span>Status</span><span>Poster</span><span>Posters drawn</span><span className="r">Cost</span>
          </div>
          {items.map((x) => <LedgerRow key={x.id} x={x} />)}
        </div>
      )}
    </Panel>
  );
}

function LedgerRow({ x }: { x: AdFestival }) {
  const [broken, setBroken] = useState(false);
  const d = new Date(x.date);
  const kind = statusKind(x.status);
  const Icon = STATUS_ICON[kind];
  return (
    <div className={`ad-ledger-row ${x.days != null && x.days < 0 ? "past" : ""}`} role="row">
      <span className="ad-cal" aria-label={x.date}>
        <small>{d.toLocaleDateString("en-IN", { month: "short" })}</small>
        <b>{d.getDate()}</b>
      </span>
      <span className="ad-ledger-title">
        <b>{x.title}</b>
        <small>{[x.city, fromNow(x.days)].filter(Boolean).join(" · ")}</small>
      </span>
      <span><span className={`ad-pill ad-st-${kind}`}><Icon size={12} />{kind === "wait" ? "Waiting" : x.status}</span></span>
      <span>
        {x.poster_url && !broken
          ? <img className="ad-ledger-thumb" src={x.poster_url} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span className="ad-muted">—</span>}
      </span>
      <span className="ad-ticks" title={`${x.versions} poster${x.versions === 1 ? "" : "s"} drawn`}>
        {x.versions > 0 ? (
          <>
            <span className="ad-tick-row">
              {Array.from({ length: Math.min(x.versions, 20) }, (_, i) => <i key={i} className={i === x.versions - 1 ? "last" : ""} />)}
            </span>
            <b className="tabular">{x.versions}</b>
          </>
        ) : <span className="ad-muted">none</span>}
      </span>
      <span className="r">
        {x.cost > 0 ? (
          <>
            <b className="tabular">{inr(x.cost)}</b>
            <small>{x.unmetered ? (x.measured_cost ? `${inr(x.measured_cost)} measured + est.` : "estimate") : "measured"}</small>
          </>
        ) : <span className="ad-muted">₹0</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ anatomy of a poster */

function Anatomy({ r }: { r: AdCommercialReport }) {
  const recipe = r.unit.recipe;
  const total = POSTER_ORDER.reduce((s, k) => s + recipe[k], 0) || 1;
  const [hover, setHover] = useState<string | null>(null);
  return (
    <Panel
      kicker="Anatomy"
      title="What one poster is made of"
      aside={<span className={`ad-chip ${r.unit.recipe_source}`}>{r.unit.recipe_source === "measured" ? `Measured · ${r.unit.posters_measured} posters` : "Estimate"}</span>}
    >
      <div className="ad-anatomy">
        <div className="ad-frame" aria-label="Cost of one poster by step">
          {POSTER_ORDER.map((k, i) => {
            const share = recipe[k] / total;
            return (
              <motion.div
                key={k}
                className={`ad-band ad-c-${k} ${hover && hover !== k ? "dim" : ""}`}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: Math.max(share, 0.035) }}
                transition={{ duration: 0.7, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] }}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(null)}
                title={`${STEPS[k].label}: ${inr(recipe[k])} (${(share * 100).toFixed(1)}%)`}
              >
                {share > 0.12 && <span>{STEPS[k].label} · {(share * 100).toFixed(0)}%</span>}
              </motion.div>
            );
          })}
          <div className="ad-frame-total"><small>Total</small><b>{inr(r.unit.per_poster)}</b></div>
        </div>
        <ol className="ad-legend">
          {POSTER_ORDER.map((k) => {
            const S = STEPS[k];
            const share = recipe[k] / total;
            const times = k === "draw" || k === "check" ? r.unit.draws_per_poster : 1;
            return (
              <li key={k} className={hover && hover !== k ? "dim" : ""} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                <span className={`ad-sw ad-c-${k}`}><S.icon size={14} /></span>
                <div>
                  <b>{S.label}</b>
                  <small>{S.what}</small>
                  <small className="ad-model">{S.model}{times !== 1 ? ` · ×${times.toFixed(1)} per poster` : ""}{k === "research" ? " · reused for later posters" : ""}</small>
                </div>
                <span className="ad-legend-val tabular"><b>{inr(recipe[k])}</b><small>{(share * 100).toFixed(1)}%</small></span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="ad-note">
        {r.unit.recipe_source === "estimate" ? "Assumed until posters are made: " : ""}
        {(r.unit.first_try_rate * 100).toFixed(0)}% of posters pass the check on the first drawing; the rest are drawn again,
        so a poster averages {r.unit.draws_per_poster.toFixed(1)} drawings. The drawing is almost the whole price; the text models cost paise.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------------ 1 → 1,000 */

const MARKS = [1, 10, 50, 100, 500, 1000];

function Scaler({ r }: { r: AdCommercialReport }) {
  const [pos, setPos] = useState(100); // slider 0..100, log scale 1..1000
  const [scans, setScans] = useState(1);
  const posters = Math.max(1, Math.round(10 ** ((pos / 100) * 3)));
  const per = r.unit.per_poster;
  const total = posters * per + scans * r.unit.per_scan;
  const parts = POSTER_ORDER.map((k) => ({ k, v: posters * r.unit.recipe[k] }));
  const max = Math.max(...parts.map((x) => x.v), 1e-9);
  const upcoming = r.pipeline.upcoming_without_poster;
  return (
    <Panel kicker="Plan" title="From 1 poster to 1,000">
      <div className="ad-scale-out">
        <div>
          <span className="ad-scale-n tabular">{num(posters)}</span>
          <span className="ad-scale-u">poster{posters === 1 ? "" : "s"}</span>
        </div>
        <div className="ad-scale-eq">=</div>
        <div className="ad-scale-total">
          <motion.b key={Math.round(total * 100)} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="tabular">{inr(total)}</motion.b>
          <small>{scans ? `incl. ${scans} festival scan${scans > 1 ? "s" : ""}` : "posters only"}</small>
        </div>
      </div>
      <input className="ad-range" type="range" min={0} max={100} step={0.5} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Number of posters" />
      <div className="ad-marks">
        {MARKS.map((m) => (
          <button key={m} className={posters === m ? "on" : ""} onClick={() => setPos((Math.log10(m) / 3) * 100)}>{num(m)}</button>
        ))}
      </div>
      <div className="ad-scale-bars">
        {parts.map(({ k, v }) => (
          <div key={k} className="ad-scale-row">
            <span>{STEPS[k].label}</span>
            <div className="ad-scale-track"><motion.i className={`ad-c-${k}`} animate={{ width: `${(v / max) * 100}%` }} transition={{ duration: 0.35 }} /></div>
            <b className="tabular">{inr(v)}</b>
          </div>
        ))}
      </div>
      <div className="ad-scale-foot">
        <label>
          Festival scans
          <span className="ad-stepper">
            <button onClick={() => setScans(Math.max(0, scans - 1))} aria-label="Fewer scans">−</button>
            <b className="tabular">{scans}</b>
            <button onClick={() => setScans(Math.min(24, scans + 1))} aria-label="More scans">+</button>
          </span>
        </label>
        {upcoming > 0 ? (
          <button className="ad-upcoming" onClick={() => setPos((Math.log10(Math.max(1, upcoming)) / 3) * 100)}>
            <CalendarSearch size={14} />
            <span><b>{upcoming}</b> festivals in the next 60 days have no poster yet · {inr(r.pipeline.projected_cost)}</span>
          </button>
        ) : (
          <span className="ad-muted">Every festival in the next 60 days already has a poster.</span>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------------ rate card */

const FIELDS: { k: keyof AdRates; label: string; unit: string; step: number }[] = [
  { k: "image_usd", label: "Seedream 5.0 Flash: one poster image", unit: "USD", step: 0.001 },
  { k: "text_in_per_m", label: "GPT-OSS-20B input", unit: "USD / 1M tokens", step: 0.01 },
  { k: "text_out_per_m", label: "GPT-OSS-20B output", unit: "USD / 1M tokens", step: 0.01 },
  { k: "vision_in_per_m", label: "Gemini 2.5 Flash input", unit: "USD / 1M tokens", step: 0.01 },
  { k: "vision_out_per_m", label: "Gemini 2.5 Flash output", unit: "USD / 1M tokens", step: 0.01 },
  { k: "usd_to_inr", label: "Exchange rate", unit: "₹ per USD", step: 0.5 },
  { k: "monthly_budget", label: "Monthly budget", unit: "₹", step: 100 },
];

function RateCard({ rates, onClose, onSaved }: { rates: AdRates; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AdRates>(rates);
  const action = useToastAction();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const valid = useMemo(() => FIELDS.every((f) => Number.isFinite(form[f.k]) && form[f.k] >= 0) && form.usd_to_inr > 0, [form]);
  const save = async () => {
    const ok = await action.run(() => api.marketing.saveCommercialRates(form), "Advertisement rates saved");
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <motion.div className="ad-modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="ad-modal" role="dialog" aria-label="Rate card" initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal-head">
          <div>
            <span className="ad-panel-kicker">Rate card</span>
            <h2>OpenRouter prices</h2>
          </div>
          <button className="ad-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="ad-note">Used only when OpenRouter doesn't report a request's cost, and for estimates. Copy the prices from your OpenRouter activity page.</p>
        <div className="ad-form">
          {FIELDS.map((f) => (
            <label key={f.k}>
              <span>{f.label}</span>
              <span className="ad-input">
                <input type="number" min={0} step={f.step} value={form[f.k]} onChange={(e) => setForm({ ...form, [f.k]: Number(e.target.value) })} />
                <em>{f.unit}</em>
              </span>
            </label>
          ))}
        </div>
        <div className="ad-modal-foot">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={action.busy} disabled={!valid}>Save rates</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
