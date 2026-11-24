import {
  AlertCircle, BarChart3, Clock3, Crown, HandCoins, IndianRupee, Loader2, MapPin, MessageSquareWarning, Phone, ReceiptText,
  RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Users, Wrench, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { RefundRow, RefundStarter, RefundedWorks } from "../types";
import {
  Avatar, Breakdown, CardHead, Highlights, Kpi, MonthChart, PeriodPills, Ranked, Skeleton, fmtDate, fmtTime, istDay, lastMonths,
  n, pct, presets, pretty, rangeFor, rupees, rupeesShort, topOf, within, type Dated, type Group, type Highlight, type Range,
} from "./EngagementKit";

/** Customer Engagement → Refunded Works: every refund ExtraHand made to a real customer (refunds API), joined to its
 * Work. KPI tiles, refunds by month with auto-written highlights, top cities / reasons / services, where the money
 * went, a Day / Week / Month table and the full list. Data: backend/user_engagement/refunds.py (live from ExtraHand). */

const STARTERS: { key: RefundStarter | "all"; label: string }[] = [
  { key: "all", label: "All refunds" },
  { key: "customer", label: "Customer cancelled" },
  { key: "admin", label: "Admin refund" },
  { key: "helper", label: "Helper cancelled" },
  { key: "unknown", label: "Not recorded" },
];
const STARTER_LABEL: Record<RefundStarter, string> = { customer: "Customer cancelled", admin: "Admin refund", helper: "Helper cancelled", unknown: "Not recorded" };
const NO_REASON = "No reason given";
const PAGE = 25;

interface Item extends RefundRow, Dated {}

const sum = (rs: Item[], f: (r: Item) => number | null) => rs.reduce((s, r) => s + (f(r) ?? 0), 0);
/** hours → "instant", "25 min", "6.5 h", "3 days" */
function duration(h: number | null): string {
  if (h === null) return "—";
  if (h < 0.05) return "instant";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
function median(vs: number[]): number | null {
  if (!vs.length) return null;
  const s = [...vs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function RefundedWorksPage() {
  const data = usePoll<RefundedWorks>(api.engagement.refunds, 30000);
  const today = istDay(new Date().toISOString());
  const PRESETS = useMemo(() => presets(today), [today]);
  const [starter, setStarter] = useState<RefundStarter | "all">("all");
  const [range, setRange] = useState<Range>(PRESETS[PRESETS.length - 1]);
  const [city, setCity] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("day");
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const d = data.data;
  const ready = !!(d && !d.loading && d.rows);

  const all: Item[] = useMemo(
    () => (d?.rows ?? []).map((r) => ({
      ...r, city: r.city || "City not set", category: pretty(r.category), day: r.requested_at ? istDay(r.requested_at) : null,
    })),
    [d],
  );
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: all.length };
    for (const r of all) m[r.started_by] = (m[r.started_by] ?? 0) + 1;
    return m;
  }, [all]);

  const starterOk = (r: Item) => starter === "all" || r.started_by === starter;
  const cityOk = (r: Item) => !city || r.city === city;
  const reasonOk = (r: Item) => !reason || (r.reason ?? NO_REASON) === reason;
  const inRange = (r: Item) => within(r.day, range.from, range.to);
  const query = q.trim().toLowerCase();

  const scoped = all.filter((r) => starterOk(r) && cityOk(r) && reasonOk(r));
  const current = scoped.filter(inRange);
  const prevAmount = range.prev ? sum(scoped.filter((r) => within(r.day, range.prev![0], range.prev![1])), (r) => r.amount) : null;
  const forCities = all.filter((r) => starterOk(r) && reasonOk(r) && inRange(r));
  const forReasons = all.filter((r) => starterOk(r) && cityOk(r) && inRange(r));
  const forBreakdown = all.filter((r) => starterOk(r) && cityOk(r) && reasonOk(r));
  const list = current.filter((r) => !query || [r.customer_name, r.customer_phone, r.title, r.category, r.city, r.area, r.reason ?? "",
    r.razorpay_refund_id, r.payment_id, r.task_id, r.refund_id].some((v) => v.toLowerCase().includes(query)));

  const amount = sum(current, (r) => r.amount);
  const customers = new Set(current.map((r) => r.customer_key));
  const fees = sum(current, (r) => r.fee_kept);
  const partial = current.filter((r) => !r.full);
  const processing = current.filter((r) => r.status !== "completed");
  const speeds = current.map((r) => r.hours_to_refund).filter((h): h is number => h !== null);
  const typical = median(speeds);

  // highlights: short sentences from the data in view
  const highlights: Highlight[] = [];
  if (current.length) {
    const topCity = topOf(current.filter((r) => r.city !== "City not set"), (r) => r.city, (r) => r.amount);
    if (topCity) highlights.push({ icon: MapPin, text: <><b>{topCity[0]}</b> received the most: {rupees(topCity[1])}, {pct(topCity[1], amount)}% of the money refunded.</> });
    const admin = current.filter((r) => r.started_by === "admin");
    if (admin.length) highlights.push({ icon: ShieldCheck, text: <><b>{n(admin.length)} of {n(current.length)}</b> refunds ({pct(admin.length, current.length)}%) were made by an admin, worth {rupees(sum(admin, (r) => r.amount))}.</> });
    const topService = topOf(current, (r) => r.category, (r) => r.amount);
    if (topService) highlights.push({ icon: Wrench, text: <><b>{topService[0]}</b> is refunded most ({rupees(topService[1])}).</> });
    const biggest = [...current].sort((a, b) => b.amount - a.amount)[0];
    highlights.push({ icon: Crown, text: <>Largest refund: <b>{rupees(biggest.amount)}</b> to {biggest.customer_name}<small>{biggest.title} · {fmtDate(biggest.requested_at)}</small></> });
    if (processing.length) highlights.push({ icon: AlertCircle, tone: "warn", text: <><b>{n(processing.length)} {processing.length === 1 ? "refund is" : "refunds are"} still processing</b> ({rupees(sum(processing, (r) => r.amount))})<small>Razorpay has not finished them yet.</small></> });
    if (partial.length) highlights.push({ icon: HandCoins, text: <>{n(partial.length)} partial {partial.length === 1 ? "refund" : "refunds"} kept <b>{rupees(fees)}</b> in cancellation fees.</> });
  }

  const showList = (rg: Range) => {
    setRange(rg);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const lo = d?.left_out;

  return (
    <div className="cw-page rf">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><RotateCcw size={13} /> Customer Engagement</span>
            <h1>Refunded Works</h1>
            <p>Money ExtraHand returned to real customers: how much, for which Works, why, and how fast.</p>
          </div>
          <div className="cw-head-tools">
            {ready && d!.fetched_at && <span className="cw-updated">Live · updated {fmtTime(d!.fetched_at)}</span>}
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        {ready && (
          <>
            <div className="cw-controls">
              <div className="cw-seg" role="tablist" aria-label="Who started the refund">
                {STARTERS.filter((s) => s.key === "all" || s.key === "customer" || s.key === "admin" || counts[s.key]).map((s) => (
                  <button key={s.key} role="tab" aria-selected={starter === s.key} className={starter === s.key ? "on" : ""} onClick={() => setStarter(s.key)}>
                    {s.label} <span className="tabular">{n(counts[s.key] ?? 0)}</span>
                  </button>
                ))}
              </div>
              <PeriodPills presets={PRESETS} range={range} setRange={setRange} />
            </div>
            {lo && (lo.team_or_test + lo.work_missing) > 0 && (
              <p className="cw-banner-foot">
                Real customers only. Not counted: {n(lo.team_or_test)} refunds on ExtraHand team or test bookings
                {lo.work_missing ? `, and ${n(lo.work_missing)} (${rupees(d!.work_missing_amount ?? 0)}) whose Work ExtraHand no longer has, so the customer cannot be checked` : ""}.
              </p>
            )}
          </>
        )}
      </header>

      {data.error && <div className="cw-error">{data.error}</div>}
      {!ready && !data.error && (
        <Skeleton note={<><Loader2 size={15} className="spin" /> Reading every refund and its Work from ExtraHand… the first read after a restart takes a couple of minutes.</>} />
      )}

      {ready && (
        <>
          {(city || reason) && (
            <div className="cw-active">
              <span>Showing only</span>
              {city && <button onClick={() => setCity(null)}><MapPin size={12} /> {city} <X size={12} /></button>}
              {reason && <button onClick={() => setReason(null)}><MessageSquareWarning size={12} /> {reason} <X size={12} /></button>}
              <button className="clear" onClick={() => { setCity(null); setReason(null); }}>Clear</button>
            </div>
          )}

          <div className="cw-kpis">
            <Kpi lead icon={IndianRupee} label="Refunded" value={rupees(amount)} sub={`${n(current.length)} ${current.length === 1 ? "refund" : "refunds"} · ${range.label}`}
              delta={prevAmount === null ? null : amount - prevAmount} prevLabel={range.prevLabel} fmt={rupees}
              spark={lastMonths(scoped, today, 6, (rs) => sum(rs, (r) => r.amount))} sparkLabel="Amount refunded, last 6 months" />
            <Kpi icon={Users} label="Customers refunded" value={n(customers.size)} sub={current.length ? `${rupees(amount / current.length)} per refund on average` : "—"} />
            <Kpi icon={HandCoins} label="Cancellation fees kept" value={rupees(fees)}
              sub={partial.length ? `${n(partial.length)} partial ${partial.length === 1 ? "refund" : "refunds"} · the rest in full` : "every refund was in full"} />
            <Kpi icon={Clock3} label="Typical time to refund" value={duration(typical)}
              sub={processing.length ? `${n(processing.length)} still processing` : speeds.length ? `after cancelling · ${n(speeds.length)} with both times` : "cancel time not recorded"} />
          </div>

          <div className="cw-row">
            <section className="cw-card">
              <CardHead icon={BarChart3} title="Refunded by month" note="amount · click a month to open it" />
              <MonthChart rows={scoped} range={range} today={today} noun="refunded" measure={(rs) => sum(rs, (r) => r.amount)}
                fmt={rupees} short={rupeesShort} axis={rupeesShort} onPick={(m) => setRange(rangeFor(m, "month"))}
                tip={(rs) => (
                  <>
                    <span><i className="sw" /> {rupees(sum(rs, (r) => r.amount))} refunded</span>
                    <span>{n(rs.length)} refunds · {n(new Set(rs.map((r) => r.customer_key)).size)} customers</span>
                    {rs.some((r) => !r.full) && <span className="muted">{n(rs.filter((r) => !r.full).length)} partial · {rupees(sum(rs, (r) => r.fee_kept))} fees kept</span>}
                  </>
                )} />
            </section>
            <section className="cw-card">
              <CardHead icon={Sparkles} title="Highlights" note={range.label} />
              <Highlights items={highlights} empty="No refunds in this period." />
            </section>
          </div>

          <div className="cw-grid three">
            <section className="cw-card">
              <CardHead icon={MapPin} title="Cities" note="amount · click to filter" />
              <Ranked rows={forCities} keyOf={(r) => r.city} measure={(r) => r.amount} fmt={rupees} selected={city} onPick={setCity}
                empty="No refunds in this period." tip={(_, rs) => <span>{n(rs.length)} refunds</span>} />
            </section>
            <section className="cw-card">
              <CardHead icon={MessageSquareWarning} title="Reasons" note="refunds · click to filter" />
              <Ranked rows={forReasons} keyOf={(r) => r.reason ?? NO_REASON} selected={reason} onPick={setReason}
                empty="No refunds in this period." tip={(_, rs) => <span>{rupees(sum(rs, (r) => r.amount))} refunded</span>} />
            </section>
            <section className="cw-card">
              <CardHead icon={Wrench} title="Services" note={`amount · ${range.label}`} />
              <Ranked rows={current} keyOf={(r) => r.category} measure={(r) => r.amount} fmt={rupees}
                empty="No refunds in this period." tip={(_, rs) => <span>{n(rs.length)} refunds</span>} />
            </section>
          </div>

          <div className="cw-row rev">
            <section className="cw-card">
              <CardHead icon={ReceiptText} title="Where the money went" note={range.label} />
              <Details rows={current} />
            </section>
            <Breakdown rows={forBreakdown} group={group} setGroup={setGroup} today={today} active={range.key} onView={showList}
              noun="Refunds" countLabel="Refunds" columns={[
                { label: "Amount", cell: (rs) => rupees(sum(rs, (r) => r.amount)) },
                { label: "Customer", cell: (rs) => n(rs.filter((r) => r.started_by === "customer").length) },
                { label: "Admin", cell: (rs) => n(rs.filter((r) => r.started_by === "admin").length) },
                { label: "Fees kept", cell: (rs) => rupees(sum(rs, (r) => r.fee_kept)) },
              ]} />
          </div>

          <div className="cw-tablebox" ref={listRef}>
            <div className="cw-tablecap">
              <div>
                <h2>Refunds</h2>
                <small>{n(list.length)} {list.length === 1 ? "refund" : "refunds"} · {range.label}{city ? ` · ${city}` : ""}{reason ? ` · “${reason}”` : ""} · {rupees(sum(list, (r) => r.amount))} refunded</small>
              </div>
              <div className="cw-search">
                <Search size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, phone, Work, city or Razorpay id" aria-label="Search refunds" />
                {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
              </div>
            </div>
            {list.length === 0 ? (
              <p className="cw-empty">No refunds match these filters.</p>
            ) : (
              <div className="cw-scroll">
                <table className="cw-table">
                  <thead>
                    <tr><th>Refunded</th><th>Customer</th><th>Work</th><th>Reason</th><th className="num">Amount</th><th>Razorpay</th></tr>
                  </thead>
                  <tbody>
                    {(showAll ? list : list.slice(0, PAGE)).map((r) => <Row key={r.id} r={r} showStarter={starter === "all"} />)}
                  </tbody>
                </table>
              </div>
            )}
            {list.length > PAGE && (
              <button className="cw-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${n(list.length)} refunds`}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Where the money went (for refunds whose payment is known) and how the refunds were made. */
function Details({ rows }: { rows: Item[] }) {
  if (rows.length === 0) return <p className="cw-empty small">No refunds in this period.</p>;
  const known = rows.filter((r) => r.paid !== null);
  const paid = sum(known, (r) => r.paid);
  const back = sum(known, (r) => r.amount);
  const platform = sum(known, (r) => r.to_platform);
  const helper = sum(known, (r) => r.to_helper);
  const other = Math.max(0, paid - back - platform - helper); // fee kept without a recorded split
  const share = (v: number) => (paid ? (v / paid) * 100 : 0);
  const full = rows.filter((r) => r.full), partial = rows.filter((r) => !r.full);
  const razorpay = rows.filter((r) => r.method === "razorpay"), recorded = rows.filter((r) => r.method === "recorded");
  const processing = rows.filter((r) => r.status !== "completed");
  const fact = (label: string, sub: string, rs: Item[]) => (
    <li key={label}><span>{label}<small>{sub}</small></span><b className="tabular">{n(rs.length)}</b><em className="tabular">{rupees(sum(rs, (r) => r.amount))}</em></li>
  );
  return (
    <>
      {paid > 0 && (
        <>
          <div className="cw-split" role="img" aria-label={`Of ${rupees(paid)} paid: ${rupees(back)} refunded, ${rupees(platform + other)} kept by ExtraHand, ${rupees(helper)} to helpers`}>
            <i className="a" style={{ width: `${share(back)}%` }} title={`Refunded ${rupees(back)}`} />
            {platform + other > 0 && <i className="b" style={{ width: `${share(platform + other)}%` }} title={`Kept by ExtraHand ${rupees(platform + other)}`} />}
            {helper > 0 && <i className="c" style={{ width: `${share(helper)}%` }} title={`To helpers ${rupees(helper)}`} />}
          </div>
          <div className="cw-legend">
            <span><i className="a" /> Refunded {rupees(back)}</span>
            <span><i className="b" /> Kept by ExtraHand {rupees(platform + other)}</span>
            {helper > 0 && <span><i className="c" /> To helpers {rupees(helper)}</span>}
            <span>of {rupees(paid)} paid</span>
          </div>
        </>
      )}
      <ul className="cw-facts">
        {fact("Full refunds", "everything the customer paid", full)}
        {fact("Partial refunds", "a cancellation fee was kept", partial)}
        {fact("Through Razorpay", "sent back to the customer's payment", razorpay)}
        {recorded.length > 0 && fact("Recorded only", "written in ExtraHand by an admin, no Razorpay refund", recorded)}
        {processing.length > 0 && fact("Still processing", "Razorpay has not finished yet", processing)}
      </ul>
    </>
  );
}

function Row({ r, showStarter }: { r: Item; showStarter: boolean }) {
  const place = [r.area, r.city === "City not set" ? "" : r.city].filter(Boolean).join(", ");
  return (
    <tr>
      <td className="cw-when c-when">
        <b>{fmtDate(r.requested_at)}</b>
        <small>{fmtTime(r.requested_at)}</small>
        {r.status !== "completed" && <span className="cw-tag proc">{r.status === "processing" ? "Processing" : r.status}</span>}
      </td>
      <td className="c-who">
        <div className="cw-who">
          <Avatar name={r.customer_name} />
          <div>
            <b className="cw-name">{r.customer_name}</b>
            {r.customer_phone && <a className="cw-phone" href={`tel:${r.customer_phone}`}><Phone size={11} /> {r.customer_phone}</a>}
          </div>
        </div>
      </td>
      <td className="c-work">
        <b className="cw-work">{r.title}</b>
        <small>{r.category}{place ? ` · ${place}` : ""}</small>
        <small>
          Booked {fmtDate(r.booked_at)}
          {r.cancelled_at ? ` · cancelled ${fmtDate(r.cancelled_at)}` : r.work_status && r.work_status !== "cancelled" ? ` · Work ${r.work_status}` : ""}
        </small>
      </td>
      <td className="cw-reasoncell c-reason">
        <span className={r.reason ? "" : "cw-muted"}>{r.reason ?? NO_REASON}</span>
        {(showStarter || r.started_by !== "customer") && <span className={`cw-tag side-${r.started_by}`}>{STARTER_LABEL[r.started_by]}</span>}
        {r.hours_to_refund !== null && <small>Refunded {duration(r.hours_to_refund) === "instant" ? "at once" : `${duration(r.hours_to_refund)} after cancelling`}</small>}
      </td>
      <td className="num c-amt">
        <b className="tabular">{rupees(r.amount)}</b>
        {r.paid !== null && <small>of {rupees(r.paid)} paid</small>}
        {!r.full && <span className="cw-tag warn" title={r.to_platform !== null || r.to_helper !== null
          ? `ExtraHand ${rupees(r.to_platform ?? 0)} · helper ${rupees(r.to_helper ?? 0)}` : undefined}>
          {r.fee_kept ? `${rupees(r.fee_kept)} fee kept` : "Partial"}
        </span>}
      </td>
      <td className="c-side">
        {r.method === "razorpay" ? <span className="cw-mono">{r.razorpay_refund_id}</span> : <span className="cw-muted">Recorded only</span>}
        {r.payment_id && <small className="cw-mono">{r.payment_id}</small>}
      </td>
    </tr>
  );
}
