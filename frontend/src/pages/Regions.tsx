import { motion } from "framer-motion";
import {
  AlertTriangle, ArrowDownUp, Building2, Crown, Loader2, MapPin, PieChart, RefreshCw, Search, Sparkles, TrendingUp, UserPlus,
  Users, Wrench, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { EngagementRegions } from "../types";
import { CardHead, Highlights, Kpi, Skeleton, fmtTime, n, pct, type Highlight } from "./EngagementKit";
import "./regions.css";

/** User Engagement → Regions: customers and helpers by city and state, from the location saved in each ExtraHand
 * account (backend/user_engagement/regions.py, refreshed every 5 minutes). Cities are ranked by helpers + customers
 * (or customers, helpers, or where helpers are short); customers are yellow and listed first, helpers orange; every bar carries
 * its number. Every state and city in the data appears on its own: nothing is listed by hand. */

type Sort = "total" | "helpers" | "customers" | "gap";
const SORTS: { key: Sort; label: string; hint: string }[] = [
  { key: "total", label: "Customers + helpers", hint: "biggest cities first" },
  { key: "customers", label: "Most customers", hint: "where demand is" },
  { key: "helpers", label: "Most helpers", hint: "where the helper base is" },
  { key: "gap", label: "Need helpers", hint: "most customers per helper" },
];
const NO_CITY = "City not set";
const NOT_PLACED = new Set(["Location not set"]);
const PAGE = 25;

interface City { name: string; state: string; stateKind: "state" | "other"; helpers: number; customers: number; newHelpers: number; newCustomers: number }

/** customers per helper; Infinity when there are customers and no helper */
const ratio = (c: City) => (c.helpers ? c.customers / c.helpers : c.customers ? Infinity : 0);
const score: Record<Sort, (c: City) => number> = {
  total: (c) => c.helpers + c.customers,
  helpers: (c) => c.helpers * 100000 + c.customers,
  customers: (c) => c.customers * 100000 + c.helpers,
  gap: (c) => (c.customers < 5 ? -1 : (ratio(c) === Infinity ? 1e6 : ratio(c)) * 100000 + c.customers),
};

export function RegionsPage() {
  const data = usePoll<EngagementRegions>(api.engagement.regions, 15000);
  const [sort, setSort] = useState<Sort>("total");
  const [state, setState] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const r = data.data;
  const ready = !!(r && !r.loading && r.states && r.totals);

  const cities: City[] = useMemo(() => (r?.states ?? []).flatMap((s) => s.cities
    .filter((c) => c.name !== NO_CITY && !NOT_PLACED.has(s.name))
    .map((c) => ({ name: c.name, state: s.name, stateKind: s.kind, helpers: c.helpers, customers: c.customers, newHelpers: c.new_helpers, newCustomers: c.new_customers }))), [r]);
  const unplaced = useMemo(() => {
    let h = 0, c = 0;
    for (const s of r?.states ?? []) for (const x of s.cities) if (x.name === NO_CITY || NOT_PLACED.has(s.name)) { h += x.helpers; c += x.customers; }
    return { h, c };
  }, [r]);

  const states = (r?.states ?? []).filter((s) => !NOT_PLACED.has(s.name));
  const inState = cities.filter((c) => !state || c.state === state);
  const ranked = [...inState].sort((a, b) => score[sort](b) - score[sort](a) || a.name.localeCompare(b.name));
  const query = q.trim().toLowerCase();
  const list = ranked.filter((c) => !query || c.name.toLowerCase().includes(query) || c.state.toLowerCase().includes(query));
  const rankOf = new Map(ranked.map((c, i) => [`${c.state}|${c.name}`, i + 1]));

  const tot = inState.reduce((a, c) => ({ h: a.h + c.helpers, c: a.c + c.customers, nh: a.nh + c.newHelpers, nc: a.nc + c.newCustomers }), { h: 0, c: 0, nh: 0, nc: 0 });
  const overall = tot.h ? tot.c / tot.h : 0;
  const status = (c: City): { key: string; label: string } | null => {
    if (c.customers > 0 && c.helpers === 0) return { key: "none", label: "No helper yet" };
    if (c.customers >= 10 && ratio(c) >= Math.max(4, overall * 2)) return { key: "short", label: "Needs helpers" };
    if (c.helpers > 0 && c.customers === 0) return { key: "idle", label: "No customers yet" };
    return null;
  };

  // highlights from the data in view
  const highlights: Highlight[] = [];
  if (inState.length) {
    const top = [...inState].sort((a, b) => b.helpers + b.customers - (a.helpers + a.customers))[0];
    highlights.push({ icon: Crown, text: <><b>{top.name}</b> is the biggest city: {n(top.customers)} customers and {n(top.helpers)} helpers.</> });
    const top5 = [...inState].sort((a, b) => b.customers - a.customers).slice(0, 5);
    highlights.push({ icon: PieChart, text: <>The top 5 cities hold <b>{pct(top5.reduce((s, c) => s + c.customers, 0), tot.c)}%</b> of customers<small>{top5.map((c) => c.name).join(", ")}</small></> });
    const noHelper = inState.filter((c) => c.helpers === 0 && c.customers > 0);
    if (noHelper.length) {
      const big = [...noHelper].sort((a, b) => b.customers - a.customers).slice(0, 3);
      highlights.push({ icon: AlertTriangle, tone: "warn", text: <><b>{n(noHelper.length)} cities</b> have customers but no helper ({n(noHelper.reduce((s, c) => s + c.customers, 0))} customers)<small>Largest: {big.map((c) => `${c.name} (${c.customers})`).join(", ")}</small></> });
    }
    const short = inState.filter((c) => c.customers >= 20 && c.helpers > 0).sort((a, b) => ratio(b) - ratio(a))[0];
    if (short) highlights.push({ icon: Users, tone: ratio(short) >= overall * 2 ? "warn" : undefined, text: <><b>{short.name}</b> has the most customers per helper: {ratio(short).toFixed(1)} (average {overall.toFixed(1)}).</> });
    const growC = [...inState].sort((a, b) => b.newCustomers - a.newCustomers)[0];
    if (growC?.newCustomers) highlights.push({ icon: TrendingUp, tone: "good", text: <>Most new customers this month: <b>{growC.name}</b> (+{n(growC.newCustomers)}).</> });
    const growH = [...inState].sort((a, b) => b.newHelpers - a.newHelpers)[0];
    if (growH?.newHelpers) highlights.push({ icon: UserPlus, tone: "good", text: <>Most new helpers this month: <b>{growH.name}</b> (+{n(growH.newHelpers)}).</> });
  }

  const top10 = ranked.slice(0, 10);
  const barMax = Math.max(1, ...top10.map((c) => Math.max(c.helpers, c.customers)));
  const listMax = { h: Math.max(1, ...ranked.map((c) => c.helpers)), c: Math.max(1, ...ranked.map((c) => c.customers)) };

  return (
    <div className="cw-page rg-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><MapPin size={13} /> Customer Engagement</span>
            <h1>Regions</h1>
            <p>Where ExtraHand's helpers and customers are, by city and state, from the location saved in each account.</p>
          </div>
          <div className="cw-head-tools">
            {ready && r!.fetched_at && <span className="cw-updated">Live · updated {fmtTime(r!.fetched_at)}</span>}
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        {ready && (
          <div className="cw-controls">
            <div className="cw-seg rg-states" role="tablist" aria-label="State">
              <button role="tab" aria-selected={!state} className={!state ? "on" : ""} onClick={() => setState(null)}>
                All states <span className="tabular">{n(cities.length)}</span>
              </button>
              {states.filter((s) => s.kind === "state").slice(0, 6).map((s) => (
                <button key={s.name} role="tab" aria-selected={state === s.name} className={state === s.name ? "on" : ""} onClick={() => setState(state === s.name ? null : s.name)}>
                  {s.name} <span className="tabular">{n(s.cities.filter((c) => c.name !== NO_CITY).length)}</span>
                </button>
              ))}
            </div>
            <div className="cw-pills" role="tablist" aria-label="Rank cities by">
              <ArrowDownUp size={14} />
              {SORTS.map((s) => (
                <button key={s.key} role="tab" aria-selected={sort === s.key} className={sort === s.key ? "on" : ""} onClick={() => setSort(s.key)} title={s.hint}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
      </header>

      {data.error && <div className="cw-error">{data.error}</div>}
      {!ready && !data.error && (
        <Skeleton note={<><Loader2 size={15} className="spin" /> Reading every customer and helper from ExtraHand… the first read takes about half a minute.</>} />
      )}

      {ready && (
        <>
          {state && (
            <div className="cw-active">
              <span>Showing only</span>
              <button onClick={() => setState(null)}><MapPin size={12} /> {state} <X size={12} /></button>
            </div>
          )}

          <div className="cw-kpis">
            <Kpi icon={Users} label="Customers" color="var(--rg-cust)" value={n(tot.c)}
              sub={state ? `in ${state}${tot.nc ? ` · +${n(tot.nc)} this month` : ""}` : `of ${n(r!.totals!.customers)} have a location${tot.nc ? ` · +${n(tot.nc)} this month` : ""}`} />
            <Kpi icon={Wrench} label="Helpers" color="var(--rg-help)" value={n(tot.h)}
              sub={state ? `in ${state}${tot.nh ? ` · +${n(tot.nh)} this month` : ""}` : `of ${n(r!.totals!.helpers)} have a location${tot.nh ? ` · +${n(tot.nh)} this month` : ""}`} />
            <Kpi icon={Building2} label="Cities" value={n(inState.length)} sub={state ? `in ${state}` : `in ${n(r!.totals!.states)} states`} />
            <Kpi icon={ArrowDownUp} label="Customers per helper" value={overall ? overall.toFixed(1) : "—"}
              sub={`${n(inState.filter((c) => status(c)?.key === "none").length)} cities with no helper yet`} />
          </div>

          <div className="cw-row">
            <section className="cw-card">
              <CardHead icon={MapPin} title={`Top 10 cities · ${SORTS.find((s) => s.key === sort)!.label.toLowerCase()}`} note={state ?? "All states"} />
              <div className="rg-legend">
                <span><i className="c" /> Customers</span>
                <span><i className="h" /> Helpers</span>
              </div>
              <ol className="rg-pairs">
                {top10.map((c, i) => (
                  <li key={`${c.state}|${c.name}`}>
                    <span className={`cw-rank-n ${i < 3 ? "top" : ""}`}>{i + 1}</span>
                    <span className="rg-pair-name"><b>{c.name}</b>{!state && <small>{c.state}</small>}</span>
                    <span className="rg-pair-bars">
                      <span className="rg-bar c"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(c.customers ? 1.5 : 0, (c.customers / barMax) * 100)}%` }} transition={{ duration: 0.5, delay: i * 0.03 }} /><b className="tabular">{n(c.customers)}</b></span>
                      <span className="rg-bar h"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(c.helpers ? 1.5 : 0, (c.helpers / barMax) * 100)}%` }} transition={{ duration: 0.5, delay: i * 0.03 + 0.05 }} /><b className="tabular">{n(c.helpers)}</b></span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="cw-card">
              <CardHead icon={Sparkles} title="Highlights" note={state ?? "All states"} />
              <Highlights items={highlights} empty="No cities found." />
            </section>
          </div>

          <div className="cw-row rev">
            <section className="cw-card">
              <CardHead icon={Building2} title="States" note="click to filter" />
              <ul className="rg-states-list">
                {states.map((s) => {
                  const total = s.helpers + s.customers || 1;
                  return (
                    <li key={s.name}>
                      <button className={`${state === s.name ? "on" : ""} ${state && state !== s.name ? "dim" : ""}`} onClick={() => setState(state === s.name ? null : s.name)}
                        disabled={s.kind !== "state"} title={s.kind !== "state" ? "Not a state: users whose state could not be recognised" : undefined}>
                        <span className="rg-st-top">
                          <b>{s.name}</b>
                          <small>{n(s.cities.filter((c) => c.name !== NO_CITY).length)} cities</small>
                        </span>
                        <span className="rg-st-split" aria-hidden="true">
                          <i className="c" style={{ width: `${(s.customers / total) * 100}%` }} />
                          <i className="h" style={{ width: `${(s.helpers / total) * 100}%` }} />
                        </span>
                        <span className="rg-st-nums">
                          <span><Users size={11} /> {n(s.customers)}</span>
                          <span><Wrench size={11} /> {n(s.helpers)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {(unplaced.h + unplaced.c) > 0 && (
                <p className="cw-chart-foot">No city or location saved: {n(unplaced.c)} customers · {n(unplaced.h)} helpers.</p>
              )}
            </section>

            <section className="cw-card rg-tablecard">
              <div className="cw-card-head">
                <h2><span className="cw-card-icon"><MapPin size={14} /></span> All cities</h2>
                <div className="cw-search rg-search">
                  <Search size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city or state" aria-label="Search a city or state" />
                  {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
                </div>
              </div>
              <div className="rg-scroll">
                <table className="rg-table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>City</th>
                      <SortTh label="Customers" k="customers" sort={sort} setSort={setSort} />
                      <SortTh label="Helpers" k="helpers" sort={sort} setSort={setSort} />
                      <SortTh label="Per helper" k="gap" sort={sort} setSort={setSort} />
                      <th className="num">New this month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll || query ? list : list.slice(0, PAGE)).map((c) => {
                      const st = status(c);
                      const rt = ratio(c);
                      return (
                        <tr key={`${c.state}|${c.name}`} className={st?.key ?? ""}>
                          <td className="num rg-rank tabular">{rankOf.get(`${c.state}|${c.name}`)}</td>
                          <td>
                            <b className="rg-city">{c.name}</b>
                            {(!state || st) && <small>{state ? "" : c.state}{!state && st ? " · " : ""}{st ? <span className={`rg-tag ${st.key}`}>{st.label}</span> : null}</small>}
                          </td>
                          <td className="num"><Cell v={c.customers} max={listMax.c} kind="c" /></td>
                          <td className="num"><Cell v={c.helpers} max={listMax.h} kind="h" /></td>
                          <td className="num tabular">{rt === Infinity ? <span className="rg-inf">no helper</span> : rt ? rt.toFixed(1) : "—"}</td>
                          <td className="num rg-new">
                            {c.newHelpers || c.newCustomers ? (
                              <>
                                {c.newCustomers > 0 && <span className="c"><Users size={10} /> +{n(c.newCustomers)}</span>}
                                {c.newHelpers > 0 && <span className="h"><Wrench size={10} /> +{n(c.newHelpers)}</span>}
                              </>
                            ) : <span className="cw-muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {list.length === 0 && <p className="cw-empty">No city matches “{q}”.</p>}
              </div>
              {!query && list.length > PAGE && (
                <button className="cw-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 25" : `Show all ${n(list.length)} cities`}</button>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function SortTh({ label, k, sort, setSort }: { label: string; k: Sort; sort: Sort; setSort: (s: Sort) => void }) {
  return (
    <th className="num">
      <button className={`rg-sort ${sort === k ? "on" : ""}`} onClick={() => setSort(sort === k ? "total" : k)} title={`Rank by ${label.toLowerCase()}`}>
        {label} {sort === k ? "↓" : ""}
      </button>
    </th>
  );
}

/** a short bar and the number, in the customers (yellow) or helpers (orange) colour */
function Cell({ v, max, kind }: { v: number; max: number; kind: "h" | "c" }) {
  return (
    <span className={`rg-cell ${kind}`}>
      <span className="rg-cell-bar"><i style={{ width: `${v ? Math.max(4, (v / max) * 100) : 0}%` }} /></span>
      <b className="tabular">{n(v)}</b>
    </span>
  );
}
