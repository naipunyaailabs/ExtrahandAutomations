import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Crown, Loader2, MapPin, TrendingUp, Users, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { EngagementRegions } from "../types";
import { Highlights, n, type Highlight } from "./EngagementKit";
import "./regions.css";
import "./cancellation.css";

/** Customer Engagement Dashboard → which cities have the most customers and helpers (live from ExtraHand, the same
 * data as the Regions page): the top cities with both counts as paired bars (customers yellow, helpers orange),
 * ranked by both, customers, helpers or new signups this month, and a few highlights. */

type Sort = "both" | "customers" | "helpers" | "active" | "new";
const SORTS: { key: Sort; label: string }[] = [
  { key: "both", label: "Customers + helpers" },
  { key: "customers", label: "Customers" },
  { key: "helpers", label: "Helpers" },
  { key: "active", label: "Active" },
  { key: "new", label: "New this month" },
];
const NO_CITY = "City not set";
const TOP = 10;

interface City { name: string; state: string; customers: number; helpers: number; newC: number; newH: number; actC: number; actH: number }

export function TopCitiesCard() {
  const data = usePoll<EngagementRegions>(api.engagement.regions, 60000);
  const [sort, setSort] = useState<Sort>("both");
  const r = data.data;
  const ready = !!(r && !r.loading && r.states);

  const cities: City[] = useMemo(() => (r?.states ?? []).filter((s) => s.name !== "Location not set").flatMap((s) => s.cities
    .filter((c) => c.name !== NO_CITY)
    .map((c) => ({ name: c.name, state: s.name, customers: c.customers, helpers: c.helpers, newC: c.new_customers, newH: c.new_helpers,
      actC: c.active_customers ?? 0, actH: c.active_helpers ?? 0 }))), [r]);
  const showActive = !!r?.active_known;
  const days = r?.active_days ?? 30;

  const isNew = sort === "new";
  const cv = (c: City) => (isNew ? c.newC : c.customers);
  const hv = (c: City) => (isNew ? c.newH : c.helpers);
  const av = (c: City) => c.actC + c.actH;
  const score = (c: City) => (sort === "customers" ? c.customers * 1e5 + c.helpers : sort === "helpers" ? c.helpers * 1e5 + c.customers
    : sort === "active" ? av(c) * 1e5 + c.customers + c.helpers : isNew ? c.newC + c.newH : c.customers + c.helpers);
  const top = [...cities].sort((a, b) => score(b) - score(a)).slice(0, TOP).filter((c) => score(c) > 0);
  const max = Math.max(1, ...top.map((c) => Math.max(cv(c), hv(c), showActive && !isNew ? av(c) : 0)));

  const totals = cities.reduce((a, c) => ({ c: a.c + c.customers, h: a.h + c.helpers, nc: a.nc + c.newC, nh: a.nh + c.newH,
    ac: a.ac + c.actC, ah: a.ah + c.actH }), { c: 0, h: 0, nc: 0, nh: 0, ac: 0, ah: 0 });
  const highlights: Highlight[] = [];
  if (cities.length) {
    const byC = [...cities].sort((a, b) => b.customers - a.customers)[0];
    const byH = [...cities].sort((a, b) => b.helpers - a.helpers)[0];
    const growing = [...cities].sort((a, b) => b.newC + b.newH - (a.newC + a.newH))[0];
    const noHelper = cities.filter((c) => c.customers > 0 && c.helpers === 0);
    const short = cities.filter((c) => c.customers >= 20 && c.helpers > 0).sort((a, b) => b.customers / b.helpers - a.customers / a.helpers)[0];
    highlights.push({ icon: Users, text: <>Most customers: <b>{byC.name}</b> ({n(byC.customers)})</> });
    highlights.push({ icon: Wrench, text: <>Most helpers: <b>{byH.name}</b> ({n(byH.helpers)})</> });
    if (growing && growing.newC + growing.newH > 0) {
      highlights.push({ icon: TrendingUp, tone: "good", text: <>Growing fastest this month: <b>{growing.name}</b><small>+{n(growing.newC)} customers · +{n(growing.newH)} helpers</small></> });
    }
    if (short) highlights.push({ icon: Crown, tone: short.customers / short.helpers >= 5 ? "warn" : undefined,
      text: <><b>{short.name}</b> has the most customers per helper: {(short.customers / short.helpers).toFixed(1)}</> });
    if (noHelper.length) highlights.push({ icon: AlertTriangle, tone: "warn",
      text: <><b>{n(noHelper.length)} cities</b> have customers but no helper<small>{n(noHelper.reduce((s, c) => s + c.customers, 0))} customers there</small></> });
  }

  return (
    <section className="cw-page rg-page tc-card">
      <div className="tc-head">
        <div>
          <h3><MapPin size={16} /> Cities with the most customers and helpers</h3>
          <small>{ready ? <>{n(cities.length)} cities · {n(totals.c)} customers · {n(totals.h)} helpers · live from ExtraHand</> : "Live from ExtraHand"}</small>
        </div>
        <div className="tc-tools">
          <div className="cw-pills small" role="tablist" aria-label="Rank cities by">
            {SORTS.map((s) => (
              <button key={s.key} role="tab" aria-selected={sort === s.key} className={sort === s.key ? "on" : ""} onClick={() => setSort(s.key)}>{s.label}</button>
            ))}
          </div>
          <Link className="cx-link tc-link" to="/engagement/regions">All cities <ArrowRight size={13} /></Link>
        </div>
      </div>

      {data.error && <div className="cw-error">{data.error}</div>}
      {!ready && !data.error && <p className="tc-wait"><Loader2 size={14} className="spin" /> Reading every customer and helper from ExtraHand… the first read takes about half a minute.</p>}

      {ready && (
        <div className="tc-body">
          <div>
            <div className="rg-legend">
              <span><i className="c" /> Customers{isNew ? " (new this month)" : ""}</span>
              <span><i className="h" /> Helpers{isNew ? " (new this month)" : ""}</span>
              {showActive && !isNew && <span title={`Customers who booked, and helpers who were given, a Work in the last ${days} days`}><i className="a" /> Active: booked or got a Work (last {days} days)</span>}
              {isNew && <span>· {n(totals.nc)} new customers and {n(totals.nh)} new helpers in all</span>}
              {sort === "active" && <span>· {n(totals.ac)} active customers and {n(totals.ah)} active helpers in all</span>}
            </div>
            {top.length === 0 ? <p className="cw-empty small">No new signups with a city this month yet.</p> : (
              <ol className="rg-pairs">
                {top.map((c, i) => (
                  <li key={`${c.state}|${c.name}`}>
                    <span className={`cw-rank-n ${i < 3 ? "top" : ""}`}>{i + 1}</span>
                    <span className="rg-pair-name"><b>{c.name}</b><small>{c.state}</small></span>
                    <span className="rg-pair-bars">
                      <span className="rg-bar c" title={`${n(cv(c))} ${isNew ? "new " : ""}customers`}>
                        <motion.i initial={{ width: 0 }} animate={{ width: `${cv(c) ? Math.max(1.5, (cv(c) / max) * 100) : 0}%` }} transition={{ duration: 0.5, delay: i * 0.03 }} />
                        <b className="tabular">{isNew && cv(c) ? "+" : ""}{n(cv(c))}</b>
                      </span>
                      <span className="rg-bar h" title={`${n(hv(c))} ${isNew ? "new " : ""}helpers`}>
                        <motion.i initial={{ width: 0 }} animate={{ width: `${hv(c) ? Math.max(1.5, (hv(c) / max) * 100) : 0}%` }} transition={{ duration: 0.5, delay: i * 0.03 + 0.05 }} />
                        <b className="tabular">{isNew && hv(c) ? "+" : ""}{n(hv(c))}</b>
                      </span>
                      {showActive && !isNew && (
                        <span className="rg-bar a" title={`Active in the last ${days} days: ${n(c.actC)} customers booked, ${n(c.actH)} helpers got a Work`}>
                          <motion.i initial={{ width: 0 }} animate={{ width: `${av(c) ? Math.max(1.5, (av(c) / max) * 100) : 0}%` }} transition={{ duration: 0.5, delay: i * 0.03 + 0.1 }} />
                          <b className="tabular act">{n(av(c))} active <small>{n(c.actC)} customers · {n(c.actH)} helpers</small></b>
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <Highlights items={highlights} empty="No cities found yet." />
        </div>
      )}
    </section>
  );
}
