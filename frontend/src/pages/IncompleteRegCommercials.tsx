import { Clock3, Receipt, RefreshCw } from "lucide-react";
import { api } from "../api";
import { ErrorNote, SkeletonRows } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { WaIncompleteCommercials, WaIncompleteCommercialsFigures } from "../types";
import { inr } from "./incompleteRegShared";
import "./wa-commercials.css";
import "./wa-welcomers.css";

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function Row({ label, f }: { label: string; f: WaIncompleteCommercialsFigures }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="tabular">{f.sent}</td>
      <td className="tabular">{f.delivered} <small>{f.delivery_rate}%</small></td>
      <td className="tabular">{f.read} <small>{f.read_rate}%</small></td>
      <td className={`tabular ${f.failed ? "wx-bad" : ""}`}>{f.failed}</td>
      <td className="tabular">{f.sent ? inr(f.cost_per_msg) : "—"}</td>
      <td className="tabular"><b>{inr(f.cost)}</b></td>
    </tr>
  );
}

export function IncompleteRegCommercials() {
  const [period, setPeriod] = useUrlState<PeriodKey>("period", "month");
  const data = usePoll<WaIncompleteCommercials>(api.whatsapp.incompleteRegCommercials, 60000);
  const r = data.data;
  const p = r?.periods[period];
  const max = Math.max(1, ...(r?.daily ?? []).map((d) => d.helper + d.customer));

  return (
    <div className="wx-page">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Receipt size={13} /> Customer Engagement · Incomplete Register</span>
            <h1>Incomplete Register Commercials</h1>
            <p className="wwl-sub">Usage and Meta WhatsApp charges for Helper and Customer incomplete-registration reminders.</p>
          </div>
          <div className="wx-banner-tools">
            <div className="wx-pills" role="tablist" aria-label="Period">
              {PERIODS.map((x) => (
                <button key={x.key} type="button" className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
              ))}
            </div>
            <button type="button" className="wx-ghost wx-square" onClick={data.refresh} title="Refresh" aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        {p && (
          <div className="wx-figures wwl-figures">
            <div><span>Reminders sent</span><b>{p.total.sent}</b><em>{p.helper.sent} helpers · {p.customer.sent} customers</em></div>
            <div><span>Delivered</span><b>{p.total.delivery_rate}%</b><em>{p.total.delivered} messages</em></div>
            <div><span>Read</span><b>{p.total.read_rate}%</b><em>of delivered</em></div>
            <div><span>Cost</span><b>{inr(p.total.cost)}</b><em>{p.total.sent ? `${inr(p.total.cost_per_msg)} per message` : "nothing sent"}</em></div>
          </div>
        )}
      </header>

      <ErrorNote error={data.error} />
      {!r && !data.error && <div className="wx-sheet"><SkeletonRows rows={8} /></div>}

      {r && p && (
        <>
          <section className="wx-sheet">
            <div className="wx-sheet-head"><span className="wx-num">01</span><h2>Helper vs Customer</h2></div>
            <div className="wwl-table-wrap">
              <table className="wx-ledger">
                <thead>
                  <tr><th>Audience</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th><th>Per message</th><th>Cost</th></tr>
                </thead>
                <tbody>
                  <Row label="Helper Incomplete" f={p.helper} />
                  <Row label="Customer Incomplete" f={p.customer} />
                  <Row label="Total" f={p.total} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="wx-sheet">
            <div className="wx-sheet-head">
              <span className="wx-num">02</span><h2>Last 30 days</h2>
              <span className="wx-sheet-aside wwl-legend"><i className="h" /> Helpers <i className="c" /> Customers</span>
            </div>
            <div className="wwl-bars" role="img" aria-label="Incomplete registration reminders per day, last 30 days">
              {r.daily.map((d) => (
                <div key={d.date} className="wwl-bar" title={`${d.date}: ${d.helper} helpers, ${d.customer} customers · ${inr(d.cost)}`}>
                  <span className="c" style={{ height: `${(d.customer / max) * 100}%` }} />
                  <span className="h" style={{ height: `${(d.helper / max) * 100}%` }} />
                </div>
              ))}
            </div>
            <p className="wx-foot">
              <Clock3 size={13} /> Cost uses Meta's billing report when it has arrived, otherwise the marketing rate of {inr(r.rate_marketing)} per
              message from the commercials rate card.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
