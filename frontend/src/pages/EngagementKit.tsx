/**
 * Shared pieces of the Customer Engagement dashboards (Cancelled Works, Refunded Works): India-time date helpers,
 * period presets (week / month / earlier), and the building blocks — KPI tiles with a sparkline, month columns,
 * ranked bars, weekday columns, a highlights panel, the Day / Week / Month table and a loading skeleton.
 * Styles: engagement-dash.css (prefix cw-). Each chart draws one series in --cw-series.
 */
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, CalendarRange } from "lucide-react";
import { useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import "./engagement-dash.css";

export type Group = "day" | "week" | "month";
export interface Range { key: string; label: string; from: string | null; to: string | null; prev?: [string, string]; prevLabel?: string }
/** Anything placed on a day (YYYY-MM-DD, India time). */
export interface Dated { day: string | null }

/* ------------------------------------------------------------------ formatting */
export const n = (v: number) => v.toLocaleString("en-IN");
export const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
/** short money for axes and bar labels: ₹950, ₹9.5k, ₹36k, ₹1.2L */
export const rupeesShort = (v: number) =>
  v >= 100000 ? `₹${(v / 100000).toFixed(v >= 1000000 ? 0 : 1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${Math.round(v)}`;
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
export const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
/** "plumbing-tap-mixer" → "Plumbing tap mixer"; proper labels stay as they are */
export const pretty = (s: string) => (/[A-Z ]/.test(s) ? s : (s.charAt(0).toUpperCase() + s.slice(1)).replace(/[-_]+/g, " "));
/** Most frequent key and its count (null when the list is empty). */
export function topOf<T>(rows: T[], keyOf: (r: T) => string | null, measure: (r: T) => number = () => 1): [string, number] | null {
  const m = new Map<string, number>();
  for (const r of rows) { const k = keyOf(r); if (k) m.set(k, (m.get(k) ?? 0) + measure(r)); }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

/* ------------------------------------------------------------------ dates */
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const S = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, k: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + k); return S(d); };
export const addMonths = (s: string, k: number) => { const d = D(`${s.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + k); return S(d); };
export const weekOf = (s: string) => addDays(s, -((D(s).getUTCDay() + 6) % 7)); // weeks start on Monday
export const monthOf = (s: string) => `${s.slice(0, 7)}-01`;
const startOf = (s: string, g: Group) => (g === "day" ? s : g === "week" ? weekOf(s) : monthOf(s));
const endOf = (s: string, g: Group) => (g === "day" ? addDays(s, 1) : g === "week" ? addDays(s, 7) : addMonths(s, 1));
const lbl = (s: string, o: Intl.DateTimeFormatOptions) => D(s).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
export function bucketLabel(s: string, g: Group): string {
  if (g === "day") return lbl(s, { weekday: "short", day: "numeric", month: "short" });
  if (g === "month") return lbl(s, { month: "long", year: "numeric" });
  const end = addDays(s, 6);
  return `${lbl(s, { day: "numeric", month: s.slice(5, 7) === end.slice(5, 7) ? undefined : "short" })} – ${lbl(end, { day: "numeric", month: "short" })}`;
}
export const rangeFor = (s: string, g: Group): Range => ({
  key: `${g}:${s}`, label: g === "week" ? `Week ${bucketLabel(s, g)}` : bucketLabel(s, g), from: s, to: endOf(s, g),
  prev: [startOf(addDays(s, -1), g), s], prevLabel: `the previous ${g}`,
});
export function presets(today: string): Range[] {
  const ws = weekOf(today), ms = monthOf(today);
  return [
    { key: "week", label: "This week", from: ws, to: addDays(ws, 7), prev: [addDays(ws, -7), ws], prevLabel: "last week" },
    { key: "lastweek", label: "Last week", from: addDays(ws, -7), to: ws, prev: [addDays(ws, -14), addDays(ws, -7)], prevLabel: "the week before" },
    { key: "month", label: "This month", from: ms, to: addMonths(ms, 1), prev: [addMonths(ms, -1), ms], prevLabel: "last month" },
    { key: "lastmonth", label: "Last month", from: addMonths(ms, -1), to: ms, prev: [addMonths(ms, -2), addMonths(ms, -1)], prevLabel: "the month before" },
    { key: "3m", label: "Last 3 months", from: addMonths(ms, -2), to: addMonths(ms, 1), prev: [addMonths(ms, -5), addMonths(ms, -2)], prevLabel: "the 3 months before" },
    { key: "all", label: "All time", from: null, to: null },
  ];
}
export const within = (day: string | null, from: string | null, to: string | null) =>
  from === null || (!!day && day >= from && (to === null || day < to));
/** A round axis top a little above the peak (1, 2, 2.5, 5 × 10^k), so the peak's label stays inside the plot. */
export function niceMax(peak: number): number {
  const v = Math.max(4, peak * 1.12);
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)) ?? 10 * p;
}
/** Values of the last `count` months (oldest first), for sparklines. */
export function lastMonths<T extends Dated>(rows: T[], today: string, count: number, measure: (rs: T[]) => number = (rs) => rs.length): number[] {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = addMonths(monthOf(today), -i);
    out.push(measure(rows.filter((r) => r.day && monthOf(r.day) === m)));
  }
  return out;
}

/* ------------------------------------------------------------------ page frame */
export function PeriodPills({ presets: list, range, setRange }: { presets: Range[]; range: Range; setRange: (r: Range) => void }) {
  const isPreset = list.some((p) => p.key === range.key);
  return (
    <div className="cw-pills" role="tablist" aria-label="Period">
      <CalendarRange size={14} />
      {list.map((p) => (
        <button key={p.key} role="tab" aria-selected={range.key === p.key} className={range.key === p.key ? "on" : ""} onClick={() => setRange(p)}>{p.label}</button>
      ))}
      {!isPreset && (
        <button className="on custom" onClick={() => setRange(list[list.length - 1])} title="Back to all time">{range.label} ✕</button>
      )}
    </div>
  );
}

/** Grey placeholder blocks in the dashboard's shape while the first read runs. */
export function Skeleton({ note }: { note: ReactNode }) {
  return (
    <div className="cw-skel" aria-busy="true">
      <p className="cw-skel-note">{note}</p>
      <div className="cw-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="cw-skel-block" style={{ height: 112 }} />)}</div>
      <div className="cw-row"><div className="cw-skel-block" style={{ height: 300 }} /><div className="cw-skel-block" style={{ height: 300 }} /></div>
      <div className="cw-grid three">{[0, 1, 2].map((i) => <div key={i} className="cw-skel-block" style={{ height: 260 }} />)}</div>
    </div>
  );
}

export function CardHead({ icon: I, title, note, children }: { icon: ElementType; title: string; note?: string; children?: ReactNode }) {
  return <div className="cw-card-head"><h2><span className="cw-card-icon"><I size={14} /></span> {title}</h2>{children ?? (note && <small>{note}</small>)}</div>;
}

/* ------------------------------------------------------------------ KPI tile */
function Spark({ values }: { values: number[] }) {
  const W = 96, H = 32, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (W - 4) + 2, H - 3 - (v / max) * (H - 8)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="cw-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={`${line} L${lx},${H} L2,${H} Z`} className="area" />
      <path d={line} className="line" />
      <circle cx={lx} cy={ly} r={3} />
    </svg>
  );
}

export function Kpi({ icon: I, label, value, sub, delta, prevLabel, fmt = n, spark, sparkLabel, lead, goodWhenDown = true, color }: {
  icon: ElementType; label: string; value: string; sub: string; delta?: number | null; prevLabel?: string; fmt?: (v: number) => string;
  spark?: number[]; sparkLabel?: string; lead?: boolean; goodWhenDown?: boolean;
  /** CSS colour for this tile's icon (and sparkline), e.g. "var(--rg-help)"; defaults to the page's series colour */
  color?: string;
}) {
  const good = delta != null && (goodWhenDown ? delta < 0 : delta > 0);
  return (
    <motion.div className={`cw-kpi ${lead ? "lead" : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={color ? ({ "--cw-series": color, "--cw-tint": `color-mix(in srgb, ${color} 14%, transparent)` } as CSSProperties) : undefined}>
      <div className="cw-kpi-top">
        <span className="cw-kpi-icon"><I size={16} /></span>
        <span className="cw-kpi-label">{label}</span>
      </div>
      <div className="cw-kpi-mid">
        <b className="cw-kpi-value tabular">{value}</b>
        {spark && spark.some((v) => v > 0) && <span className="cw-spark-wrap" title={sparkLabel}><Spark values={spark} /></span>}
      </div>
      <small>{sub}</small>
      {delta != null && prevLabel && (
        <span className={`cw-delta ${Math.abs(delta) < 0.5 ? "" : good ? "good" : "bad"}`}>
          {delta > 0.5 ? <ArrowUpRight size={12} /> : delta < -0.5 ? <ArrowDownRight size={12} /> : null}
          {Math.abs(delta) < 0.5 ? `Same as ${prevLabel}` : `${fmt(Math.abs(delta))} ${delta > 0 ? "more" : "less"} than ${prevLabel}`}
        </span>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ highlights */
export interface Highlight { icon: ElementType; text: ReactNode; tone?: "warn" | "good" }
/** Short sentences worked out from the data in view (the page decides which ones apply). */
export function Highlights({ items, empty }: { items: Highlight[]; empty: string }) {
  if (items.length === 0) return <p className="cw-empty small">{empty}</p>;
  return (
    <ul className="cw-hl">
      {items.map((h, i) => {
        const I = h.icon;
        return (
          <motion.li key={i} className={h.tone ?? ""} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
            <span className="cw-hl-icon"><I size={14} /></span>
            <span className="cw-hl-text">{h.text}</span>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ month columns */
/** One column per month (at least 6, at most 12), every month labelled with its value. Click → that month. */
export function MonthChart<T extends Dated>({ rows, range, today, onPick, measure = (rs) => rs.length, fmt = n, short = fmt, axis = n, tip, noun }: {
  rows: T[]; range: Range; today: string; onPick: (month: string) => void; measure?: (rs: T[]) => number;
  fmt?: (v: number) => string; short?: (v: number) => string; axis?: (v: number) => string; tip: (rs: T[]) => ReactNode; noun: string;
}) {
  const last = monthOf(today);
  const first = rows.reduce((m, r) => (r.day && monthOf(r.day) < m ? monthOf(r.day) : m), last);
  let start = first < addMonths(last, -11) ? addMonths(last, -11) : first;
  if (start > addMonths(last, -5)) start = addMonths(last, -5);
  const months: { m: string; rows: T[]; v: number }[] = [];
  for (let m = start; m <= last; m = addMonths(m, 1)) {
    const inM = rows.filter((r) => r.day && monthOf(r.day) === m);
    months.push({ m, rows: inM, v: measure(inM) });
  }
  const peak = Math.max(...months.map((x) => x.v));
  const max = niceMax(peak);
  const sel = (m: string) => range.from === null || within(m, range.from, range.to) || within(range.from, m, addMonths(m, 1));
  const avg = Math.round((months.reduce((s, x) => s + x.v, 0) / months.length) * 10) / 10;
  const peakMonth = months.find((x) => x.v === peak);
  return (
    <div className="cw-mchart">
      <div className="cw-mplot">
        {[1, 0.5, 0].map((t) => (
          <div key={t} className="cw-gridline" style={{ bottom: `${t * 100}%` }}><span className="tabular">{axis(max * t)}</span></div>
        ))}
        {avg > 0 && (
          <div className="cw-avgline" style={{ bottom: `${(avg / max) * 100}%` }}><span>avg</span></div>
        )}
        <div className="cw-mcols">
          {months.map((x, i) => (
            <button key={x.m} className={`cw-mcol ${sel(x.m) ? "" : "dim"} ${x.v === peak && peak > 0 ? "peak" : ""} ${i === 0 ? "first" : i === months.length - 1 ? "last" : ""}`}
              onClick={() => onPick(x.m)} aria-label={`${bucketLabel(x.m, "month")}: ${fmt(x.v)} ${noun}`}>
              <span className="cw-mbar-wrap">
                {x.v > 0 && <em className="tabular" style={{ bottom: `calc(${(x.v / max) * 100}% + 4px)` }}>{short(x.v)}</em>}
                <motion.i className="cw-mbar" initial={{ height: 0 }} animate={{ height: `${(x.v / max) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.04 }} />
              </span>
              <span className="cw-tip" role="tooltip"><b>{bucketLabel(x.m, "month")}</b>{tip(x.rows)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cw-mlabels">
        {months.map((x, i) => (
          <span key={x.m} className={x.m === last ? "now" : ""}>
            {lbl(x.m, { month: "short" })}
            <small>{x.m === last ? "so far" : i === 0 || x.m.endsWith("-01-01") ? x.m.slice(0, 4) : " "}</small>
          </span>
        ))}
      </div>
      <p className="cw-chart-foot">
        Highest: <b>{peakMonth && peak ? bucketLabel(peakMonth.m, "month") : "—"}</b> ({fmt(peak)}) · dashed line = monthly average ({fmt(avg)})
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ ranked bars */
/** Ranked bars: the full name and value on top, the bar under it. Clicking a row filters the page when onPick is given. */
export function Ranked<T>({ rows, keyOf, measure = () => 1, fmt = n, selected, onPick, limit = 6, empty, tip }: {
  rows: T[]; keyOf: (r: T) => string; measure?: (r: T) => number; fmt?: (v: number) => string;
  selected?: string | null; onPick?: (k: string | null) => void; limit?: number; empty: string; tip?: (k: string, rs: T[]) => ReactNode;
}) {
  const [more, setMore] = useState(false);
  const groups = new Map<string, T[]>();
  for (const r of rows) { const k = keyOf(r); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const sorted = [...groups.entries()].map(([k, rs]) => ({ k, rs, v: rs.reduce((s, r) => s + measure(r), 0) })).sort((a, b) => b.v - a.v);
  if (sorted.length === 0) return <p className="cw-empty small">{empty}</p>;
  const shown = more ? sorted : sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const max = sorted[0].v || 1;
  const total = sorted.reduce((s, x) => s + x.v, 0) || 1;
  const Tag = onPick ? "button" : "div";
  return (
    <>
      <ul className="cw-ranked">
        {shown.map((x, i) => (
          <li key={x.k}>
            <Tag className={`cw-rank-row ${selected === x.k ? "on" : ""} ${selected && selected !== x.k ? "dim" : ""}`}
              {...(onPick ? { onClick: () => onPick(selected === x.k ? null : x.k), "aria-pressed": selected === x.k } : { tabIndex: 0 })}>
              <span className="cw-rank-top">
                <span className={`cw-rank-n ${i < 3 ? "top" : ""}`}>{i + 1}</span>
                <span className="cw-rank-name">{x.k}</span>
                <b className="tabular">{fmt(x.v)}</b>
                <small className="tabular">{pct(x.v, total)}%</small>
              </span>
              <span className="cw-rank-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(2, (x.v / max) * 100)}%` }} transition={{ duration: 0.5, delay: i * 0.04 }} /></span>
              {tip && <span className="cw-tip" role="tooltip"><b>{x.k}</b>{tip(x.k, x.rs)}</span>}
            </Tag>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <button className="cw-rank-more" onClick={() => setMore(!more)}>
          {more ? "Show top " + limit : `+ ${n(rest.length)} more (${fmt(rest.reduce((s, x) => s + x.v, 0))})`}
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ weekday columns */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const weekdayOf = (day: string) => (D(day).getUTCDay() + 6) % 7;
export function Weekdays<T extends Dated>({ rows, noun }: { rows: T[]; noun: string }) {
  const counts = WEEKDAYS.map(() => 0);
  for (const r of rows) if (r.day) counts[weekdayOf(r.day)] += 1;
  const top = Math.max(...counts);
  const max = Math.max(1, top) * 1.15;
  const peak = counts.indexOf(top);
  if (rows.length === 0) return <p className="cw-empty small">Nothing in this period.</p>;
  return (
    <>
      <div className="cw-wdays">
        {counts.map((v, i) => (
          <div key={i} className={`cw-wday ${i === peak && v > 0 ? "peak" : ""}`} tabIndex={0} aria-label={`${WEEKDAY_NAMES[i]}: ${v} ${noun}`}>
            <span className="cw-wday-plot">
              {v > 0 && <em className="tabular" style={{ bottom: `calc(${(v / max) * 100}% + 4px)` }}>{v}</em>}
              <motion.i initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ duration: 0.45, delay: i * 0.04 }} />
            </span>
            <small>{WEEKDAYS[i]}</small>
          </div>
        ))}
      </div>
      <p className="cw-chart-foot">Most on <b>{WEEKDAY_NAMES[peak]}</b> · {pct(top, rows.length)}% of the period</p>
    </>
  );
}

/* ------------------------------------------------------------------ Day / Week / Month table */
export interface BreakdownColumn<T> { label: string; cell: (rs: T[]) => string }
/** Every period in a row (30 days, 12 weeks, or every month since the first record): a bar with the count, then
 * the given columns; View shows that period's records. Empty periods can be hidden. */
export function Breakdown<T extends Dated>({ rows, group, setGroup, today, active, onView, noun, countLabel, columns }: {
  rows: T[]; group: Group; setGroup: (g: Group) => void; today: string; active: string; onView: (r: Range) => void;
  noun: string; countLabel: string; columns: BreakdownColumn<T>[];
}) {
  const [hideEmpty, setHideEmpty] = useState(false);
  const nowStart = startOf(today, group);
  const firstDay = rows.reduce((m, r) => (r.day && r.day < m ? r.day : m), today);
  const buckets: string[] = [];
  if (group === "month") {
    for (let m = nowStart; (m >= monthOf(firstDay) || buckets.length < 6) && buckets.length < 24; m = addMonths(m, -1)) buckets.push(m);
  } else {
    for (let i = 0, s = nowStart; i < (group === "day" ? 30 : 12); i++, s = startOf(addDays(s, -1), group)) buckets.push(s);
  }
  const stats = buckets.map((s) => ({ s, rows: rows.filter((r) => within(r.day, s, endOf(s, group))) }));
  const max = Math.max(1, ...stats.map((x) => x.rows.length));
  const shown = hideEmpty ? stats.filter((x) => x.rows.length || x.s === nowStart) : stats;
  const empties = stats.filter((x) => !x.rows.length).length;
  const word = { day: "Today", week: "This week", month: "This month" }[group];
  const unit = group === "day" ? "Day" : group === "week" ? "Week" : "Month";
  return (
    <section className="cw-card cw-breakdown">
      <div className="cw-card-head">
        <h2><span className="cw-card-icon"><CalendarRange size={14} /></span> {noun} by {group}</h2>
        <div className="cw-bd-tools">
          {empties > 0 && (
            <label className="cw-switch">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              <i /> Hide empty {group === "day" ? "days" : group === "week" ? "weeks" : "months"}
            </label>
          )}
          <div className="cw-pills small" role="tablist" aria-label="Group by">
            {(["day", "week", "month"] as Group[]).map((g) => (
              <button key={g} role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>
                {g === "day" ? "Day" : g === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="cw-bd-scroll">
        <table className="cw-bd">
          <thead>
            <tr>
              <th>{unit}</th>
              <th className="num">{countLabel}</th>
              {columns.map((c) => <th key={c.label} className="num">{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => {
              const rg = rangeFor(x.s, group);
              const count = x.rows.length;
              return (
                <tr key={x.s} className={`${x.s === nowStart ? "now" : ""} ${active === rg.key ? "active" : ""} ${count ? "" : "zero"}`}>
                  <td>{bucketLabel(x.s, group)}{x.s === nowStart && <span className="cw-now">{word}</span>}</td>
                  <td className="num">
                    <span className="cw-bd-count">
                      <span className="cw-bd-bar"><i style={{ width: `${count ? Math.max(4, (count / max) * 100) : 0}%` }} /></span>
                      <b className="tabular">{n(count)}</b>
                    </span>
                  </td>
                  {columns.map((c) => <td key={c.label} className="num tabular">{count ? c.cell(x.rows) : "—"}</td>)}
                  <td className="num"><button className="cw-view" disabled={!count} onClick={() => onView(rg)}>View</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ list bits */
const AVATAR_TONES = 6;
/** Initials in a soft circle; the tone follows the name so a customer keeps the same look across rows. */
export function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className={`cw-avatar t${h % AVATAR_TONES}`} aria-hidden="true">{initials}</span>;
}
