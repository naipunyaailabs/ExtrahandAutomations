import {
  Ban, BadgeCheck, ChevronDown, CircleCheck, CircleDashed, Download, IndianRupee, HelpCircle, Layers, List, Loader2, MapPin, MessageCircleHeart,
  MessageSquareWarning, Phone, RefreshCw, Repeat, Search, UserX, Wallet, Wrench, X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { CancelSide, CancelledWork, CancelledWorks, CancelledWorksSummary, WaCancelFollowupMessages, WaCancelFollowupRow } from "../types";
import { StatusTag } from "./CancellationShared";
import {
  Avatar, PeriodPills, Skeleton, fmtDate, fmtTime, istDay, n, presets, pretty, rupees, topOf, within, type Dated, type Range,
} from "./EngagementKit";
import "./cancellation.css";
import "./cancel-followup.css";

/** Cancellation Engagement → Cancelled Works: every cancelled real-customer Work in detail. Filters (who cancelled,
 * period, category, city, reason, refund, helper, search) live in the URL, so the Dashboard can link straight into
 * a filtered list. Refunded / Not refunded is the main split (cards on top, a By-refund view). A List, By-refund or
 * By-category view; each Work opens to its full details, including the follow-up message and the customer's answer. Download as CSV. Data: backend/user_engagement/cancellations.py (live from ExtraHand). */

const SIDES: { key: CancelSide | "all"; label: string }[] = [
  { key: "customer", label: "By customer" },
  { key: "team", label: "By ExtraHand team" },
  { key: "unknown", label: "Not recorded" },
  { key: "all", label: "All" },
];
const SIDE_LABEL: Record<CancelSide, string> = { customer: "Customer", team: "ExtraHand team", unknown: "Not recorded" };
const NO_REASON = "No reason given";
const PAGE = 50;
type Sort = "newest" | "oldest" | "amount";
type View = "list" | "refund" | "category";
type Refund = "all" | "yes" | "no";

interface Item extends CancelledWork, Dated { when: string }

const whenOf = (r: CancelledWork) => r.cancelled_at ?? r.booked_at ?? "";
const pretty_source = (s: string) => (s ? pretty(s.replace(/_/g, " ")) : "—");

export function CancellationWorksPage() {
  const [params, setParams] = useSearchParams();
  const data = usePoll<CancelledWorks>(api.engagement.cancellations, 30000);
  const msgs = usePoll<WaCancelFollowupMessages>(api.whatsapp.cancelFollowupMessages, 60000);
  const today = istDay(new Date().toISOString());
  const PRESETS = useMemo(() => presets(today), [today]);

  // filters from the URL
  const side = (params.get("side") as CancelSide | "all" | null) ?? "customer";
  const city = params.get("city");
  const reason = params.get("reason");
  const category = params.get("category");
  const refund = (params.get("refund") as Refund | null) ?? "all";
  const sort = (params.get("sort") as Sort | null) ?? "newest";
  const view = (params.get("view") as View | null) ?? "list";
  const q = params.get("q") ?? "";
  const from = params.get("from");
  const range: Range = from
    ? PRESETS.find((p) => p.from === from && p.to === params.get("to")) ?? { key: `custom:${from}`, label: params.get("label") ?? `From ${from}`, from, to: params.get("to") }
    : PRESETS[PRESETS.length - 1];
  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === "" || v === "all" && k !== "side") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const setRange = (r: Range) => set({ from: r.from, to: r.to, label: r.from ? r.label : null });

  const cardFilters = { side, from: range.from, to: range.to, city, category, reason, q: q.trim() || null };
  const cardsPoll = usePoll<CancelledWorksSummary>(() => api.engagement.cancellationsSummary(cardFilters), 30000,
    [side, range.from, range.to, city, category, reason, q]);
  const cards = cardsPoll.data;

  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [params]);
  const d = data.data;
  const ready = !!(d && !d.loading && d.rows);

  const all: Item[] = useMemo(
    () => (d?.rows ?? []).map((r) => ({
      ...r, city: r.city || "City not set", category: pretty(r.category), when: whenOf(r), day: whenOf(r) ? istDay(whenOf(r)) : null,
    })),
    [d],
  );
  const followups = useMemo(() => {
    const m = new Map<string, WaCancelFollowupRow>();
    for (const r of msgs.data?.rows ?? []) if (!r.is_test) m.set(r.task_id, r);
    return m;
  }, [msgs.data]);
  const timesBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) if (r.side === "customer") m.set(r.customer_key, (m.get(r.customer_key) ?? 0) + 1);
    return m;
  }, [all]);

  const query = q.trim().toLowerCase();
  const base = all.filter((r) => (side === "all" || r.side === side) && within(r.day, range.from, range.to));
  const passes = (r: Item, skip?: "category" | "city" | "reason" | "refund") =>
    (skip === "category" || !category || r.category === category) &&
    (skip === "city" || !city || r.city === city) &&
    (skip === "reason" || !reason || (r.reason ?? NO_REASON) === reason) &&
    (skip === "refund" || refund === "all" || (refund === "yes" ? r.refunded : !r.refunded)) &&
    (!query || [r.customer_name, r.customer_phone, r.title, r.category, r.city, r.area, r.reason ?? "", r.id, r.helper_name]
      .some((v) => v.toLowerCase().includes(query)));
  const list = base.filter((r) => passes(r)).sort((a, b) =>
    sort === "amount" ? b.amount - a.amount : sort === "oldest" ? a.when.localeCompare(b.when) : b.when.localeCompare(a.when));

  const options = (key: "category" | "city" | "reason") => {
    const m = new Map<string, number>();
    for (const r of base.filter((x) => passes(x, key))) {
      const k = key === "reason" ? r.reason ?? NO_REASON : r[key];
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const value = list.reduce((s, r) => s + r.amount, 0);
  const anyFilter = !!(city || reason || category || refund !== "all" || q || from);

  // the refund split: every other filter applies, the refund one does not
  const sum = (rs: Item[], f: (r: Item) => number) => rs.reduce((a, r) => a + f(r), 0);
  const REFUND_TITLE: Record<Refund, string> = { all: "All cancelled Works", yes: "Refunded", no: "Not refunded" };

  const download = () => {
    const head = ["Work ID", "Cancelled at", "Who cancelled", "Reason", "Customer", "Phone", "Work", "Category", "Area", "City",
      "Booked at", "Scheduled for", "Slot", "Helper", "Amount", "Payment", "Refunded", "Refund amount", "Booked via", "Follow-up", "Their answer", "Their note"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = list.map((r) => {
      const f = followups.get(r.id);
      return [r.id, r.cancelled_at ?? "", SIDE_LABEL[r.side], r.reason ?? "", r.customer_name, r.customer_phone, r.title, r.category,
        r.area, r.city, r.booked_at ?? "", r.scheduled_at ?? "", r.scheduled_slot, r.helper_name, r.amount, r.payment_type,
        r.refunded ? "yes" : "no", r.refund_amount ?? "", r.booking_source, f?.status ?? "", f?.answer_reason_label ?? "", f?.answer_note ?? ""].map(esc).join(",");
    });
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cancelled-works-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const rowProps = { open, setOpen, followups, timesBy, showSide: side === "all" };

  return (
    <div className="cw-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><UserX size={13} /> Cancellation Engagement</span>
            <h1>Cancelled Works</h1>
            <p>Every cancelled Work in detail: the customer, the service, when and why, the refund, and the follow-up message.</p>
          </div>
          <div className="cw-head-tools">
            {ready && d!.fetched_at && <span className="cw-updated">Live · updated {fmtTime(d!.fetched_at)}</span>}
            <button className="cw-btn" onClick={download} disabled={!list.length}><Download size={13} /> Download CSV</button>
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        {ready && (
          <div className="cw-controls">
            <div className="cw-seg" role="tablist" aria-label="Who cancelled">
              {SIDES.map((s) => (
                <button key={s.key} role="tab" aria-selected={side === s.key} className={side === s.key ? "on" : ""} onClick={() => set({ side: s.key })}>
                  {s.label} <span className="tabular">{n(s.key === "all" ? d!.total ?? 0 : d!.by_side?.[s.key] ?? 0)}</span>
                </button>
              ))}
            </div>
            <PeriodPills presets={PRESETS} range={range} setRange={setRange} />
          </div>
        )}
      </header>

      {data.error && <div className="cw-error">{data.error}</div>}
      {!ready && !data.error && <Skeleton note={<><Loader2 size={15} className="spin" /> Reading the cancelled Works from ExtraHand…</>} />}

      {ready && (
        <>
          {side === "unknown" && (
            <p className="cw-note"><HelpCircle size={14} /> ExtraHand did not record who cancelled these Works or why (mostly older Works). They are placed by their booking date.</p>
          )}

          {/* refunded / not refunded: the main split */}
          <section className="cx-refund" aria-label="Refunded or not">
            {!cards || cards.loading ? <p className="cw-note"><Loader2 size={14} className="spin" /> Getting the numbers…</p> : <>
            <RefundCard on={refund === "all"} onClick={() => set({ refund: null })} icon={Ban} tone="all" title="Cancelled"
              count={cards.cancelled.count} main={rupees(cards.cancelled.value)} mainLabel="booking value"
              sub={cards.cancelled.rate === null ? "" : `${cards.cancelled.rate}% of finished bookings`} share={null} />
            <RefundCard on={refund === "yes"} onClick={() => set({ refund: refund === "yes" ? null : "yes" })} icon={CircleCheck} tone="yes" title="Refunded"
              count={cards.refunded.count} main={rupees(cards.refunded.returned)} mainLabel="returned to customers"
              sub={`of ${rupees(cards.refunded.paid)} paid`} share={cards.refunded.share} />
            <RefundCard on={refund === "no"} onClick={() => set({ refund: refund === "no" ? null : "no" })} icon={CircleDashed} tone="no" title="Not refunded"
              count={cards.not_refunded.count} main={rupees(cards.not_refunded.value)} mainLabel="booking value"
              sub={`${n(cards.not_refunded.paid_bookings)} were paid bookings`} share={cards.not_refunded.share} />
            <RefundCard icon={BadgeCheck} tone="done" title="Completed" count={cards.completed.count}
              main={cards.completed.average === null ? "—" : rupees(cards.completed.average)} mainLabel="per Work"
              sub={`${n(cards.completed.count)} done vs ${n(cards.cancelled.count)} cancelled`} share={null} />
            <RefundCard icon={IndianRupee} tone="money" title="Money received" count={null} main={rupees(cards.completed.received)}
              mainLabel="paid for completed Works" sub={`${n(cards.completed.count)} completed ${cards.completed.count === 1 ? "Work" : "Works"} · ${range.label.toLowerCase()}`} share={null} />
            </>}
          </section>

          <div className="cx-filterbar">
            <div className="cw-search">
              <Search size={15} />
              <input value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Search customer, phone, Work or Work ID" aria-label="Search cancelled Works" />
              {q && <button onClick={() => set({ q: null })} aria-label="Clear search"><X size={13} /></button>}
            </div>
            <Select all="All categories" icon={Wrench} value={category} options={options("category")} onChange={(v) => set({ category: v })} />
            <Select all="All cities" icon={MapPin} value={city} options={options("city")} onChange={(v) => set({ city: v })} />
            <Select all="All reasons" icon={MessageSquareWarning} value={reason} options={options("reason")} onChange={(v) => set({ reason: v })} />
            {anyFilter && <button className="cx-clear" onClick={() => setParams(side === "customer" ? {} : { side }, { replace: true })}><X size={13} /> Clear</button>}
          </div>

          <div className="cw-tablebox">
            <div className="cw-tablecap">
              <div>
                <h2>{REFUND_TITLE[refund]}{category ? ` · ${category}` : ""}</h2>
                <small>
                  {n(list.length)} {list.length === 1 ? "Work" : "Works"} · {range.label}{city ? ` · ${city}` : ""}{reason ? ` · “${reason}”` : ""} ·
                  value {rupees(value)}
                </small>
              </div>
              <div className="cx-cap-tools">
              <label className="cx-select cx-sort">
                <select value={sort} onChange={(e) => set({ sort: e.target.value === "newest" ? null : e.target.value })} aria-label="Sort">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="amount">Highest amount</option>
                </select>
              </label>
              <div className="cw-seg" role="tablist" aria-label="View">
                <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => set({ view: null })}><List size={13} /> List</button>
                <button role="tab" aria-selected={view === "refund"} className={view === "refund" ? "on" : ""} onClick={() => set({ view: "refund" })}><Wallet size={13} /> By refund</button>
                <button role="tab" aria-selected={view === "category"} className={view === "category" ? "on" : ""} onClick={() => set({ view: "category" })}><Layers size={13} /> By category</button>
              </div>
              </div>
            </div>

            {list.length === 0 ? <p className="cw-empty">No cancelled Works match these filters.</p> : view === "list" ? (
              <>
                <WorksTable rows={list.slice(0, shown)} {...rowProps} />
                {list.length > shown && <button className="cw-more" onClick={() => setShown(shown + PAGE)}>Show {n(Math.min(PAGE, list.length - shown))} more of {n(list.length - shown)}</button>}
              </>
            ) : view === "refund" ? (
              <div className="cx-groups">
                {([["Refunded", list.filter((r) => r.refunded), "yes"], ["Not refunded", list.filter((r) => !r.refunded), "no"]] as const)
                  .filter(([, rows]) => rows.length).map(([title, rows, tone]) => (
                    <section key={title} className={`cx-group refund-${tone}`}>
                      <header>
                        <span className="cx-group-name">{tone === "yes" ? <CircleCheck size={15} /> : <CircleDashed size={15} />} <b>{title}</b></span>
                        <span className="cx-group-meta">
                          <b className="tabular">{n(rows.length)}</b> {rows.length === 1 ? "Work" : "Works"} ·{" "}
                          {tone === "yes"
                            ? <>{rupees(sum([...rows], (r) => r.refund_amount ?? r.amount))} returned</>
                            : <>{rupees(sum([...rows], (r) => r.amount))} booking value</>}
                        </span>
                      </header>
                      <WorksTable rows={[...rows]} {...rowProps} />
                    </section>
                  ))}
              </div>
            ) : (
              <div className="cx-groups">
                {groupBy(list).map(([cat, rows]) => {
                  const top = topOf(rows, (r) => r.reason);
                  const back = rows.filter((r) => r.refunded).length;
                  return (
                    <section key={cat} className="cx-group">
                      <header>
                        <span className="cx-group-name"><Wrench size={15} /> <b>{cat}</b></span>
                        <span className="cx-group-meta">
                          <b className="tabular">{n(rows.length)}</b> {rows.length === 1 ? "Work" : "Works"} · {rupees(rows.reduce((s, r) => s + r.amount, 0))}
                          {" "}· {n(back)} refunded{top ? <> · top reason “{top[0]}”</> : null}
                        </span>
                      </header>
                      <WorksTable rows={rows} {...rowProps} />
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function groupBy(rows: Item[]): [string, Item[]][] {
  const m = new Map<string, Item[]>();
  for (const r of rows) m.set(r.category, [...(m.get(r.category) ?? []), r]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

function Select({ all, icon: I, value, options, onChange }: {
  all: string; icon: React.ElementType; value: string | null; options: [string, number][]; onChange: (v: string | null) => void;
}) {
  return (
    <label className={`cx-select ${value ? "on" : ""}`}>
      <I size={14} />
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={all}>
        <option value="">{all}</option>
        {value && !options.some(([k]) => k === value) && <option value={value}>{value}</option>}
        {options.map(([k, c]) => <option key={k} value={k}>{k} ({c})</option>)}
      </select>
    </label>
  );
}

function RefundCard({ on = false, onClick, icon: I, tone, title, count, main, mainLabel, sub, share }: {
  on?: boolean; onClick?: () => void; icon: React.ElementType; tone: "all" | "yes" | "no" | "done" | "money"; title: string;
  count: number | null; main: string; mainLabel: string; sub: string; share: number | null;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`cx-rcard ${tone} ${on ? "on" : ""} ${onClick ? "" : "info"}`} {...(onClick ? { onClick, "aria-pressed": on } : {})}>
      <span className="cx-rcard-top">
        <span className="cx-rcard-icon"><I size={16} /></span>
        <b>{title}</b>
        {share !== null && <em className="tabular">{share}%</em>}
      </span>
      {count === null
        ? <span className="cx-rcard-count tabular">{main}</span>
        : <span className="cx-rcard-count tabular">{n(count)} <small>{count === 1 ? "Work" : "Works"}</small></span>}
      {count !== null && <span className="cx-rcard-money"><b className="tabular">{main}</b> {mainLabel}</span>}
      {count === null && <span className="cx-rcard-money">{mainLabel}</span>}
      {sub && <small>{sub}</small>}
      {share !== null && <span className="cx-rcard-bar"><i style={{ width: `${share}%` }} /></span>}
    </Tag>
  );
}

interface RowProps {
  open: string | null; setOpen: (id: string | null) => void; followups: Map<string, WaCancelFollowupRow>;
  timesBy: Map<string, number>; showSide: boolean;
}

function WorksTable({ rows, ...p }: { rows: Item[] } & RowProps) {
  return (
    <div className="cw-scroll">
      <table className="cw-table cx-table">
        <thead>
          <tr><th>Cancelled</th><th>Customer</th><th>Work</th><th>Reason</th><th className="num">Amount</th><th aria-label="Details" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => <WorkRow key={r.id} r={r} {...p} />)}
        </tbody>
      </table>
    </div>
  );
}

function WorkRow({ r, open, setOpen, followups, timesBy, showSide }: { r: Item } & RowProps) {
  const isOpen = open === r.id;
  const f = followups.get(r.id);
  const times = timesBy.get(r.customer_key) ?? 0;
  const place = [r.area, r.city === "City not set" ? "" : r.city].filter(Boolean).join(", ");
  return (
    <Fragment>
      <tr className={`cx-row ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : r.id)}>
        <td className="cw-when c-when">
          {r.cancelled_at ? <><b>{fmtDate(r.cancelled_at)}</b><small>{fmtTime(r.cancelled_at)}</small></>
            : <><b className="cw-muted">Not recorded</b><small>booked {fmtDate(r.booked_at)}</small></>}
        </td>
        <td className="c-who">
          <div className="cw-who">
            <Avatar name={r.customer_name} />
            <div>
              <b className="cw-name">{r.customer_name}</b>
              {r.customer_phone && <a className="cw-phone" href={`tel:${r.customer_phone}`} onClick={(e) => e.stopPropagation()}><Phone size={11} /> {r.customer_phone}</a>}
              {r.side === "customer" && times > 1 && <span className="cw-tag warn"><Repeat size={10} /> Cancelled {times} times</span>}
            </div>
          </div>
        </td>
        <td className="c-work">
          <b className="cw-work">{r.title}</b>
          <small><span className="cx-cat-tag">{r.category}</span>{place ? ` ${place}` : ""}</small>
        </td>
        <td className="cw-reasoncell c-reason">
          <span className={r.reason ? "" : "cw-muted"}>{r.reason ?? NO_REASON}</span>
          {(showSide || r.side !== "customer") && <span className={`cw-tag side-${r.side}`}>{SIDE_LABEL[r.side]}</span>}
          {f && <span className="cx-fu"><MessageCircleHeart size={11} /> <StatusTag r={f} />{f.answer_reason_label ? <> “{f.answer_reason_label}”</> : null}</span>}
        </td>
        <td className="num c-amt">
          <b className="tabular">{r.amount ? rupees(r.amount) : "—"}</b>
          {r.refunded && <span className="cw-tag ok">Refunded{r.refund_amount ? ` ${rupees(r.refund_amount)}` : ""}</span>}
        </td>
        <td className="c-side cx-toggle">
          <button aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.id); }}>
            <ChevronDown size={16} />
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="cx-detail">
          <td colSpan={6}>
            <div className="cx-detail-grid">
              <Fact label="Work ID" mono value={r.id} />
              <Fact label="Service" value={`${r.category} · ${r.title}`} />
              <Fact label="Where" value={place || "—"} />
              <Fact label="Booked" value={`${fmtDate(r.booked_at)} ${fmtTime(r.booked_at)}`} />
              <Fact label="Scheduled for" value={r.scheduled_at ? `${fmtDate(r.scheduled_at)}${r.scheduled_slot ? `, ${r.scheduled_slot}` : ""}` : "—"} />
              <Fact label="Booked via" value={pretty_source(r.booking_source)} />
              <Fact label="Cancelled" value={r.cancelled_at ? `${fmtDate(r.cancelled_at)} ${fmtTime(r.cancelled_at)}` : "Not recorded"} />
              <Fact label="Who cancelled" value={SIDE_LABEL[r.side]} note={r.side_note || undefined} />
              <Fact label="Reason on ExtraHand" value={r.reason ?? NO_REASON} />
              <Fact label="Helper" value={r.helper_name || "Not assigned"} />
              <Fact label="Amount" value={`${rupees(r.amount)}${r.payment_type ? ` · ${pretty(r.payment_type)}` : ""}`} />
              <Fact label="Refund" value={r.refunded ? `${r.refund_amount ? rupees(r.refund_amount) : "Yes"}${r.refunded_at ? ` on ${fmtDate(r.refunded_at)}` : ""}` : "Not refunded"} />
              <Fact label="This customer" value={times > 1 ? `Cancelled ${times} Works` : "First cancellation"} />
              <div className="cx-fact wide">
                <span>Follow-up message</span>
                {f ? (
                  <b>
                    <StatusTag r={f} /> {f.sent_at ? `sent ${fmtDate(f.sent_at)} ${fmtTime(f.sent_at)}` : ""}
                    {f.answer_reason_label ? <> · answered “{f.answer_reason_label}”{f.answer_note ? <> — <i>“{f.answer_note}”</i></> : null}</> : null}
                  </b>
                ) : <b className="cw-muted">Not messaged (only cancellations after the follow-up is switched on)</b>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Fact({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="cx-fact">
      <span>{label}</span>
      <b className={mono ? "cw-mono" : ""}>{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}
