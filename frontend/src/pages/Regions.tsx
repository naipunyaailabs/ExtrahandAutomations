import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Loader2, MapPin, RefreshCw, Search, Users, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { EngagementRegions, RegionCounts, RegionState } from "../types";
import "./regions.css";

const n = (v: number) => v.toLocaleString("en-IN");
const CITY_PREVIEW = 12;

/** User Engagement → Regions: customers and helpers by state and city, built from the location each user saved in
 * ExtraHand. Every state and city in the data gets its card, so new ones appear on their own. */
export function RegionsPage() {
  const data = usePoll<EngagementRegions>(api.engagement.regions, 15000);
  const [q, setQ] = useState("");
  const r = data.data;
  const ready = r && !r.loading && r.states && r.totals;

  const query = q.trim().toLowerCase();
  const states = useMemo(() => {
    if (!r?.states) return [];
    if (!query) return r.states;
    return r.states
      .map((s) => s.name.toLowerCase().includes(query) ? s : { ...s, cities: s.cities.filter((c) => c.name.toLowerCase().includes(query)) })
      .filter((s) => s.name.toLowerCase().includes(query) || s.cities.length > 0);
  }, [r, query]);
  const real = states.filter((s) => s.kind === "state");
  const other = states.filter((s) => s.kind === "other");

  return (
    <div className="rg-page">
      <header className="rg-head">
        <div className="rg-head-title">
          <span className="rg-kicker"><MapPin size={13} /> User Engagement</span>
          <h1>Regions</h1>
          <p>Customers and helpers by state and city, from the location saved in each ExtraHand account.</p>
        </div>
        <div className="rg-head-tools">
          {ready && r.fetched_at && (
            <span className="rg-updated">Updated {new Date(r.fetched_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
          )}
          <button className="rg-btn" onClick={data.refresh}><RefreshCw size={13} /> Refresh</button>
        </div>
      </header>

      {data.error && <div className="rg-error">{data.error}</div>}

      {!ready && !data.error && (
        <div className="rg-loading">
          <Loader2 size={20} className="spin" />
          <div>
            <b>Reading every customer and helper from ExtraHand…</b>
            <span>The first read takes about half a minute; after that the page opens at once and refreshes every 5 minutes.</span>
          </div>
        </div>
      )}

      {ready && (
        <>
          <div className="rg-totals">
            <Total label="States" value={n(r.totals!.states)} />
            <Total label="Cities" value={n(r.totals!.cities)} />
            <Total label="Customers" value={n(r.totals!.customers_placed)} sub={`of ${n(r.totals!.customers)} have a location`} icon={<Users size={14} />} tone="cust" />
            <Total label="Helpers" value={n(r.totals!.helpers_placed)} sub={`of ${n(r.totals!.helpers)} have a location`} icon={<Wrench size={14} />} tone="help" />
          </div>

          <div className="rg-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a state or city" aria-label="Search a state or city" />
            {q && <button onClick={() => setQ("")}>Clear</button>}
          </div>

          {real.length === 0 && other.length === 0 && <p className="rg-empty">No state or city matches “{q}”.</p>}
          {real.map((s) => <StateBlock key={s.name} s={s} searching={!!query} />)}

          {other.length > 0 && (
            <section className="rg-other">
              <h2>Not placed on a state</h2>
              <p>Users whose saved location has no state, a state that could not be recognised, or a place outside India.</p>
              <div className="rg-other-grid">
                {other.map((s) => (
                  <div key={s.name} className="rg-other-card">
                    <b>{s.name}</b>
                    <Counts c={s} />
                    {s.name !== "Location not set" && s.cities.length > 0 && (
                      <small>{s.cities.slice(0, 4).map((c) => c.name).join(", ")}{s.cities.length > 4 ? ` +${s.cities.length - 4} more` : ""}</small>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Total({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: "cust" | "help" }) {
  return (
    <div className={`rg-total ${tone ?? ""}`}>
      <span>{icon}{label}</span>
      <b className="tabular">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Counts({ c }: { c: RegionCounts }) {
  return (
    <div className="rg-counts">
      <span className="help" title={`${c.new_helpers} joined this month`}><Wrench size={13} /><b className="tabular">{n(c.helpers)}</b> {c.helpers === 1 ? "helper" : "helpers"}</span>
      <span className="cust" title={`${c.new_customers} joined this month`}><Users size={13} /><b className="tabular">{n(c.customers)}</b> {c.customers === 1 ? "customer" : "customers"}</span>
    </div>
  );
}

function StateBlock({ s, searching }: { s: RegionState; searching: boolean }) {
  const [all, setAll] = useState(false);
  const cities = s.cities.filter((c) => c.name !== "City not set");
  const unset = s.cities.find((c) => c.name === "City not set");
  const shown = all || searching ? cities : cities.slice(0, CITY_PREVIEW);
  return (
    <section className="rg-state">
      <div className="rg-state-bar">
        <div className="rg-state-name">
          <MapPin size={16} />
          <h2>{s.name}</h2>
          <span className="rg-chip">{n(s.city_count)} {s.city_count === 1 ? "city" : "cities"}</span>
        </div>
        <div className="rg-state-counts">
          <div className="help"><b className="tabular">{n(s.helpers)}</b><span>{s.helpers === 1 ? "helper" : "helpers"}</span></div>
          <div className="cust"><b className="tabular">{n(s.customers)}</b><span>{s.customers === 1 ? "customer" : "customers"}</span></div>
        </div>
      </div>
      <div className="rg-cities">
        <AnimatePresence initial={false}>
          {shown.map((c) => (
            <motion.div key={c.name} className="rg-city" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <b title={c.name}>{c.name}</b>
              <Counts c={c} />
              {c.customers > 0 && c.helpers === 0 && <em className="rg-gap">No helper here yet</em>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {(cities.length > CITY_PREVIEW && !searching) || unset ? (
        <div className="rg-state-foot">
          {cities.length > CITY_PREVIEW && !searching && (
            <button className="rg-more" onClick={() => setAll(!all)}>
              <ChevronDown size={14} style={{ transform: all ? "rotate(180deg)" : undefined }} />
              {all ? "Show fewer cities" : `Show all ${n(cities.length)} cities`}
            </button>
          )}
          {unset && (
            <span className="rg-unset">
              City not set: {n(unset.helpers)} {unset.helpers === 1 ? "helper" : "helpers"} · {n(unset.customers)} {unset.customers === 1 ? "customer" : "customers"}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
