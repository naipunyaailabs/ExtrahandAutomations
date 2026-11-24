import {
  ArrowRight, Ban, BarChart3, CalendarDays, CalendarRange, Clock3, HandCoins, HelpCircle, IndianRupee, ListChecks, Loader2, MapPin,
  MessageSquareWarning, Percent, ReceiptText, RefreshCw, Repeat, RotateCcw, Sparkles, TrendingUp, UserCheck, UserX, Wrench, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { CancelSide, CancelledWork, CancelledWorks, RefundRow, RefundedWorks, WaCancelFollowupOverview } from "../types";
import { CANCEL_ROUTES, FollowupSwitch, worksLink } from "./CancellationShared";
import {
  Avatar, Breakdown, CardHead, Highlights, Kpi, MonthChart, PeriodPills, Ranked, Skeleton, WEEKDAY_NAMES, Weekdays, bucketLabel,
  fmtDate, fmtTime, istDay, lastMonths, monthOf, n, pct, presets, pretty, rangeFor, rupees, rupeesShort, topOf, weekdayOf, within,
  type Dated, type Group, type Highlight, type Range,
} from "./EngagementKit";
import "./cancellation.css";

/** Cancellation Engagement → Dashboard: how many real-customer Works are cancelled, when, where and why — KPI
 * tiles, cancellations by month with auto-written highlights, top cities / reasons / services, weekdays and the
 * Day / Week / Month table, and a Refunds section (amount refunded, refund rate, fees kept, time to refund, refunded by
 * month, how refunds were made — from the refunds API, backend/user_engagement/refunds.py). Every chart filters the page; "View" and "See all" open the Cancelled Works list with
 * the same filters. The follow-up message switch (Activate / Deactivate, starts Inactive) is at the top. Data: backend/user_engagement/cancellations.py (live from ExtraHand). */

const SIDES: { key: CancelSide | "all"; label: string }[] = [
  { key: "customer", label: "By customer" },
  { key: "team", label: "By ExtraHand team" },
  { key: "unknown", label: "Not recorded" },
  { key: "all", label: "All" },
];
const NO_REASON = "No reason given";
const GENERIC_REASONS = new Set(["Cancelled by customer", NO_REASON]); // say nothing about why

interface Item extends CancelledWork, Dated {}
interface RefundItem extends RefundRow, Dated {}

/** hours → "at once", "25 min", "6.5 h", "3 days" */
function refundTime(h: number | null): string {
  if (h === null) return "—";
  if (h < 0.05) return "at once";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** who started the refunds, full or partial, how the money went back, still processing */
function refundFacts(rs: RefundItem[]): [string, string, RefundItem[]][] {
  const rows: [string, string, RefundItem[]][] = [
    ["Customer cancelled", "the customer cancelled and got their money back", rs.filter((r) => r.started_by === "customer")],
    ["Admin refund", "made or recorded by an ExtraHand admin", rs.filter((r) => r.started_by === "admin")],
    ["Helper cancelled", "the helper cancelled, the customer was refunded", rs.filter((r) => r.started_by === "helper")],
    ["Full refunds", "everything the customer paid", rs.filter((r) => r.full)],
    ["Partial refunds", "a cancellation fee was kept", rs.filter((r) => !r.full)],
    ["Through Razorpay", "sent back to the customer's payment", rs.filter((r) => r.method === "razorpay")],
    ["Recorded only", "written in ExtraHand, no Razorpay refund", rs.filter((r) => r.method === "recorded")],
    ["Still processing", "Razorpay has not finished yet", rs.filter((r) => r.status !== "completed")],
  ];
  return rows.filter(([, , xs]) => xs.length > 0);
}

export function CancellationDashboardPage() {
  const navigate = useNavigate();
  const data = usePoll<CancelledWorks>(api.engagement.cancellations, 30000);
  const followup = usePoll<WaCancelFollowupOverview>(api.whatsapp.cancelFollowup, 60000);
  const refundsPoll = usePoll<RefundedWorks>(api.engagement.refunds, 60000);
  const today = istDay(new Date().toISOString());
  const PRESETS = useMemo(() => presets(today), [today]);
  const [side, setSide] = useState<CancelSide | "all">("customer");
  const [range, setRange] = useState<Range>(PRESETS[PRESETS.length - 1]);
  const [city, setCity] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("day");
  const d = data.data;
  const ready = !!(d && !d.loading && d.rows);

  const all: Item[] = useMemo(
    () => (d?.rows ?? []).map((r) => {
      const when = r.cancelled_at ?? r.booked_at;
      return { ...r, city: r.city || "City not set", category: pretty(r.category), day: when ? istDay(when) : null };
    }),
    [d],
  );

  // filter layers: side → city / reason → period (each chart leaves out its own filter so others stay visible)
  const sideOk = (r: Item) => side === "all" || r.side === side;
  const cityOk = (r: Item) => !city || r.city === city;
  const reasonOk = (r: Item) => !reason || (r.reason ?? NO_REASON) === reason;
  const inRange = (r: Item) => within(r.day, range.from, range.to);

  const scoped = all.filter((r) => sideOk(r) && cityOk(r) && reasonOk(r));
  const current = scoped.filter(inRange);
  const prevCount = range.prev ? scoped.filter((r) => within(r.day, range.prev![0], range.prev![1])).length : null;
  const forCities = all.filter((r) => sideOk(r) && reasonOk(r) && inRange(r));
  const forReasons = all.filter((r) => sideOk(r) && cityOk(r) && inRange(r));
  const forBreakdown = all.filter((r) => cityOk(r) && reasonOk(r));

  const customers = new Set(current.map((r) => r.customer_key));
  const repeat = [...customers].filter((k) => current.filter((r) => r.customer_key === k).length > 1).length;
  const value = current.reduce((s, r) => s + r.amount, 0);
  const refunded = current.reduce((s, r) => s + (r.refund_amount ?? 0), 0);
  const refundedCount = current.filter((r) => r.refunded).length;
  const afterHelper = current.filter((r) => r.helper_name).length;

  const highlights: Highlight[] = [];
  if (current.length) {
    const topCity = topOf(current.filter((r) => r.city !== "City not set"), (r) => r.city);
    if (topCity) highlights.push({ icon: MapPin, text: <><b>{topCity[0]}</b> has the most cancellations: {n(topCity[1])}, {pct(topCity[1], current.length)}% of them.</> });
    const topReason = topOf(current, (r) => (r.reason && !GENERIC_REASONS.has(r.reason) ? r.reason : null));
    if (topReason) highlights.push({ icon: MessageSquareWarning, text: <>The most common reason given: <b>“{topReason[0]}”</b> ({n(topReason[1])}).</> });
    const topService = topOf(current, (r) => r.category);
    if (topService) highlights.push({ icon: Wrench, text: <><b>{topService[0]}</b> is the service cancelled most ({n(topService[1])}).</> });
    if (repeat) highlights.push({ icon: Repeat, tone: "warn", text: <><b>{n(repeat)} {repeat === 1 ? "customer" : "customers"}</b> cancelled more than once<small>Worth a call to find out what went wrong.</small></> });
    const topDay = topOf(current.filter((r) => r.day), (r) => String(weekdayOf(r.day!)));
    if (topDay && current.length >= 5) highlights.push({ icon: CalendarDays, text: <>Most cancellations happen on <b>{WEEKDAY_NAMES[Number(topDay[0])]}s</b>.</> });
    if (range.from === null) {
      const peak = topOf(scoped.filter((r) => r.day), (r) => monthOf(r.day!));
      if (peak) highlights.push({ icon: TrendingUp, text: <>Busiest month: <b>{bucketLabel(peak[0], "month")}</b> with {n(peak[1])}.</> });
    }
  }

  const listLink = (rg: Range = range) => worksLink({ side, from: rg.from, to: rg.to, label: rg.from ? rg.label : undefined, city, reason });
  const latest = [...current].sort((a, b) => (b.cancelled_at ?? b.booked_at ?? "").localeCompare(a.cancelled_at ?? a.booked_at ?? "")).slice(0, 6);
  const fu = followup.data;

  // refunds in the same period and city as the rest of the page (placed on the day the refund was made)
  const rd = refundsPoll.data;
  const refundsReady = !!(rd && !rd.loading && rd.rows);
  const refundItems: RefundItem[] = useMemo(() => (rd?.rows ?? []).map((r) => ({
    ...r, city: r.city || "City not set", day: r.requested_at ? istDay(r.requested_at) : null,
  })), [rd]);
  const refundsScoped = refundItems.filter((r) => !city || r.city === city);
  const refundsNow = refundsScoped.filter((r) => within(r.day, range.from, range.to));
  const refundsPrev = range.prev ? refundsScoped.filter((r) => within(r.day, range.prev![0], range.prev![1])) : null;
  const rsum = (rs: RefundItem[], f: (r: RefundItem) => number | null) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);
  const refundedAmount = rsum(refundsNow, (r) => r.amount);
  const feesKept = rsum(refundsNow, (r) => r.fee_kept);
  const partial = refundsNow.filter((r) => !r.full);
  const processing = refundsNow.filter((r) => r.status !== "completed");
  const waits = refundsNow.map((r) => r.hours_to_refund).filter((h): h is number => h !== null).sort((a, b) => a - b);
  const typicalWait = waits.length ? waits[Math.floor((waits.length - 1) / 2)] : null;
  // refund rate: of the cancelled Works in view, how many were refunded
  const refundedCancelled = current.filter((r) => r.refunded).length;

  return (
    <div className="cw-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><UserX size={13} /> Cancellation Engagement</span>
            <h1>Cancellation Dashboard</h1>
            <p>Works that real customers booked and then cancelled: how many, when, where, and why.</p>
          </div>
          <div className="cw-head-tools">
            {ready && d!.fetched_at && <span className="cw-updated">Live · updated {fmtTime(d!.fetched_at)}</span>}
            <button className="cw-btn" onClick={data.refresh} aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        {ready && (
          <div className="cw-controls">
            <div className="cw-seg" role="tablist" aria-label="Who cancelled">
              {SIDES.map((s) => (
                <button key={s.key} role="tab" aria-selected={side === s.key} className={side === s.key ? "on" : ""} onClick={() => setSide(s.key)}>
                  {s.label} <span className="tabular">{n(s.key === "all" ? d!.total ?? 0 : d!.by_side?.[s.key] ?? 0)}</span>
                </button>
              ))}
            </div>
            <PeriodPills presets={PRESETS} range={range} setRange={setRange} />
          </div>
        )}
        <div className="cx-banner-follow">
          <FollowupSwitch data={fu} error={followup.error} onChanged={followup.refresh} />
          {fu && (
            <Link className="cx-summary small" to={CANCEL_ROUTES.messages}>
              <span><b className="tabular">{n(fu.stats.sent)}</b> sent</span>
              <span><b className="tabular">{n(fu.stats.answered)}</b> answered</span>
              <span className="go">Messages & replies <ArrowRight size={13} /></span>
            </Link>
          )}
        </div>
      </header>

      {data.error && <div className="cw-error">{data.error}</div>}
      {!ready && !data.error && <Skeleton note={<><Loader2 size={15} className="spin" /> Reading the cancelled Works from ExtraHand…</>} />}

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
          {side === "unknown" && (
            <p className="cw-note"><HelpCircle size={14} /> ExtraHand did not record who cancelled these Works or why (mostly older Works). They are placed by their booking date.</p>
          )}

          <div className="cw-kpis">
            <Kpi lead icon={Ban} label="Cancelled" value={n(current.length)} sub={range.label}
              delta={prevCount === null ? null : current.length - prevCount} prevLabel={range.prevLabel}
              spark={lastMonths(scoped, today, 6)} sparkLabel="Last 6 months" />
            <Kpi icon={Repeat} label="Customers who cancelled" value={n(customers.size)} sub={repeat ? `${n(repeat)} cancelled more than once` : "none cancelled twice"} />
            <Kpi icon={IndianRupee} label="Booking value lost" value={rupees(value)}
              sub={refundedCount ? `${rupees(refunded)} refunded on ${n(refundedCount)} ${refundedCount === 1 ? "Work" : "Works"}` : "nothing refunded"} />
            <Kpi icon={UserCheck} label="After a helper was assigned" value={n(afterHelper)}
              sub={current.length ? `${pct(afterHelper, current.length)}% · ${n(current.length - afterHelper)} before anyone took it` : "—"} />
          </div>

          <div className="cw-row">
            <section className="cw-card">
              <CardHead icon={BarChart3} title="Cancellations by month" note="click a month to open it" />
              <MonthChart rows={scoped} range={range} today={today} noun="cancelled" onPick={(mo) => setRange(rangeFor(mo, "month"))}
                tip={(rs) => {
                  const top = topOf(rs, (r) => r.reason);
                  return (
                    <>
                      <span><i className="sw" /> {n(rs.length)} cancelled</span>
                      <span>{n(new Set(rs.map((r) => r.customer_key)).size)} customers · {rupees(rs.reduce((s, r) => s + r.amount, 0))}</span>
                      {top && <span className="muted">Top reason: {top[0]} ({top[1]})</span>}
                    </>
                  );
                }} />
            </section>
            <section className="cw-card">
              <CardHead icon={Sparkles} title="Highlights" note={range.label} />
              <Highlights items={highlights} empty="No cancellations in this period." />
            </section>
          </div>

          <div className="cw-grid three">
            <section className="cw-card">
              <CardHead icon={MapPin} title="Cities" note="click to filter" />
              <Ranked rows={forCities} keyOf={(r) => r.city} selected={city} onPick={setCity} empty="No cancellations in this period."
                tip={(_, rs) => <span>{rupees(rs.reduce((s, r) => s + r.amount, 0))} booking value</span>} />
            </section>
            <section className="cw-card">
              <CardHead icon={MessageSquareWarning} title="Reasons" note="click to filter" />
              <Ranked rows={forReasons} keyOf={(r) => r.reason ?? NO_REASON} selected={reason} onPick={setReason} empty="No cancellations in this period." />
            </section>
            <section className="cw-card">
              <CardHead icon={Wrench} title="Services" note="click to see the Works" />
              <Ranked rows={current} keyOf={(r) => r.category} empty="No cancellations in this period."
                onPick={(k) => k && navigate(worksLink({ side, from: range.from, to: range.to, label: range.from ? range.label : undefined, city, reason, category: k }))}
                tip={(_, rs) => <span>{rupees(rs.reduce((s, r) => s + r.amount, 0))} booking value</span>} />
            </section>
          </div>

          <div className="cw-row rev">
            <section className="cw-card">
              <CardHead icon={CalendarRange} title="By day of the week" note={range.label} />
              <Weekdays rows={current} noun="cancelled" />
            </section>
            <Breakdown rows={forBreakdown} group={group} setGroup={setGroup} today={today} active={range.key}
              onView={(rg) => navigate(listLink(rg))}
              noun="Cancellations" countLabel="Cancelled" columns={[
                { label: "By customer", cell: (rs) => n(rs.filter((r) => r.side === "customer").length) },
                { label: "Team / not recorded", cell: (rs) => n(rs.filter((r) => r.side !== "customer").length) },
                { label: "Value", cell: (rs) => rupees(rs.reduce((s, r) => s + r.amount, 0)) },
                { label: "Refunded", cell: (rs) => rupees(rs.reduce((s, r) => s + (r.refund_amount ?? 0), 0)) },
              ]} />
          </div>

          <section className="cx-refunds-zone" aria-label="Refunds">
            <div className="cx-zone-head">
              <h2><RotateCcw size={16} /> Refunds</h2>
              <small>{range.label}{city ? ` · ${city}` : ""} · money returned to customers who cancelled</small>
              <Link className="cx-link" to={CANCEL_ROUTES.refunds}>All refunds <ArrowRight size={13} /></Link>
            </div>
            {!refundsReady ? (
              refundsPoll.error ? <div className="cw-error">{refundsPoll.error}</div>
                : <p className="cw-note"><Loader2 size={14} className="spin" /> Reading the refunds from ExtraHand… the first read after a restart takes a couple of minutes.</p>
            ) : (
              <>
                <div className="cw-kpis">
                  <Kpi lead icon={IndianRupee} label="Refunded" value={rupees(refundedAmount)}
                    sub={`${n(refundsNow.length)} ${refundsNow.length === 1 ? "refund" : "refunds"} · ${n(new Set(refundsNow.map((r) => r.customer_key)).size)} customers`}
                    delta={refundsPrev ? refundedAmount - rsum(refundsPrev, (r) => r.amount) : null} prevLabel={range.prevLabel} fmt={rupees}
                    spark={lastMonths(refundsScoped, today, 6, (rs) => rsum(rs, (r) => r.amount))} sparkLabel="Refunded, last 6 months" />
                  <Kpi icon={Percent} label="Refund rate" value={current.length ? `${pct(refundedCancelled, current.length)}%` : "—"}
                    sub={`${n(refundedCancelled)} of ${n(current.length)} cancelled Works refunded`} />
                  <Kpi icon={HandCoins} label="Cancellation fees kept" value={rupees(feesKept)}
                    sub={partial.length ? `${n(partial.length)} partial ${partial.length === 1 ? "refund" : "refunds"} · the rest in full` : "every refund was in full"} />
                  <Kpi icon={Clock3} label="Time to refund" value={refundTime(typicalWait)}
                    sub={processing.length ? `${n(processing.length)} still processing` : waits.length ? "typical, after cancelling" : "cancel time not recorded"} />
                </div>
                <div className="cw-row">
                  <section className="cw-card">
                    <CardHead icon={BarChart3} title="Refunded by month" note="amount · click a month to open it" />
                    <MonthChart rows={refundsScoped} range={range} today={today} noun="refunded" measure={(rs) => rsum(rs, (r) => r.amount)}
                      fmt={rupees} short={rupeesShort} axis={rupeesShort} onPick={(mo) => setRange(rangeFor(mo, "month"))}
                      tip={(rs) => (
                        <>
                          <span><i className="sw" /> {rupees(rsum(rs, (r) => r.amount))} refunded</span>
                          <span>{n(rs.length)} refunds · {n(rs.filter((r) => !r.full).length)} partial</span>
                        </>
                      )} />
                  </section>
                  <section className="cw-card">
                    <CardHead icon={ReceiptText} title="How refunds were made" note={range.label} />
                    {refundsNow.length === 0 ? <p className="cw-empty small">No refunds in this period.</p> : (
                      <ul className="cw-facts">
                        {refundFacts(refundsNow).map(([label, sub, rs]) => (
                          <li key={label}><span>{label}<small>{sub}</small></span><b className="tabular">{n(rs.length)}</b><em className="tabular">{rupees(rsum(rs, (r) => r.amount))}</em></li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}
          </section>

          <section className="cw-card">
            <CardHead icon={ListChecks} title="Latest cancellations" note={range.label}>
              <Link className="cx-link" to={listLink()}>See all {n(current.length)} cancelled Works <ArrowRight size={13} /></Link>
            </CardHead>
            {latest.length === 0 ? <p className="cw-empty small">No cancellations in this period.</p> : (
              <ul className="cx-latest">
                {latest.map((r) => (
                  <li key={r.id}>
                    <Link to={worksLink({ side: "all", q: r.id })}>
                      <Avatar name={r.customer_name} />
                      <span className="cx-latest-main"><b>{r.customer_name}</b><small>{r.title} · {r.category}{r.city !== "City not set" ? ` · ${r.city}` : ""}</small></span>
                      <span className="cx-latest-why">{r.reason ?? NO_REASON}</span>
                      <span className="cx-latest-when">{r.cancelled_at ? <>{fmtDate(r.cancelled_at)}<small>{fmtTime(r.cancelled_at)}</small></> : <>Not recorded<small>booked {fmtDate(r.booked_at)}</small></>}</span>
                      <b className="tabular cx-latest-amt">{rupees(r.amount)}</b>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
