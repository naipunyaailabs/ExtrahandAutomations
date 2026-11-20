import { motion } from "framer-motion";
import { Pencil, Plus, Scale, Search, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Empty, ErrorNote, SkeletonPage, useToastAction } from "../components/ui";
import { fmtMoney, fmtRelative } from "../format";
import { usePoll, useUrlState } from "../hooks";
import type { CompetitorPriceItem, PricePosition, PricingRow } from "../types";

type Show = "all" | "compared" | "cheaper" | "same" | "costlier" | "missing";

const POSITION: Record<PricePosition, { label: string; tone: string }> = {
  cheaper: { label: "We are cheaper", tone: "success" },
  same: { label: "Same price", tone: "info" },
  costlier: { label: "We are costlier", tone: "danger" },
  no_competitor: { label: "No competitor price", tone: "neutral" },
  not_offered: { label: "We don't offer", tone: "warn" },
};

interface FormState { id: number | null; service: string; competitor: string; price: string; notes: string }
const EMPTY: FormState = { id: null, service: "", competitor: "", price: "", notes: "" };

export default function PricingPage() {
  const { data, error, refresh } = usePoll(() => api.pricing.comparison(), 60000);
  const [show, setShow] = useUrlState<Show>("show", "all");
  const [q, setQ] = useUrlState<string>("q", "");
  const [form, setForm] = useState<FormState | null>(null);
  const action = useToastAction();
  const [formError, setFormError] = useState<string | null>(null);

  const rows = data?.services ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const ok = show === "all" ? true
        : show === "compared" ? r.gap_pct != null
        : show === "missing" ? r.position === "no_competitor"
        : r.position === show;
      const text = `${r.service} ${r.category} ${r.competitors.map((c) => c.competitor).join(" ")}`.toLowerCase();
      return ok && (!needle || text.includes(needle));
    });
  }, [rows, show, q]);

  if (!data) return error ? <div className="page"><ErrorNote error={error} /></div> : <SkeletonPage />;
  const s = data.summary;

  const openForm = (row?: PricingRow, item?: CompetitorPriceItem) =>
    setForm(item
      ? { id: item.id, service: item.service, competitor: item.competitor, price: String(item.price), notes: item.notes ?? "" }
      : { ...EMPTY, service: row?.service ?? "" });

  const save = () => {
    if (!form) return;
    const price = Number(form.price);
    if (!form.service.trim() || !form.competitor.trim() || !(price > 0)) {
      setFormError("Enter the service, the competitor and a price above 0.");
      return;
    }
    setFormError(null);
    const body = { service: form.service, competitor: form.competitor, price, notes: form.notes || null };
    action.run(async () => {
      if (form.id) await api.pricing.updateCompetitorPrice(form.id, body);
      else await api.pricing.saveCompetitorPrice(body);
      setForm(null);
      await refresh();
    }, form.id ? "Competitor price updated" : "Competitor price saved");
  };

  const remove = (item: CompetitorPriceItem) => {
    if (!window.confirm(`Remove ${item.competitor}'s price for "${item.service}"?`)) return;
    action.run(async () => { await api.pricing.removeCompetitorPrice(item.id); await refresh(); }, "Competitor price removed");
  };

  const CHIPS: { key: Show; label: string; count: number }[] = [
    { key: "all", label: "All services", count: rows.length },
    { key: "compared", label: "Compared", count: s.compared },
    { key: "cheaper", label: "We are cheaper", count: s.cheaper },
    { key: "same", label: "Same price", count: s.same },
    { key: "costlier", label: "We are costlier", count: s.costlier },
    { key: "missing", label: "No competitor price", count: rows.filter((r) => r.position === "no_competitor").length },
  ];

  return (
    <Stagger className="page pr-page">
      <motion.div variants={itemVariants} className="pr-head">
        <div>
          <h1><Scale size={22} /> Our Prices vs Competitors</h1>
          <p className="muted">
            Our prices come live from ExtraHand bookings (latest price per service). Competitor prices are the ones your team adds here.
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => openForm()}>Add competitor price</Button>
      </motion.div>

      <motion.div variants={itemVariants} className="pr-kpis">
        <div className="pr-kpi"><span>Services priced</span><b>{s.services}</b><small>from live bookings</small></div>
        <div className="pr-kpi"><span>Compared</span><b>{s.compared}</b><small>{s.competitors.length} competitor{s.competitors.length === 1 ? "" : "s"}</small></div>
        <div className="pr-kpi tone-success"><span>We are cheaper</span><b>{s.cheaper}</b><small>than the cheapest rival</small></div>
        <div className="pr-kpi tone-info"><span>Same price</span><b>{s.same}</b><small>within ±2%</small></div>
        <div className="pr-kpi tone-danger"><span>We are costlier</span><b>{s.costlier}</b><small>needs a look</small></div>
        <div className={`pr-kpi ${s.avg_gap_pct == null ? "" : s.avg_gap_pct > 0 ? "tone-danger" : "tone-success"}`}>
          <span>Average gap</span>
          <b>{s.avg_gap_pct == null ? "—" : `${s.avg_gap_pct > 0 ? "+" : ""}${s.avg_gap_pct}%`}</b>
          <small>{s.avg_gap_pct == null ? "add competitor prices" : s.avg_gap_pct > 0 ? "above competitors" : "below competitors"}</small>
        </div>
      </motion.div>

      {form && (
        <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="card pr-form">
          <header className="pr-form-head">
            <h3>{form.id ? "Edit competitor price" : "Add competitor price"}</h3>
            <button type="button" className="pr-icon-btn" onClick={() => setForm(null)} aria-label="Close"><X size={16} /></button>
          </header>
          <div className="pr-form-grid">
            <label>
              <span>Service</span>
              <input list="pr-services" value={form.service} placeholder="e.g. AC Repair"
                onChange={(e) => setForm({ ...form, service: e.target.value })} />
            </label>
            <label>
              <span>Competitor</span>
              <input list="pr-competitors" value={form.competitor} placeholder="e.g. Urban Company"
                onChange={(e) => setForm({ ...form, competitor: e.target.value })} />
            </label>
            <label>
              <span>Their price (₹)</span>
              <input type="number" min="1" step="1" value={form.price} placeholder="0"
                onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </label>
            <label className="pr-notes">
              <span>Notes (optional)</span>
              <input value={form.notes} placeholder="e.g. price seen on their app, includes visit charge"
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <datalist id="pr-services">{rows.filter((r) => r.our_price != null).map((r) => <option key={r.service} value={r.service} />)}</datalist>
          <datalist id="pr-competitors">{s.competitors.map((c) => <option key={c} value={c} />)}</datalist>
          {formError && <ErrorNote error={formError} />}
          <div className="pr-form-actions">
            <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" loading={action.busy} onClick={save}>{form.id ? "Save changes" : "Save price"}</Button>
          </div>
        </motion.section>
      )}

      <motion.section variants={itemVariants} className="card pr-table-card">
        <div className="td-toolbar">
          <div className="td-chips">
            {CHIPS.map((c) => (
              <button key={c.key} type="button" className={`td-chip ${show === c.key ? "active" : ""}`} onClick={() => setShow(c.key)}>
                {c.label} <span>{c.count}</span>
              </button>
            ))}
          </div>
          <label className="td-search">
            <Search size={14} />
            <input placeholder="Search service or competitor…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {shown.length === 0 ? (
          <Empty icon={Scale}>
            {rows.length === 0 ? "No priced bookings yet." : "No services match this filter."}
          </Empty>
        ) : (
          <div className="pr-table">
            <div className="pr-row pr-row-head">
              <span>Service</span><span>Our price</span><span>Cheapest competitor</span><span>Difference</span><span>All competitor prices</span>
            </div>
            {shown.map((r) => {
              const pos = POSITION[r.position];
              return (
                <div key={r.service} className={`pr-row pos-${r.position}`}>
                  <span className="pr-service">
                    <b>{r.service}</b>
                    <small className="muted">
                      {r.category || "—"}{r.works ? ` · ${r.works} booking${r.works === 1 ? "" : "s"}` : ""}
                      {r.last_booked_at ? ` · last ${fmtRelative(r.last_booked_at)}` : ""}
                    </small>
                  </span>
                  <span className="pr-ours">
                    {r.our_price != null ? (
                      <>
                        <b>{fmtMoney(r.our_price)}</b>
                        {r.min_price != null && r.max_price != null && r.min_price !== r.max_price && (
                          <small className="muted">{fmtMoney(r.min_price)} – {fmtMoney(r.max_price)}</small>
                        )}
                      </>
                    ) : <span className="muted">Not offered</span>}
                  </span>
                  <span className="pr-cheapest">
                    {r.cheapest_price != null ? (
                      <><b>{fmtMoney(r.cheapest_price)}</b><small className="muted">{r.cheapest_competitor}</small></>
                    ) : <span className="muted">—</span>}
                  </span>
                  <span className="pr-gap">
                    <span className={`pill tone-${pos.tone}`}>
                      {r.position === "cheaper" ? <TrendingDown size={12} /> : r.position === "costlier" ? <TrendingUp size={12} /> : <span className="pill-dot" />}
                      {r.gap_pct != null && r.position !== "same" ? `${r.gap_pct > 0 ? "+" : ""}${r.gap_pct}%` : pos.label}
                    </span>
                    {r.gap != null && r.position !== "same" && (
                      <small className="muted">{r.gap > 0 ? `${fmtMoney(r.gap)} more` : `${fmtMoney(-r.gap)} less`}</small>
                    )}
                  </span>
                  <span className="pr-rivals">
                    {r.competitors.map((c) => (
                      <span key={c.id} className="pr-rival" title={c.notes ? `${c.notes} · updated ${fmtRelative(c.updated_at)}` : `Updated ${fmtRelative(c.updated_at)}`}>
                        {c.competitor} <b>{fmtMoney(c.price)}</b>
                        <button type="button" onClick={() => openForm(r, c)} aria-label={`Edit ${c.competitor}`}><Pencil size={11} /></button>
                        <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c.competitor}`}><Trash2 size={11} /></button>
                      </span>
                    ))}
                    <button type="button" className="pr-add" onClick={() => openForm(r)}><Plus size={12} /> Add</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </motion.section>
    </Stagger>
  );
}
