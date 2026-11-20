import { motion } from "framer-motion";
import {
  Braces,
  CircleAlert,
  ExternalLink,
  FileText,
  History,
  IndianRupee,
  MapPin,
  Pencil,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Star,
  Store,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Card, Empty, Pill, SkeletonRows, Toggle, useToastAction, type Tone } from "../components/ui";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import { usePoll } from "../hooks";
import type {
  PriceRecommendationDetail,
  PricingArea,
  PricingCompetitor,
  PricingService,
  PricingStatus,
  PricingStrategy,
} from "../types";

export type PricingSection = "prices" | "analysis" | "runs" | "setup" | "api";

/** Only http(s) addresses become links, so a stored address like javascript:… cannot run when clicked. */
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

const place = (city: string, area: string) => (area ? `${area}, ${city}` : `${city} (whole city)`);

const CONFIDENCE_TONE: Record<string, Tone> = { high: "success", medium: "warn", low: "neutral" };
const DEMAND_TONE: Record<string, Tone> = { high: "success", normal: "info", low: "warn", unknown: "neutral" };
const RIVAL_TONE: Record<string, Tone> = { strong: "danger", neutral: "info", weak: "success", unknown: "neutral" };
const RIVAL_LABEL: Record<string, string> = { strong: "Well rated", neutral: "Average", weak: "Poorly rated", unknown: "Not enough reviews" };

export default function PricingPage({ section }: { section: PricingSection }) {
  return (
    <Stagger className="page">
      {section === "prices" && <PricesSection />}
      {section === "analysis" && <AnalysisSection />}
      {section === "runs" && <RunsSection />}
      {section === "setup" && <SetupSection />}
      {section === "api" && <ApiSection />}
    </Stagger>
  );
}

function Head({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <motion.div className="page-head row" variants={itemVariants}>
      <div>
        <h1>{title}</h1>
        <p className="muted">{children}</p>
      </div>
      {actions}
    </motion.div>
  );
}

/** Run state, what the agent is using, and the Run now button. */
function RunBar({ status, onStarted }: { status: PricingStatus | null; onStarted: () => void }) {
  const action = useToastAction();
  if (!status) return <SkeletonRows rows={1} />;
  const run = status.running;
  const pct = run && run.total_steps ? Math.round((run.done_steps / run.total_steps) * 100) : 0;
  const listEmpty = !status.counts.areas || !status.counts.services;
  const start = () => action.run(async () => { await api.pricing.runNow(); onStarted(); }, "Pricing run started");

  return (
    <Card flat>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: 6, minWidth: 0, flex: 1 }}>
          {run ? (
            <>
              <div><Pill value="running" label={`Running · ${pct}%`} /> <span className="small muted">{run.message}</span></div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--border)", overflow: "hidden", maxWidth: 520 }}>
                <motion.div style={{ height: "100%", background: "var(--ws-accent, #ea580c)" }} animate={{ width: `${pct}%` }} />
              </div>
            </>
          ) : status.last_run ? (
            <div className="small">
              Last run {fmtRelative(status.last_run.finished_at ?? status.last_run.started_at)}{" "}
              <Pill value={status.last_run.status === "done" ? "done" : "failed"} label={status.last_run.status} />{" "}
              <span className="muted">{status.last_run.error ?? status.last_run.message}</span>
              {status.next_run_due && status.scheduler_enabled && (
                <span className="muted"> · next automatic run {fmtRelative(status.next_run_due)}</span>
              )}
            </div>
          ) : (
            <div className="small muted">The agent has not run yet.</div>
          )}
          <div className="small muted">
            Search: <b>{status.search_engine === "searxng" ? "SearXNG" : "DuckDuckGo"}</b> · Pages: <b>{status.page_reader === "crawl4ai" ? "Crawl4AI" : "plain HTTP"}</b> ·
            Ratings: <b>{status.maps_enabled ? "Google Maps scraper" : "web reviews"}</b>
          </div>
          {!status.llm_configured && (
            <div className="small error-inline"><CircleAlert size={13} /> OPENROUTER_API_KEY is not set in backend/.env, so the agent cannot read prices.</div>
          )}
          {listEmpty && (
            <div className="small muted">Add at least one area and one service in <Link to="/pricing/setup">Setup</Link> first.</div>
          )}
        </div>
        <Button variant="primary" icon={Play} loading={action.busy} disabled={!!run || listEmpty || !status.llm_configured} onClick={start}>
          {run ? "Running…" : "Run now"}
        </Button>
      </div>
    </Card>
  );
}

// ---- Recommended prices -------------------------------------------------------------------------

function PricesSection() {
  const status = usePoll(api.pricing.status, 4000);
  const recs = usePoll(api.pricing.recommendations, 15000);
  const [placeFilter, setPlaceFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const lastDone = status.data?.last_run?.id;
  useEffect(() => { recs.refresh(); }, [lastDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = recs.data ?? [];
  const places = [...new Set(rows.map((r) => place(r.city, r.area)))];
  const services = [...new Set(rows.map((r) => r.service_name))];
  const shown = rows.filter((r) => (!placeFilter || place(r.city, r.area) === placeFilter) && (!serviceFilter || r.service_name === serviceFilter));

  return (
    <>
      <Head title="Recommended prices">
        For each area and service on your list, the agent finds what competitors charge, checks local ExtraHand demand and how
        customers rate those competitors, and sets one price. The ExtraHand app reads these through the <Link to="/pricing/api">App API</Link>.
      </Head>
      <RunBar status={status.data} onStarted={status.refresh} />

      <Card
        title="Prices"
        icon={IndianRupee}
        flat
        actions={rows.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} aria-label="Filter by area">
              <option value="">All areas</option>
              {places.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} aria-label="Filter by service">
              <option value="">All services</option>
              {services.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        )}
      >
        {!recs.data ? <SkeletonRows /> : shown.length ? (
          <div className="table-wrap inner">
            <table className="table responsive">
              <thead>
                <tr><th>Area</th><th>Service</th><th>Our price</th><th>Market</th><th>Competitors priced</th><th>Demand</th><th>Reputation</th><th>Confidence</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r.id)} style={{ cursor: "pointer", background: selected === r.id ? "var(--hover)" : undefined }}>
                    <td data-label="Area">{place(r.city, r.area)}</td>
                    <td data-label="Service">{r.service_name}<div className="small muted">{r.unit}</div></td>
                    <td data-label="Our price">
                      {r.status === "priced" ? <b style={{ fontSize: 15 }}>{fmtMoney(r.price)}</b> : <span className="muted">No data</span>}
                      {r.basis === "city" && r.status === "priced" && <div className="small muted">from city prices</div>}
                    </td>
                    <td data-label="Market" className="nowrap">
                      {r.market_low != null ? <>{fmtMoney(r.market_low)}–{fmtMoney(r.market_high)}<div className="small muted">median {fmtMoney(r.market_median)}</div></> : "—"}
                    </td>
                    <td data-label="Competitors priced" className="tabular">{r.price_count}</td>
                    <td data-label="Demand"><Pill value={r.demand_level} tone={DEMAND_TONE[r.demand_level]} label={r.demand_level === "unknown" ? "Not enough tasks" : `${r.demand_level} · ${r.demand_tasks} tasks`} /></td>
                    <td data-label="Reputation">
                      <Pill value={r.sentiment_level} tone={RIVAL_TONE[r.sentiment_level]} label={RIVAL_LABEL[r.sentiment_level]} />
                      {r.competitor_rating != null && <div className="small muted">avg {r.competitor_rating}★</div>}
                    </td>
                    <td data-label="Confidence"><Pill value={r.confidence} tone={CONFIDENCE_TONE[r.confidence]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={IndianRupee}>No prices yet. Add areas, services and competitors in <Link to="/pricing/setup">Setup</Link>, then press Run now.</Empty>}
      </Card>

      {selected != null && <PriceDetail id={selected} key={selected} />}
    </>
  );
}

function PriceDetail({ id }: { id: number }) {
  const [d, setD] = useState<PriceRecommendationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.pricing.recommendation(id).then(setD, (e: Error) => setError(e.message)); }, [id]);
  if (error) return <Card><div className="error-note">{error}</div></Card>;
  if (!d) return <Card><SkeletonRows rows={3} /></Card>;

  return (
    <Card title={`${d.service_name} in ${place(d.city, d.area)}`} icon={IndianRupee}>
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
          <div><div className="small muted">Recommended</div><div style={{ fontSize: 28, fontWeight: 800 }}>{d.status === "priced" ? fmtMoney(d.price) : "—"}</div></div>
          <div><div className="small muted">Market range</div><div>{fmtMoney(d.market_low)}–{fmtMoney(d.market_high)}</div></div>
          <div><div className="small muted">Updated</div><div>{fmtDateTime(d.updated_at)}</div></div>
        </div>
        <p style={{ margin: 0 }}>{d.reasoning}</p>
        {d.adjustments.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {d.adjustments.map((a, i) => <li key={i}>{a.reason}{a.pct ? ` (${a.pct > 0 ? "+" : ""}${a.pct}%)` : ""}</li>)}
          </ul>
        )}

        <div>
          <h4 style={{ margin: "4px 0 8px" }}>Competitor prices it is based on</h4>
          {d.evidence.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Competitor</th><th>Price</th><th>What the page says</th><th>Source</th></tr></thead>
                <tbody>
                  {d.evidence.map((e, i) => (
                    <tr key={i}>
                      <td>{e.competitor}{!e.listed && <div className="small muted">not on your list</div>}</td>
                      <td className="nowrap">{fmtMoney(e.price_min)}{e.price_max ? `–${fmtMoney(e.price_max)}` : ""}{e.unit && <div className="small muted">{e.unit}</div>}</td>
                      <td className="small">“{e.evidence}”</td>
                      <td>
                        {safeUrl(e.source_url)
                          ? <a href={safeUrl(e.source_url)} target="_blank" rel="noreferrer" className="small">{e.source_title || hostOf(e.source_url)} <ExternalLink size={11} /></a>
                          : <span className="small muted">{e.source_title || hostOf(e.source_url)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="small muted">None found.</div>}
        </div>

        {d.ratings.length > 0 && (
          <div>
            <h4 style={{ margin: "4px 0 8px" }}>How customers rate competitors here</h4>
            <div style={{ display: "grid", gap: 8 }}>
              {d.ratings.map((r) => (
                <div key={r.competitor} className="small">
                  <b>{r.competitor}</b>{" "}
                  {r.rating != null && <span><Star size={11} /> {r.rating}{r.review_count ? ` from ${r.review_count.toLocaleString("en-IN")} reviews` : ""}</span>}
                  <span className="muted"> · {r.source === "google_maps" ? "Google Maps" : "web reviews"}</span>
                  {r.summary && <div className="muted">{r.summary}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---- Competitive analysis -----------------------------------------------------------------------

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

/** Headings, bullets, bold and paragraphs: all the analysis uses. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`} style={{ margin: "4px 0 10px", paddingLeft: 18 }}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) { bullets.push(line.slice(2)); continue; }
    flush();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    out.push(h ? <h4 key={out.length} style={{ margin: "12px 0 4px" }}>{inline(h[1])}</h4> : <p key={out.length} style={{ margin: "4px 0" }}>{inline(line)}</p>);
  }
  flush();
  return <div>{out}</div>;
}

function AnalysisSection() {
  const reports = usePoll(api.pricing.reports, 30000);
  return (
    <>
      <Head title="Competitive analysis">How ExtraHand's prices compare with competitors in each area, written from the latest run's data.</Head>
      {!reports.data ? <Card><SkeletonRows /></Card> : reports.data.length ? reports.data.map((r) => (
        <Card key={r.id} title={place(r.city, r.area)} icon={MapPin} actions={<span className="small muted">{fmtDateTime(r.updated_at)}</span>}>
          <Markdown text={r.summary} />
        </Card>
      )) : <Card><Empty icon={FileText}>No analysis yet. It is written at the end of each run.</Empty></Card>}
    </>
  );
}

// ---- Runs ---------------------------------------------------------------------------------------

function RunsSection() {
  const status = usePoll(api.pricing.status, 4000);
  const runs = usePoll(api.pricing.runs, 4000);
  return (
    <>
      <Head title="Agent runs">Each run researches every area and service on the list. Prices switch over only when a run finishes.</Head>
      <RunBar status={status.data} onStarted={() => { status.refresh(); runs.refresh(); }} />
      <Card title="History" icon={History} flat>
        {!runs.data ? <SkeletonRows /> : runs.data.length ? (
          <div className="table-wrap inner">
            <table className="table responsive">
              <thead><tr><th>#</th><th>Started</th><th>Trigger</th><th>Status</th><th>Progress</th><th>Result</th></tr></thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <td data-label="#">{r.id}</td>
                    <td data-label="Started" className="nowrap">{fmtDateTime(r.started_at)}</td>
                    <td data-label="Trigger">{r.trigger === "schedule" ? "Automatic" : "Manual"}</td>
                    <td data-label="Status"><Pill value={r.status} /></td>
                    <td data-label="Progress" className="tabular">{r.done_steps}/{r.total_steps}</td>
                    <td data-label="Result" className="small">{r.error ? <span className="error-inline">{r.error}</span> : r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={History}>No runs yet.</Empty>}
      </Card>
    </>
  );
}

// ---- Setup --------------------------------------------------------------------------------------

function SetupSection() {
  return (
    <>
      <Head title="Areas, services & competitors">
        The agent works only on what is listed here. Turn an item off to skip it without deleting it.
      </Head>
      <StrategyCard />
      <AreasCard />
      <ServicesCard />
      <CompetitorsCard />
    </>
  );
}

function NumberField({ label, value, onChange, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; suffix: string; hint: string }) {
  return (
    <label style={{ display: "grid", gap: 4, alignContent: "start" }}>
      <span className="small" style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="number" className="input-sm" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="small muted">{suffix}</span>
      </span>
      <span className="small muted">{hint}</span>
    </label>
  );
}

function StrategyCard() {
  const [form, setForm] = useState<PricingStrategy | null>(null);
  const action = useToastAction();
  useEffect(() => { api.pricing.strategy().then(setForm).catch(() => {}); }, []);
  if (!form) return <Card><SkeletonRows rows={2} /></Card>;
  const set = (k: keyof PricingStrategy) => (v: number) => setForm({ ...form, [k]: v });
  const save = () => action.run(async () => setForm(await api.pricing.saveStrategy(form)), "Pricing rule saved");

  return (
    <Card title="How the price is set" icon={SlidersHorizontal} actions={<Button variant="primary" size="sm" icon={Save} loading={action.busy} onClick={save}>Save</Button>}>
      <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Price = competitor median × (1 + position ± demand ± competitor ratings), rounded to a ₹…49 / ₹…99 price.
        Demand compares this area's ExtraHand tasks with the other listed areas.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
        <NumberField label="Position vs competitors" value={form.position_pct} onChange={set("position_pct")} suffix="%" hint="-5 = 5% below the median" />
        <NumberField label="Demand adjustment" value={form.demand_adjust_pct} onChange={set("demand_adjust_pct")} suffix="± %" hint="Up when demand is high, down when low" />
        <NumberField label="Ratings adjustment" value={form.sentiment_adjust_pct} onChange={set("sentiment_adjust_pct")} suffix="± %" hint="Up when competitors are poorly rated" />
        <NumberField label="Demand window" value={form.demand_window_days} onChange={set("demand_window_days")} suffix="days" hint="Which recent tasks count" />
        <NumberField label="Run automatically every" value={form.refresh_days} onChange={set("refresh_days")} suffix="days" hint="Prices are refreshed this often" />
      </div>
    </Card>
  );
}

/** Two clicks to delete, without a browser dialog. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return (
    <Button variant={armed ? "danger" : "ghost"} size="sm" icon={Trash2} onClick={() => (armed ? onDelete() : setArmed(true))}>
      {armed ? "Confirm" : ""}
    </Button>
  );
}

function useList<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const reload = () => load().then(setItems).catch(() => setItems([]));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, reload };
}

const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" } as const;
const wideFormGrid = { ...formGrid, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" } as const;

function AreasCard() {
  const { items, reload } = useList(api.pricing.areas);
  const blank = { city: "", area: "", pincode: "" };
  const [form, setForm] = useState(blank);
  const action = useToastAction();
  const add = () => action.run(async () => {
    await api.pricing.addArea({ city: form.city, area: form.area, pincode: form.pincode || null, active: true });
    setForm(blank);
    reload();
  }, "Area added");
  const toggle = (a: PricingArea) => action.run(async () => { await api.pricing.saveArea(a.id, { ...a, active: !a.active }); reload(); });
  const remove = (a: PricingArea) => action.run(async () => { await api.pricing.removeArea(a.id); reload(); }, "Area removed");

  return (
    <Card title="Areas" icon={MapPin}>
      <div style={formGrid}>
        <input placeholder="City (e.g. Hyderabad)" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input placeholder="Area (empty = whole city)" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        <input placeholder="Pin code (optional)" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
        <Button variant="primary" icon={Plus} disabled={!form.city.trim()} loading={action.busy} onClick={add}>Add area</Button>
      </div>
      <ListRows
        items={items}
        empty="No areas yet."
        render={(a: PricingArea) => (
          <>
            <div style={{ flex: 1 }}>{place(a.city, a.area)}{a.pincode && <span className="small muted"> · {a.pincode}</span>}</div>
            <Toggle checked={a.active} onChange={() => toggle(a)} />
            <DeleteButton onDelete={() => remove(a)} />
          </>
        )}
      />
    </Card>
  );
}

function ServicesCard() {
  const { items, reload } = useList(api.pricing.services);
  const blank = { name: "", scope: "", unit: "per job", keywords: "", min_price: "", max_price: "" };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const action = useToastAction();
  const payload = (active = true) => ({
    name: form.name, scope: form.scope, unit: form.unit || "per job", active,
    keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    min_price: form.min_price ? Number(form.min_price) : null,
    max_price: form.max_price ? Number(form.max_price) : null,
  });
  const submit = () => action.run(async () => {
    if (editing != null) await api.pricing.saveService(editing, payload(items?.find((s) => s.id === editing)?.active ?? true));
    else await api.pricing.addService(payload());
    setForm(blank);
    setEditing(null);
    reload();
  }, editing != null ? "Service saved" : "Service added");
  const edit = (s: PricingService) => {
    setEditing(s.id);
    setForm({ name: s.name, scope: s.scope, unit: s.unit, keywords: s.keywords.join(", "),
      min_price: s.min_price?.toString() ?? "", max_price: s.max_price?.toString() ?? "" });
  };
  const toggle = (s: PricingService) => action.run(async () => { await api.pricing.saveService(s.id, { ...s, active: !s.active }); reload(); });
  const remove = (s: PricingService) => action.run(async () => { await api.pricing.removeService(s.id); reload(); }, "Service removed");

  return (
    <Card title="Services" icon={Wrench}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Describe exactly what the price covers, so competitor prices are compared like for like
        (e.g. "Deep cleaning of a 2BHK flat", charged "per visit"). Keywords match ExtraHand tasks for demand.
      </p>
      <div style={wideFormGrid}>
        <input placeholder="Service (e.g. House Cleaning)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="What the price covers" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
        <input placeholder="Charged (per job / per hour…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input placeholder="Task keywords, comma separated" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        <input type="number" placeholder="Min ₹ (optional)" value={form.min_price} onChange={(e) => setForm({ ...form, min_price: e.target.value })} />
        <input type="number" placeholder="Max ₹ (optional)" value={form.max_price} onChange={(e) => setForm({ ...form, max_price: e.target.value })} />
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="primary" icon={editing != null ? Save : Plus} disabled={!form.name.trim()} loading={action.busy} onClick={submit}>
            {editing != null ? "Save" : "Add service"}
          </Button>
          {editing != null && <Button variant="ghost" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</Button>}
        </div>
      </div>
      <ListRows
        items={items}
        empty="No services yet."
        render={(s: PricingService) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{s.name}</b> <span className="small muted mono">{s.slug}</span>
              <div className="small muted">
                {s.scope || "No scope set"} · {s.unit}
                {(s.min_price || s.max_price) && <> · {fmtMoney(s.min_price)}–{fmtMoney(s.max_price)}</>}
                {s.keywords.length > 0 && <> · tasks matching “{s.keywords.join("”, “")}”</>}
              </div>
            </div>
            <Toggle checked={s.active} onChange={() => toggle(s)} />
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => edit(s)} />
            <DeleteButton onDelete={() => remove(s)} />
          </>
        )}
      />
    </Card>
  );
}

function CompetitorsCard() {
  const { items, reload } = useList(api.pricing.competitors);
  const blank = { name: "", website: "", notes: "" };
  const [form, setForm] = useState(blank);
  const action = useToastAction();
  const add = () => action.run(async () => {
    await api.pricing.addCompetitor({ name: form.name, website: form.website || null, notes: form.notes || null, active: true });
    setForm(blank);
    reload();
  }, "Competitor added");
  const toggle = (c: PricingCompetitor) => action.run(async () => { await api.pricing.saveCompetitor(c.id, { ...c, active: !c.active }); reload(); });
  const remove = (c: PricingCompetitor) => action.run(async () => { await api.pricing.removeCompetitor(c.id); reload(); }, "Competitor removed");

  return (
    <Card title="Competitors" icon={Store}>
      <p className="small muted" style={{ marginTop: 0 }}>
        The agent searches for these by name in every area. Local providers it finds on the way are counted in the market price too,
        and marked "not on your list". A website helps it find the competitor's own price pages.
      </p>
      <div style={formGrid}>
        <input placeholder="Name (e.g. Urban Company)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Website (optional)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        <input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <Button variant="primary" icon={Plus} disabled={!form.name.trim()} loading={action.busy} onClick={add}>Add competitor</Button>
      </div>
      <ListRows
        items={items}
        empty="No competitors yet."
        render={(c: PricingCompetitor) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{c.name}</b>
              {c.website && (safeUrl(c.website)
                ? <> <a className="small" href={safeUrl(c.website)} target="_blank" rel="noreferrer">{c.website}</a></>
                : <> <span className="small muted">{c.website}</span></>)}
              {c.notes && <div className="small muted">{c.notes}</div>}
            </div>
            <Toggle checked={c.active} onChange={() => toggle(c)} />
            <DeleteButton onDelete={() => remove(c)} />
          </>
        )}
      />
    </Card>
  );
}

function ListRows<T extends { id: number; active: boolean }>({ items, empty, render }: { items: T[] | null; empty: string; render: (item: T) => ReactNode }) {
  if (!items) return <SkeletonRows rows={2} />;
  if (!items.length) return <div className="small muted" style={{ marginTop: 12 }}>{empty}</div>;
  return (
    <div style={{ display: "grid", marginTop: 12 }}>
      {items.map((it) => (
        <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", opacity: it.active ? 1 : 0.55 }}>
          {render(it)}
        </div>
      ))}
    </div>
  );
}

// ---- App API ------------------------------------------------------------------------------------

function ApiSection() {
  const status = usePoll(api.pricing.status, 30000);
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const [q, setQ] = useState({ service: "house-cleaning", city: "Hyderabad", area: "", key: "" });
  const [result, setResult] = useState<string>("");
  const action = useToastAction();
  const query = useMemo(() => new URLSearchParams({ service: q.service, city: q.city, ...(q.area ? { area: q.area } : {}) }).toString(), [q]);
  const tryIt = () => action.run(async () => {
    const res = await fetch(`/api/pricing/v1/price?${query}`, { headers: q.key ? { "X-API-Key": q.key } : undefined });
    setResult(`${res.status} ${res.statusText}\n${JSON.stringify(await res.json().catch(() => null), null, 2)}`);
  });

  return (
    <>
      <Head title="App API">For the ExtraHand app team: read the current price for a service in a city or area.</Head>
      {status.data && !status.data.public_api_protected && (
        <Card flat><div className="small error-inline"><CircleAlert size={13} /> PRICING_API_KEY is not set in backend/.env, so anyone who can reach the server can read prices. Set it before going live.</div></Card>
      )}
      <Card title="GET /api/pricing/v1/price" icon={Braces}>
        <div className="small" style={{ display: "grid", gap: 10 }}>
          <div>Send the key as an <span className="mono">X-API-Key</span> header. Parameters:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><span className="mono">service</span>: the service's id (e.g. <span className="mono">house-cleaning</span>, shown under Setup) or its name</li>
            <li><span className="mono">city</span>: e.g. Hyderabad</li>
            <li><span className="mono">area</span> (optional): e.g. Madhapur. An area without its own price gets the city's, with <span className="mono">"basis": "city"</span>.</li>
          </ul>
          <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", padding: 12, borderRadius: 8, background: "var(--hover)" }}>{`curl -H "X-API-Key: <key>" "${base}/api/pricing/v1/price?service=house-cleaning&city=Hyderabad&area=Madhapur"

{
  "service": "house-cleaning", "service_name": "House Cleaning",
  "city": "Hyderabad", "area": "Madhapur",
  "price": 1399, "currency": "INR", "unit": "per job",
  "market_low": 1399.0, "market_high": 1749.5,
  "confidence": "medium", "basis": "area",
  "updated_at": "2026-11-06T10:15:00Z"
}`}</pre>
          <div>
            404 when there is no price yet for that service and city. <span className="mono">GET /api/pricing/v1/prices?city=…&area=…</span> returns
            every priced service at once. Prices change only when a run finishes.
          </div>
        </div>
      </Card>
      <Card title="Try it" icon={Play}>
        <div style={formGrid}>
          <input placeholder="service" value={q.service} onChange={(e) => setQ({ ...q, service: e.target.value })} />
          <input placeholder="city" value={q.city} onChange={(e) => setQ({ ...q, city: e.target.value })} />
          <input placeholder="area (optional)" value={q.area} onChange={(e) => setQ({ ...q, area: e.target.value })} />
          <input placeholder="X-API-Key (if set)" value={q.key} onChange={(e) => setQ({ ...q, key: e.target.value })} />
          <Button variant="primary" icon={Play} loading={action.busy} onClick={tryIt}>Send</Button>
        </div>
        {result && <pre className="mono" style={{ marginBottom: 0, whiteSpace: "pre-wrap", padding: 12, borderRadius: 8, background: "var(--hover)" }}>{result}</pre>}
      </Card>
    </>
  );
}
