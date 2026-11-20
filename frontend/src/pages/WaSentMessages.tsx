import { AlertTriangle, Check, CheckCheck, ChevronLeft, ChevronRight, Clock3, FlaskConical, Inbox, Megaphone, RefreshCw, Search, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import { ErrorNote, SkeletonRows } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { WaMsgCategoryTab, WaSentMessage, WaSentMessagesPage } from "../types";
import "./wa-commercials.css";
import "./wa-sent-messages.css";

const PAGE = 50;

const TABS: { key: WaMsgCategoryTab; label: string; note: string; icon: LucideIcon }[] = [
  { key: "all", label: "All messages", note: "everything sent", icon: Inbox },
  { key: "utility", label: "Utility", note: "work orders, updates, reminders", icon: Wrench },
  { key: "marketing", label: "Marketing", note: "promotions, offers, bulk", icon: Megaphone },
  { key: "other", label: "Other", note: "service replies, authentication", icon: Clock3 },
];

const PERIODS = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "0", label: "All time" },
] as const;

const SOURCE: Record<string, string> = { automation: "Automation", bulk: "Bulk", manual: "Manual", welcome: "Welcomer" };

const PURPOSE: Record<string, string> = {
  work_order: "Work order",
  broadcast: "Location broadcast",
  agent_broadcast: "Agent broadcast",
  assignment: "Assignment",
  reminder: "Reminder",
  reply: "Reply",
  bulk: "Bulk campaign",
  manual_message: "Manual message",
  helper_welcome: "Helper welcome",
  customer_welcome: "Customer welcome",
  other: "Other",
};

const ORIGIN: Record<WaSentMessage["category_origin"], string> = {
  meta: "Billed by Meta as this category",
  template: "Category of the approved template",
  estimated: "Estimated from the rate card until Meta reports it",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

function phone(p: string | null): string {
  if (!p) return "Unknown";
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}

const STATUS: Record<string, { cls: string; label: string; hint: string; icon: JSX.Element }> = {
  read: { cls: "read", label: "Read", hint: "Opened by the recipient", icon: <CheckCheck size={14} /> },
  delivered: { cls: "delivered", label: "Delivered", hint: "Reached the phone", icon: <CheckCheck size={14} /> },
  sent: { cls: "sent", label: "Sent", hint: "Accepted by Meta · no delivery report yet", icon: <Check size={14} /> },
  failed: { cls: "failed", label: "Not sent", hint: "Meta refused this message", icon: <X size={14} /> },
  simulated: { cls: "sim", label: "Test only", hint: "Test mode · never left the platform", icon: <FlaskConical size={13} /> },
};

function StatusTag({ m }: { m: WaSentMessage }) {
  const s = STATUS[m.status] ?? { cls: "sent", label: m.status, hint: "", icon: <Check size={14} /> };
  return (
    <span className={`wsm-status wsm-st-${s.cls}`} title={s.hint}>
      {s.icon}
      {s.label}
    </span>
  );
}

/** Meta's raw error JSON -> "(#132018) There's an issue with the parameters… — Param text cannot have new-line…" */
function friendlyError(raw: string): string {
  const msg = raw.match(/"message":"([^"]+)"/)?.[1];
  const details = raw.match(/"details":"([^"]+)"/)?.[1];
  if (!msg) return raw;
  return details ? `${msg} — ${details}` : msg;
}

function clock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

const CAT_ICON: Record<string, LucideIcon> = { utility: Wrench, marketing: Megaphone };

function Message({ m }: { m: WaSentMessage }) {
  const [open, setOpen] = useState(false);
  const text = m.body ?? (m.template ? `Template “${m.template}” — text not recorded for older messages` : "Text not recorded for older messages");
  const lines = text.split(String.fromCharCode(10)).length;
  const long = text.length > 180 || lines > 3;
  const cat = ["utility", "marketing"].includes(m.category) ? m.category : "other";
  const Icon = CAT_ICON[cat] ?? Clock3;
  const ticks = m.status === "read" ? "wsm-tick-read" : m.status === "delivered" ? "wsm-tick-del" : "";

  return (
    <li className={`wsm-card wsm-c-${cat} wsm-s-${STATUS[m.status]?.cls ?? "sent"}`}>
      <span className="wsm-card-icon" aria-hidden><Icon size={17} /></span>

      <div className="wsm-card-main">
        <div className="wsm-card-top">
          <b className="wsm-phone tabular">{phone(m.phone)}</b>
          <span className="wsm-cat-pill" title={ORIGIN[m.category_origin]}>
            {m.category}
            {m.category_origin === "estimated" && <em>est.</em>}
          </span>
          <StatusTag m={m} />
          <span className="wsm-time" title={when(m.created_at)}>{when(m.created_at)}</span>
        </div>

        <div className="wsm-card-sub">
          <span>{SOURCE[m.source] ?? m.source}</span>
          <span>{PURPOSE[m.purpose] ?? m.purpose}</span>
          {m.template && <code>{m.template}</code>}
          {m.ticket_id && <span>Task {m.ticket_id.slice(0, 10)}…</span>}
        </div>

        <div className={`wsm-wa ${m.body ? "" : "wsm-wa-missing"}`}>
          <div className={`wsm-wa-text ${open || !long ? "" : "wsm-wa-clamp"}`}>{text}</div>
          <div className="wsm-wa-meta">
            {long && (
              <button type="button" className="wsm-more" onClick={() => setOpen(!open)}>
                {open ? "Show less" : "Read more"}
              </button>
            )}
            <span className="wsm-wa-time">{clock(m.created_at)}</span>
            {m.status !== "failed" && m.status !== "simulated" && (
              <span className={`wsm-wa-ticks ${ticks}`}>{m.status === "sent" ? <Check size={14} /> : <CheckCheck size={14} />}</span>
            )}
          </div>
        </div>

        {m.status === "failed" && m.error && (
          <div className="wsm-errbox">
            <AlertTriangle size={14} />
            <span>{friendlyError(m.error)}</span>
          </div>
        )}
        {(m.read_at || m.delivered_at) && (
          <div className="wsm-card-foot">
            {m.delivered_at && <span><CheckCheck size={13} /> Delivered {when(m.delivered_at)}</span>}
            {m.read_at && <span className="wsm-read-at"><CheckCheck size={13} /> Read {when(m.read_at)}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export function WaSentMessages() {
  const [category, setCategory] = useUrlState<WaMsgCategoryTab>("cat", "all");
  const [source, setSource] = useUrlState<string>("source", "all");
  const [status, setStatus] = useUrlState<string>("status", "all");
  const [days, setDays] = useUrlState<string>("days", "30");
  const [q, setQ] = useUrlState<string>("q", "");
  const [draft, setDraft] = useState(q);
  const [offset, setOffset] = useState(0);

  // debounce the search box into the URL
  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, setQ]);
  // any filter change goes back to the first page
  useEffect(() => setOffset(0), [category, source, status, days, q]);

  const data = usePoll<WaSentMessagesPage>(
    () => api.whatsapp.sentMessages({ category, source, status, days, q, limit: PAGE, offset }),
    15000,
    [category, source, status, days, q, offset],
  );
  const r = data.data;

  return (
    <div className="wx-page">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker">WhatsApp Agent · Connection</span>
            <h1>Sent Messages</h1>
            <p className="wsm-sub">Every WhatsApp message sent from this platform, split the way Meta bills it.</p>
          </div>
          <div className="wx-banner-tools">
            <div className="wx-pills" role="tablist" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p.key} className={days === p.key ? "on" : ""} onClick={() => setDays(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <button className="wx-ghost wx-square" onClick={data.refresh} title="Refresh" aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="wsm-tabs" role="tablist" aria-label="Category">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={category === t.key}
              className={`wsm-tab wsm-tab-${t.key} ${category === t.key ? "on" : ""}`}
              onClick={() => setCategory(t.key)}
            >
              <span className="wsm-tab-icon"><Icon size={16} /></span>
              <span className="wsm-tab-text">
                <span>{t.label}</span>
                <small>{t.note}</small>
              </span>
              <span className="wsm-tab-nums">
                <b className="tabular">{r ? r.counts[t.key].toLocaleString("en-IN") : "–"}</b>
                {r?.outcomes && (() => {
                  const o = r.outcomes[t.key];
                  const notSent = o.failed + o.unsent;
                  return (
                    <span className="wsm-split">
                      <span className="wsm-ok" title={`${o.ok} sent / delivered / read`}>
                        <i /> {o.ok.toLocaleString("en-IN")} sent
                      </span>
                      <span
                        className={`wsm-bad ${notSent ? "" : "wsm-zero"}`}
                        title={`${o.failed} failed (refused by Meta) · ${o.unsent} not sent (test mode)`}
                      >
                        <i /> {notSent.toLocaleString("en-IN")} not sent
                      </span>
                    </span>
                  );
                })()}
              </span>
            </button>
          );
        })}
      </div>

      <section className="wx-sheet">
        <div className="wsm-filters">
          <label className="wsm-search">
            <Search size={15} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search phone, message text, template or task id"
              aria-label="Search messages"
            />
          </label>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="all">All sources</option>
            <option value="automation">Automation</option>
            <option value="bulk">Bulk</option>
            <option value="manual">Manual</option>
            <option value="welcome">Welcomers</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">Any status</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="read">Read</option>
            <option value="failed">Failed</option>
            <option value="simulated">Simulated</option>
          </select>
        </div>

        <ErrorNote error={data.error} />
        {!r && !data.error && <SkeletonRows rows={8} />}
        {r && r.items.length === 0 && (
          <div className="wx-empty">No messages match these filters.</div>
        )}
        {r && r.items.length > 0 && (
          <>
            <ul className="wsm-list">
              {r.items.map((m) => <Message key={m.id} m={m} />)}
            </ul>
            <div className="wsm-pager">
              <span className="tabular">
                {r.offset + 1}–{r.offset + r.items.length} of {r.total.toLocaleString("en-IN")}
              </span>
              <button type="button" className="wsm-page-btn" disabled={r.offset === 0} onClick={() => setOffset(Math.max(0, r.offset - PAGE))}>
                <ChevronLeft size={15} /> Newer
              </button>
              <button type="button" className="wsm-page-btn" disabled={r.offset + r.items.length >= r.total} onClick={() => setOffset(r.offset + PAGE)}>
                Older <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}
        <p className="wx-foot">
          <Clock3 size={13} /> Category comes from Meta's billing report once it arrives; until then it is the template's
          category, or an estimate (marked “est.”) from the commercials rate card.
        </p>
      </section>
    </div>
  );
}
