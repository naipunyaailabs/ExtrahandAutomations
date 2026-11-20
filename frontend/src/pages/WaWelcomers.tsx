import {
  ArrowRight,
  CheckCheck,
  Clock3,
  Eye,
  HandHeart,
  Loader2,
  Phone,
  Play,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Square,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ErrorNote, SkeletonRows, useToast } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type {
  WaAudience,
  WaWelcomeOutcome,
  WaWelcomerCommercials as Report,
  WaWelcomerDay,
  WaWelcomerDetail,
  WaTemplateVersion,
  WaWelcomerFigures,
  WaWelcomerHistory,
  WaWelcomerPeople,
} from "../types";
import "./wa-commercials.css";
import "./wa-welcomers.css";

const COPY: Record<WaAudience, { title: string; who: string; whoPlural: string; icon: typeof HandHeart; sample: string }> = {
  helper: { title: "Helper Welcomer", who: "helper", whoPlural: "helpers", icon: HandHeart, sample: "Sita" },
  customer: { title: "Customer Welcomer", who: "customer", whoPlural: "customers", icon: UserRoundPlus, sample: "Ravi" },
};

const inr = (x: number) => "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toDate(iso: string): Date {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return toDate(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - toDate(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return when(iso);
}

function phone(p: string | null): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return "No phone";
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

const OUTCOME: Record<WaWelcomeOutcome, { label: string; tone: string }> = {
  welcomed: { label: "Welcome sent", tone: "sent" },
  delivered: { label: "Delivered", tone: "delivered" },
  read: { label: "Read", tone: "read" },
  failed: { label: "Failed", tone: "failed" },
  welcomer_off: { label: "Welcomer was off", tone: "off" },
  no_phone: { label: "No phone", tone: "warn" },
  pending: { label: "Sending soon", tone: "warn" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "sent", label: "Welcomed" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
  { key: "welcomer_off", label: "Welcomer off" },
  { key: "no_phone", label: "No phone" },
  { key: "pending", label: "Sending soon" },
];

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 31 days" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/* ============================================================================ pipeline: registered -> read */

function Pipeline({ d, who }: { d: WaWelcomerDay; who: string }) {
  const pct = (n: number) => (d.registered ? Math.round((n / d.registered) * 100) : 0);
  const steps = [
    { label: `${who} registered`, n: d.registered, tone: "reg", icon: UserRoundPlus, sub: `${d.with_phone} with a phone` },
    { label: "Welcome sent", n: d.welcomed, tone: "sent", icon: Send, sub: `${pct(d.welcomed)}% of registered` },
    { label: "Delivered", n: d.delivered, tone: "delivered", icon: CheckCheck, sub: `${pct(d.delivered)}% of registered` },
    { label: "Read", n: d.read, tone: "read", icon: Eye, sub: `${pct(d.read)}% of registered` },
  ];
  const missed = d.welcomer_off + d.no_phone + d.failed + d.pending;
  return (
    <div className="wwl-pipe">
      <div className="wwl-pipe-steps">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="wwl-pipe-cell">
              <div className={`wwl-pipe-step wwl-t-${s.tone}`}>
                <span className="wwl-pipe-icon"><Icon size={16} /></span>
                <b className="tabular">{s.n.toLocaleString("en-IN")}</b>
                <span className="wwl-pipe-label">{s.label}</span>
                <small>{s.sub}</small>
                <i className="wwl-pipe-fill" style={{ width: `${i === 0 ? 100 : pct(s.n)}%` }} />
              </div>
              {i < steps.length - 1 && <ArrowRight size={16} className="wwl-pipe-arrow" aria-hidden />}
            </div>
          );
        })}
      </div>
      <div className="wwl-missed">
        <span className="wwl-missed-total"><b className="tabular">{missed.toLocaleString("en-IN")}</b> not welcomed</span>
        <span className="wwl-chip wwl-t-off">{d.welcomer_off} welcomer was off</span>
        <span className="wwl-chip wwl-t-warn">{d.no_phone} no phone</span>
        <span className="wwl-chip wwl-t-failed">{d.failed} failed</span>
        {d.pending > 0 && <span className="wwl-chip wwl-t-warn">{d.pending} sending soon</span>}
      </div>
    </div>
  );
}

/* ============================================================================ people: everyone who registered */

function People({ audience, day, setDay, anchor }: {
  audience: WaAudience;
  day: string;
  setDay: (d: string) => void;
  anchor: React.RefObject<HTMLElement>;
}) {
  const c = COPY[audience];
  const [status, setStatus] = useState("all");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => setOffset(0), [audience, day, status, q]);

  const data = usePoll<WaWelcomerPeople>(
    () => api.whatsapp.welcomerPeople(audience, { day, status, q, offset, limit: LIMIT }),
    30000,
    [audience, day, status, q, offset],
  );
  const r = data.data;

  return (
    <section className="wx-sheet" ref={anchor}>
      <div className="wx-sheet-head">
        <span className="wx-num">03</span>
        <h2>Everyone who registered</h2>
        <span className="wx-sheet-aside wx-aside">live from ExtraHand · last 31 days</span>
      </div>

      <div className="wwl-people-tools">
        <div className="wwl-filters" role="tablist" aria-label="Filter by outcome">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={status === f.key}
              className={status === f.key ? "on" : ""}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
              <span className="tabular">{r ? (r.counts[f.key as keyof typeof r.counts] ?? 0).toLocaleString("en-IN") : "–"}</span>
            </button>
          ))}
        </div>
        <div className="wwl-people-row">
          <label className="wwl-search">
            <Search size={15} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search name, phone or city" aria-label="Search people" />
          </label>
          {day && (
            <button type="button" className="wwl-daychip" onClick={() => setDay("")} title="Show all days">
              {dayLabel(day)} <X size={13} />
            </button>
          )}
        </div>
      </div>

      <ErrorNote error={data.error} />
      {!r && !data.error && <SkeletonRows rows={8} />}
      {r && r.items.length === 0 && (
        <div className="wx-empty">No {c.whoPlural} match{day ? ` on ${dayLabel(day)}` : ""}.</div>
      )}
      {r && r.items.length > 0 && (
        <>
          <ul className="wwl-people">
            {r.items.map((p) => {
              const o = OUTCOME[p.status];
              return (
                <li key={p.user_id} className="wwl-person">
                  <span className={`wwl-avatar wwl-t-${o.tone}`}>{initials(p.name)}</span>
                  <div className="wwl-person-main">
                    <b>{p.name || "Unnamed"}</b>
                    <span className="wwl-person-meta">
                      <Phone size={12} /> <span className="tabular">{phone(p.phone)}</span>
                      {p.city && <> · {p.city}</>}
                    </span>
                  </div>
                  <div className="wwl-person-time">
                    <span>Registered</span>
                    <b className="tabular">{when(p.registered_at)}</b>
                  </div>
                  <div className="wwl-person-time">
                    <span>Welcomed</span>
                    <b className="tabular">{p.welcomed_at ? when(p.welcomed_at) : "—"}</b>
                  </div>
                  <div className="wwl-person-status">
                    <span className={`wwl-chip wwl-t-${o.tone}`}>{o.label}</span>
                    {p.error && <small title={p.error}>{p.error}</small>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="wsm-pager wwl-pager">
            <span className="tabular">{r.offset + 1}–{r.offset + r.items.length} of {r.total.toLocaleString("en-IN")}</span>
            <button type="button" className="wsm-page-btn" disabled={r.offset === 0} onClick={() => setOffset(Math.max(0, r.offset - LIMIT))}>Newer</button>
            <button type="button" className="wsm-page-btn" disabled={r.offset + r.items.length >= r.total} onClick={() => setOffset(r.offset + LIMIT)}>Older</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ============================================================================ Helper / Customer Welcomer */

export function WaWelcomer({ audience }: { audience: WaAudience }) {
  const c = COPY[audience];
  const Icon = c.icon;
  const toast = useToast();
  const detail = usePoll<WaWelcomerDetail>(() => api.whatsapp.welcomer(audience), 15000, [audience]);
  const history = usePoll<WaWelcomerHistory>(() => api.whatsapp.welcomerHistory(audience), 60000, [audience]);
  const [busy, setBusy] = useState<"toggle" | "check" | "refresh" | "telugu" | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("today");
  const [day, setDay] = useState("");
  const peopleRef = useRef<HTMLElement>(null);
  const w = detail.data;
  const h = history.data;

  useEffect(() => {
    setDay("");
    setLang(null);
  }, [audience]);

  const submitTelugu = async () => {
    setBusy("telugu");
    try {
      const res = await api.whatsapp.submitWelcomerTelugu(audience);
      if (res.already) toast.info("Already at Meta", `The Telugu version is ${res.status.toLowerCase()}.`);
      else toast.success("Sent to Meta for approval", "Meta usually reviews templates within a few minutes to 24 hours.");
      await detail.refresh();
    } catch (e) {
      toast.error("Meta did not accept it", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async () => {
    if (!w) return;
    setBusy("toggle");
    try {
      if (w.active) {
        await api.whatsapp.deactivateWelcomer(audience);
        toast.info(`${c.title} deactivated`, "No more welcome messages will be sent.");
      } else {
        await api.whatsapp.activateWelcomer(audience);
        toast.success(`${c.title} activated`, `Every new ${c.who} who registers from now on gets the welcome message.`);
      }
      await Promise.all([detail.refresh(), history.refresh()]);
    } catch (e) {
      toast.error("Could not update", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const checkNow = async () => {
    setBusy("check");
    try {
      const res = await api.whatsapp.checkWelcomersNow();
      const n = res[audience] ?? 0;
      toast.info("Checked ExtraHand", n ? `${n} new ${c.who}(s) welcomed.` : `No new ${c.who} registrations since the last check.`);
      await Promise.all([detail.refresh(), history.refresh()]);
    } catch (e) {
      toast.error("Check failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refreshHistory = async () => {
    setBusy("refresh");
    try {
      await api.whatsapp.welcomerHistory(audience, true);
      await history.refresh();
    } finally {
      setBusy(null);
    }
  };

  const openDay = (d: string) => {
    setDay(d);
    peopleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const maxDay = Math.max(1, ...(h?.daily ?? []).map((d) => d.registered));
  const p = h?.periods;

  return (
    <div className="wx-page">
      {/* ---------------------------------------------------------------- banner */}
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Icon size={13} /> WhatsApp Agent · Welcomers</span>
            <h1>{c.title}</h1>
            <p className="wwl-sub">
              Every new {c.who} who registers on ExtraHand automatically gets the{" "}
              <code>{w?.template ?? `extrahand_${audience}_welcome`}</code> WhatsApp message
              {w?.sending_language_name ? <> in <b>{w.sending_language_name}</b></> : null}.
            </p>
          </div>
          <div className="wx-banner-tools">
            {w && (
              <button type="button" className={`wwl-switch ${w.active ? "on" : "off"}`} onClick={toggle} disabled={busy !== null}>
                {busy === "toggle" ? <Loader2 size={14} className="animate-spin" /> : w.active ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                {w.active ? "Active · Deactivate" : "Deactive · Activate"}
              </button>
            )}
            <button className="wx-ghost" onClick={checkNow} disabled={busy !== null || !w?.active} title="Look for new registrations now">
              {busy === "check" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check now
            </button>
          </div>
        </div>

        {p && (
          <div className="wx-figures wwl-figures">
            <div><span>Registered today</span><b>{p.today.registered}</b><em>{p.today.welcomed} welcomed</em></div>
            <div><span>This week</span><b>{p.week.registered}</b><em>{p.week.welcomed} welcomed</em></div>
            <div><span>This month</span><b>{p.month.registered.toLocaleString("en-IN")}</b><em>{p.month.welcomed} welcomed</em></div>
            <div><span>Welcomed in total</span><b>{w?.total ?? 0}</b><em>{w?.failed ? `${w.failed} failed` : "one message per person"}</em></div>
          </div>
        )}

        <div className="wx-banner-foot">
          {w?.active ? (
            <span><i className="wx-live" /> Listening — checks ExtraHand every {w.check_every_seconds ?? 60}s · last check {ago(w.last_check)}</span>
          ) : (
            <span><i className="wwl-paused" /> Paused — new {c.whoPlural} are not welcomed until you click Activate</span>
          )}
          {w?.active && w.since && <span>Active since {when(w.since)} · only {c.whoPlural} who register after this are welcomed</span>}
        </div>
      </header>

      <ErrorNote error={detail.error || history.error || (h?.error ? `ExtraHand: ${h.error}` : null)} />
      {(!w || !h) && !detail.error && !history.error && <div className="wx-sheet"><SkeletonRows rows={8} /></div>}

      {w && h && p && (
        <>
          {/* ---------------------------------------------------------------- 01 process */}
          <section className="wx-sheet">
            <div className="wx-sheet-head">
              <span className="wx-num">01</span>
              <h2>Welcome process</h2>
              <div className="wx-sheet-aside wwl-seg" role="tablist" aria-label="Period">
                {RANGES.map((x) => (
                  <button key={x.key} role="tab" aria-selected={range === x.key} className={range === x.key ? "on" : ""} onClick={() => setRange(x.key)}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            <Pipeline d={p[range]} who={c.who[0].toUpperCase() + c.who.slice(1)} />
          </section>

          {/* ---------------------------------------------------------------- 02 daily history + preview */}
          <div className="wwl-split">
            <section className="wx-sheet">
              <div className="wx-sheet-head">
                <span className="wx-num">02</span>
                <h2>Day by day</h2>
                <span className="wx-sheet-aside wx-aside">
                  updated {ago(h.fetched_at)}
                  <button type="button" className="wx-link" onClick={refreshHistory} disabled={busy !== null} style={{ marginLeft: 8 }}>
                    {busy === "refresh" ? "Refreshing…" : "Refresh"}
                  </button>
                </span>
              </div>
              <div className="wwl-table-wrap wwl-days-wrap">
                <table className="wx-ledger wwl-days">
                  <thead>
                    <tr><th>Day</th><th>Registered</th><th>Welcomed</th><th>Read</th><th>Not welcomed</th><th aria-label="Open" /></tr>
                  </thead>
                  <tbody>
                    {h.daily.map((d) => {
                      const missed = d.welcomer_off + d.no_phone + d.failed + d.pending;
                      return (
                        <tr key={d.date} className={`${d.registered ? "" : "wwl-zero"} ${day === d.date ? "wwl-picked" : ""}`} onClick={() => d.registered && openDay(d.date)}>
                          <td>{dayLabel(d.date)}</td>
                          <td className="tabular">
                            <span className="wwl-daybar"><i style={{ width: `${(d.registered / maxDay) * 100}%` }} /><i className="w" style={{ width: `${(d.welcomed / maxDay) * 100}%` }} /></span>
                            <b>{d.registered}</b>
                          </td>
                          <td className="tabular">{d.welcomed}</td>
                          <td className="tabular">{d.read}</td>
                          <td className={`tabular ${d.failed ? "wx-bad" : ""}`}>{missed}</td>
                          <td>{d.registered > 0 && <span className="wx-link">View</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <TemplateCard w={w} lang={lang} setLang={setLang} sample={c.sample} busy={busy === "telugu"} onSubmitTelugu={submitTelugu} />
          </div>

          {/* ---------------------------------------------------------------- 03 people */}
          <People audience={audience} day={day} setDay={setDay} anchor={peopleRef} />
        </>
      )}
    </div>
  );
}

/* ============================================================================ Template (Telugu / English) */

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Approved by Meta", tone: "ok" },
  PENDING: { label: "Waiting for Meta approval", tone: "wait" },
  IN_APPEAL: { label: "In appeal at Meta", tone: "wait" },
  REJECTED: { label: "Rejected by Meta", tone: "bad" },
  PAUSED: { label: "Paused by Meta", tone: "bad" },
  DISABLED: { label: "Disabled by Meta", tone: "bad" },
  NOT_SUBMITTED: { label: "Not submitted to Meta yet", tone: "off" },
};
const statusOf = (s: string) => STATUS_LABEL[s] ?? { label: s, tone: "off" };

function TemplateCard({ w, lang, setLang, sample, busy, onSubmitTelugu }: {
  w: WaWelcomerDetail;
  lang: string | null;
  setLang: (l: string) => void;
  sample: string;
  busy: boolean;
  onSubmitTelugu: () => void;
}) {
  const versions = w.template_versions ?? [];
  const te = versions.find((v) => v.language === "te");
  // Telugu always comes first: the real version at Meta, or the draft that is not submitted yet
  const tabs: WaTemplateVersion[] = [
    te ?? {
      language: "te", language_name: "Telugu", status: "NOT_SUBMITTED", body: w.telugu_draft ?? "",
      button: w.telugu_button ?? null, category: null, rejected_reason: null, has_image: true,
    },
    ...versions.filter((v) => v.language !== "te"),
  ];
  const current = tabs.find((v) => v.language === (lang ?? "te")) ?? tabs[0];
  const st = statusOf(current.status);
  const fill = (t: string) => t.replace(/\{\{\s*1\s*\}\}/g, sample);
  const canSubmit = !te || te.status === "REJECTED";
  const note =
    current.language === w.sending_language
      ? "This is the version being sent now."
      : current.status === "APPROVED"
        ? "Approved, but not used while the Telugu version is approved."
        : current.language === "te" && w.sending_language_name
          ? `Until it is approved, people get the ${w.sending_language_name} version.`
          : "Not being sent.";

  return (
    <section className="wx-sheet">
      <div className="wx-sheet-head">
        <h2>Message they receive</h2>
        <span className="wx-sheet-aside wx-aside">Marketing template</span>
      </div>

      <div className="wwl-lang-tabs" role="tablist" aria-label="Template language">
        {tabs.map((v) => {
          const s = statusOf(v.status);
          return (
            <button key={v.language} type="button" role="tab" aria-selected={current.language === v.language}
              className={current.language === v.language ? "on" : ""} onClick={() => setLang(v.language)}>
              <span>{v.language_name}</span>
              <i className={`wwl-dot wwl-${s.tone}`} title={s.label} />
            </button>
          );
        })}
      </div>

      <div className={`wwl-meta-status wwl-${st.tone}`}>
        <b>{st.label}</b>
        <span>{note}</span>
        {current.rejected_reason && <em>Reason: {current.rejected_reason.replace(/_/g, " ").toLowerCase()}</em>}
      </div>

      <div className="wwl-phone">
        <div className="wwl-phone-top"><img src="/extrahand_app_icon_white_bg.png" alt="" /> ExtraHand <small>Verified business</small></div>
        <div className="wwl-phone-msg">
          {current.has_image && <img src="/extrahand_whatsapp_header.jpg" alt="ExtraHand header" />}
          <div className="wwl-bubble">{fill(current.body) || "Template text is loaded from Meta…"}</div>
          {current.button && <div className="wwl-phone-btn">↗ {current.button}</div>}
        </div>
      </div>

      {current.language === "te" && canSubmit && (
        <button type="button" className="wwl-submit" onClick={onSubmitTelugu} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {te?.status === "REJECTED" ? "Resubmit Telugu version to Meta" : "Submit Telugu version to Meta"}
        </button>
      )}
      <p className="wx-foot"><Clock3 size={13} /> Sent about a minute after registration, once per person. Test accounts are skipped.</p>
    </section>
  );
}

/* ============================================================================ Welcomer Commercials */

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function Row({ label, f }: { label: string; f: WaWelcomerFigures }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="tabular">{f.sent}</td>
      <td className="tabular">{f.delivered} <small>{f.delivery_rate}%</small></td>
      <td className="tabular">{f.read} <small>{f.read_rate}%</small></td>
      <td className={`tabular ${f.failed ? "wx-bad" : ""}`}>{f.failed}</td>
      <td className="tabular">{f.sent ? inr(f.cost_per_welcome) : "—"}</td>
      <td className="tabular"><b>{inr(f.cost)}</b></td>
    </tr>
  );
}

export function WaWelcomerCommercials() {
  const [period, setPeriod] = useUrlState<PeriodKey>("period", "month");
  const data = usePoll<Report>(api.whatsapp.welcomerCommercials, 60000);
  const r = data.data;
  const p = r?.periods[period];
  const max = Math.max(1, ...(r?.daily ?? []).map((d) => d.helper + d.customer));

  return (
    <div className="wx-page">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Receipt size={13} /> WhatsApp Agent · Welcomers</span>
            <h1>Welcomer Commercials</h1>
            <p className="wwl-sub">Usage and Meta charges of the Helper and Customer welcome messages only.</p>
          </div>
          <div className="wx-banner-tools">
            <div className="wx-pills" role="tablist" aria-label="Period">
              {PERIODS.map((x) => (
                <button key={x.key} className={period === x.key ? "on" : ""} onClick={() => setPeriod(x.key)}>{x.label}</button>
              ))}
            </div>
            <button className="wx-ghost wx-square" onClick={data.refresh} title="Refresh" aria-label="Refresh"><RefreshCw size={14} /></button>
          </div>
        </div>
        {p && (
          <div className="wx-figures wwl-figures">
            <div><span>Welcomes sent</span><b>{p.total.sent}</b><em>{p.helper.sent} helpers · {p.customer.sent} customers</em></div>
            <div><span>Delivered</span><b>{p.total.delivery_rate}%</b><em>{p.total.delivered} messages</em></div>
            <div><span>Read</span><b>{p.total.read_rate}%</b><em>of delivered</em></div>
            <div><span>Cost</span><b>{inr(p.total.cost)}</b><em>{p.total.sent ? `${inr(p.total.cost_per_welcome)} per welcome` : "nothing sent"}</em></div>
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
                <thead><tr><th>Welcomer</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th><th>Per welcome</th><th>Cost</th></tr></thead>
                <tbody>
                  <Row label="Helper Welcomer" f={p.helper} />
                  <Row label="Customer Welcomer" f={p.customer} />
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
            <div className="wwl-bars" role="img" aria-label="Welcome messages per day, last 30 days">
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
