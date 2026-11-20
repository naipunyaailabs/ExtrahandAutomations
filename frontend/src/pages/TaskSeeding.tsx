import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarHeart,
  CheckCircle2,
  Clock3,
  Loader2,
  MousePointerClick,
  PhoneCall,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  Sprout,
  Sun,
  UserPlus,
  UserX,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { ErrorNote, SkeletonRows, Toggle, useToast } from "../components/ui";
import { fmtDateTime, fmtRelative, fmtShortDate } from "../format";
import { usePoll, useUrlState } from "../hooks";
import type { SeedConfig, SeedContact, SeedContactsPage, SeedStatus } from "../types";
import { FestivalCalendar } from "./TaskSeedingCalendar";
import "./task-seeding.css";

/* ------------------------------------------------------------------------------------------------ labels */

const META: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Approved by Meta", tone: "ok" },
  PENDING: { label: "Waiting for Meta", tone: "wait" },
  IN_APPEAL: { label: "In appeal", tone: "wait" },
  REJECTED: { label: "Rejected by Meta", tone: "bad" },
  PAUSED: { label: "Paused by Meta", tone: "bad" },
  DISABLED: { label: "Disabled by Meta", tone: "bad" },
  NOT_SUBMITTED: { label: "Not submitted", tone: "off" },
};
const meta = (s: string) => META[s] ?? { label: s, tone: "off" };

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Waiting to send", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  messaged: { label: "Messaged", tone: "info" },
  called: { label: "Called", tone: "info" },
  converted: { label: "First booking", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Skipped", tone: "off" },
  opted_out: { label: "Opted out", tone: "off" },
};
const SKIP: Record<string, string> = {
  already_booked: "Booked before we contacted them",
  no_phone: "No phone number",
  no_service_in_area: "No ExtraHand bookings in their area yet",
  replied_stop: "Replied STOP",
};
const REASON: Record<string, string> = { festival: "Festival", summer: "Summer", regular: "Regular days" };
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting" },
  { key: "messaged", label: "Messaged" },
  { key: "called", label: "Called" },
  { key: "clicked", label: "Clicked" },
  { key: "converted", label: "Booked" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
  { key: "opted_out", label: "Opted out" },
];
const WINDOWS = [7, 30, 90];
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));

/* ============================================================================================== page */

export type SeedSection = "overview" | "calendar" | "settings" | "history";

const SECTIONS: Record<SeedSection, { title: string; sub: string }> = {
  overview: { title: "Task-Seeding Agent", sub: "" },
  calendar: { title: "Festival Calendar", sub: "Your registered festivals. Click one to set the WhatsApp message new customers get before it." },
  settings: { title: "Settings", sub: "When new customers are contacted and on which channel. The WhatsApp message is set in the Festival Calendar." },
  history: { title: "Campaign History", sub: "Every new customer the agent looked at and what happened." },
};

export function TaskSeeding({ section = "overview" }: { section?: SeedSection }) {
  const [days, setDays] = useUrlState<string>("days", "30");
  const st = usePoll<SeedStatus>(() => api.marketing.seeding.status(Number(days) || 30), 15000, [days]);
  const s = st.data;

  return (
    <div className="tsd-page">
      <ErrorNote error={st.error} />
      {!s && !st.error && <div className="tsd-panel"><SkeletonRows rows={8} /></div>}
      {s && section === "overview" && (
        <>
          <Masthead s={s} days={Number(days) || 30} setDays={(d) => setDays(String(d))} refresh={st.refresh} />
          <Readiness s={s} refresh={st.refresh} />
          <SuggestionCard s={s} />
          <p className="tsd-foot">
            Customers come straight from ExtraHand's registrations; bookings come from the synced ExtraHand tasks. Test
            accounts are never contacted. Each person gets at most one WhatsApp and one call, and a <b>STOP</b> reply stops
            everything for that number.
          </p>
        </>
      )}
      {s && section !== "overview" && <SlimHead s={s} section={section} />}
      {s && section === "calendar" && <FestivalCalendar />}
      {s && section === "settings" && (
        <div className="tsd-grid tsd-grid-settings">
          <SettingsCard s={s} refresh={st.refresh} />
        </div>
      )}
      {s && section === "history" && <History />}
    </div>
  );
}

function SlimHead({ s, section }: { s: SeedStatus; section: SeedSection }) {
  const on = s.config.enabled;
  return (
    <header className="tsd-slim">
      <div>
        <span className="tsd-kicker"><Sprout size={13} /> Task-Seeding Agent</span>
        <h1>{SECTIONS[section].title}</h1>
        <p>{SECTIONS[section].sub}</p>
      </div>
      <span className={`tsd-state ${on ? "on" : ""}`}><i /> {on ? "Agent active" : "Agent off"}</span>
    </header>
  );
}

/* ------------------------------------------------------------------------------------------------ masthead */

function Masthead({ s, days, setDays, refresh }: { s: SeedStatus; days: number; setDays: (d: number) => void; refresh: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"toggle" | "run" | null>(null);
  const k = s.kpis;
  const on = s.config.enabled;

  const toggle = async () => {
    setBusy("toggle");
    try {
      await api.marketing.seeding.save({ enabled: !on });
      toast.success(on ? "Task-Seeding Agent switched off" : "Task-Seeding Agent is on",
        on ? "No new messages or calls will go out." : `Customers who register from now on are contacted ${s.config.delay_hours} h later if they have not booked.`);
      await refresh();
    } catch (e) {
      toast.error("Could not change it", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    setBusy("run");
    try {
      await api.marketing.seeding.runNow();
      toast.success("Checked now", "New customers were looked at and due messages sent.");
      await refresh();
    } catch (e) {
      toast.error("Could not run", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const funnel: { icon: typeof UserPlus; label: string; value: string; sub?: string }[] = [
    { icon: UserPlus, label: "Registrations", value: num(k.registrations), sub: "real customers" },
    { icon: UserX, label: "Not booked yet", value: num(k.not_booked), sub: k.registrations ? `${Math.round(100 * (k.not_booked ?? 0) / k.registrations)}% of them` : undefined },
    { icon: Send, label: "Messages sent", value: num(k.messages_sent), sub: `${num(k.messages_delivered)} delivered · ${num(k.messages_read)} read` },
    { icon: PhoneCall, label: "Calls made", value: num(k.calls_made), sub: `${num(k.calls_answered)} answered` },
    { icon: MousePointerClick, label: "Link clicks", value: s.template.clicks_tracked === false ? "—" : num(k.link_clicks), sub: s.template.clicks_tracked === false ? "not tracked" : `${num(k.people_clicked)} people` },
    { icon: ShoppingBag, label: "First bookings", value: num(k.first_bookings), sub: `of ${num(k.contacted)} contacted` },
  ];

  return (
    <header className="tsd-mast">
      <div className="tsd-mast-top">
        <div>
          <span className="tsd-kicker"><Sprout size={13} /> Advertisement Agent · Task Seeding</span>
          <h1>Task-Seeding Agent</h1>
          <p>Turns new customers into first bookings: a WhatsApp in their language {s.config.delay_hours} h after they register, with the right service for their area and season.</p>
        </div>
        <div className="tsd-power">
          <button type="button" className={`tsd-switch ${on ? "on" : ""}`} onClick={toggle} disabled={busy !== null}>
            {busy === "toggle" ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
            {on ? "Active" : "Deactive"}
          </button>
          <span className="tsd-power-sub">
            {on ? <>Since {fmtDateTime(s.config.since)} · checked {s.last_run ? fmtRelative(s.last_run) : "soon"}</> : "Nothing is sent while it is off"}
          </span>
          {on && (
            <button type="button" className="tsd-ghost" onClick={runNow} disabled={busy !== null}>
              {busy === "run" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Check now
            </button>
          )}
        </div>
      </div>

      <div className="tsd-mast-bar">
        <div className="tsd-tabs" role="tablist">
          {WINDOWS.map((d) => (
            <button key={d} role="tab" aria-selected={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
              {days === d && <motion.span layoutId="tsd-tab" className="tsd-tab-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span>Last {d} days</span>
            </button>
          ))}
        </div>
        <button type="button" className="tsd-ghost" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="tsd-funnel">
        {funnel.map((f, i) => (
          <div key={f.label} className="tsd-step" style={{ ["--i" as string]: i }}>
            <span className="tsd-step-ic"><f.icon size={16} /></span>
            <b>{f.value}</b>
            <span className="tsd-step-label">{f.label}</span>
            {f.sub && <small>{f.sub}</small>}
          </div>
        ))}
        <div className="tsd-rate">
          <span>Conversion</span>
          <b>{k.conversion_rate}%</b>
          <small>{num(k.failures)} failed · {num(k.opted_out)} opted out</small>
        </div>
      </div>
      {k.registrations_error && <p className="tsd-mast-warn"><AlertTriangle size={13} /> ExtraHand registrations could not be read: {k.registrations_error}</p>}
    </header>
  );
}

/* ------------------------------------------------------------------------------------------------ readiness */

function Readiness({ s, refresh }: { s: SeedStatus; refresh: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const byLang = Object.fromEntries(s.template.versions.map((v) => [v.language, v]));
  const langs = s.template.drafts.map((d) => ({ ...d, status: byLang[d.language]?.status ?? "NOT_SUBMITTED", reason: byLang[d.language]?.rejected_reason }));
  const canSubmit = langs.some((l) => l.status === "NOT_SUBMITTED" || l.status === "REJECTED");

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.marketing.seeding.submitTemplate();
      const bad = Object.entries(res.results).filter(([, r]) => !r.ok);
      if (bad.length) toast.error("Meta did not accept every version", bad.map(([l, r]) => `${l}: ${r.error}`).join(" · "));
      else toast.success("Sent to Meta for approval", "Meta usually reviews templates within minutes to 24 hours.");
      await refresh();
    } catch (e) {
      toast.error("Could not submit", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const call = s.call;
  const callNote = !s.config.call
    ? { tone: "off", text: "Switched off in the settings" }
    : !call.ready
      ? { tone: "bad", text: call.reason ?? "Not ready" }
      : call.calls_stopped
        ? { tone: "wait", text: "All calls are stopped on the Calling Agent switch" }
        : { tone: "ok", text: `Ready · calls only ${call.hours}` };
  const clicks = s.template.clicks_tracked === true
    ? { tone: "ok", text: "Each Book Now click is counted, then opens ExtraHand" }
    : s.template.link_base
      ? { tone: "wait", text: `Will be counted via ${s.template.link_base} once the template is approved` }
      : { tone: "wait", text: "Not counted: set TASK_SEEDING_LINK_BASE (a fixed https address) before submitting the template" };

  return (
    <section className="tsd-ready">
      <div className="tsd-ready-card">
        <h3>WhatsApp template <code>{s.template.name}</code></h3>
        <div className="tsd-langs">
          {langs.map((l) => {
            const m = meta(l.status);
            return (
              <span key={l.language} className={`tsd-lang tsd-${m.tone}`} title={l.reason ?? m.label}>
                <i /> {l.language_name} <small>{m.label}</small>
              </span>
            );
          })}
        </div>
        {canSubmit ? (
          <button type="button" className="tsd-submit" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit to Meta for approval
          </button>
        ) : (
          <p className="tsd-mini">{s.template.any_approved ? "Each customer gets their own language once approved; English until then." : "Messages start once Meta approves a version."}</p>
        )}
        {s.blocked && <p className="tsd-mini tsd-warn"><Clock3 size={12} /> {s.blocked}</p>}
      </div>
      <div className="tsd-ready-card">
        <h3>Book Now link clicks</h3>
        <p className={`tsd-note tsd-${clicks.tone}`}><i />{clicks.text}</p>
        <h3>Telugu voice call</h3>
        <p className={`tsd-note tsd-${callNote.tone}`}><i />{callNote.text}</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ settings */

function SettingsCard({ s, refresh }: { s: SeedStatus; refresh: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<SeedConfig>(s.config);
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(s.config), [s.config]);
  const dirty = (Object.keys(f) as (keyof SeedConfig)[]).some((k) => k !== "enabled" && k !== "since" && f[k] !== s.config[k]);
  const set = <K extends keyof SeedConfig>(k: K, v: SeedConfig[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { enabled: _e, since: _s, ...rest } = f;
      await api.marketing.seeding.save(rest);
      toast.success("Settings saved");
      await refresh();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tsd-panel">
      <div className="tsd-form">
        <label className="tsd-field">
          <span>First contact after registration</span>
          <div className="tsd-num"><input type="number" min={1} max={168} value={f.delay_hours} onChange={(e) => set("delay_hours", Number(e.target.value))} /> hours</div>
          <small>Only if they have not booked by then.</small>
        </label>
        <div className="tsd-field">
          <span>Channels</span>
          <Toggle checked={f.whatsapp} onChange={(v) => set("whatsapp", v)}>WhatsApp message (Telugu / Hindi / English)</Toggle>
          <Toggle checked={f.call} onChange={(v) => set("call", v)}>Telugu voice call</Toggle>
        </div>
        {f.call && (
          <label className="tsd-field">
            <span>Call when there is no click or booking</span>
            <div className="tsd-num"><input type="number" min={1} max={168} value={f.call_after_hours} onChange={(e) => set("call_after_hours", Number(e.target.value))} /> hours after the message</div>
            <small>Telugu-speaking customers only, once, inside the calling hours.</small>
          </label>
        )}
        <div className="tsd-field">
          <span>Campaigns</span>
          <Toggle checked={f.festival_campaigns} onChange={(v) => set("festival_campaigns", v)}>Festival campaigns (from the festival calendar)</Toggle>
          <Toggle checked={f.seasonal_campaigns} onChange={(v) => set("seasonal_campaigns", v)}>Seasonal campaigns (summer home maintenance)</Toggle>
        </div>
        {f.festival_campaigns && (
          <label className="tsd-field">
            <span>Festival lead time</span>
            <div className="tsd-num"><input type="number" min={1} max={60} value={f.festival_window_days} onChange={(e) => set("festival_window_days", Number(e.target.value))} /> days before the festival</div>
          </label>
        )}
      </div>
      <button type="button" className="tsd-save" onClick={save} disabled={!dirty || saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {dirty ? "Save settings" : "Saved"}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ suggestions */

function SuggestionCard({ s }: { s: SeedStatus }) {
  const fest = s.festivals.filter((f) => f.service);
  return (
    <section className="tsd-panel">
      <div className="tsd-panel-head"><h2>What it suggests</h2><span className="tsd-aside">only services booked in the customer's area</span></div>
      <div className="tsd-rule">
        <span className="tsd-rule-ic"><Sun size={16} /></span>
        <div><b>{s.season.season}</b><small>When no festival is near: <b>{s.season.service}</b></small></div>
      </div>
      <div className="tsd-rule tsd-rule-fest">
        <span className="tsd-rule-ic"><CalendarHeart size={16} /></span>
        <div>
          <b>Festivals</b>
          <small>{s.config.festival_campaigns
            ? <>From <b>{s.config.festival_window_days} days</b> before a festival in their city, state or All-India: that festival's message from the Festival Calendar. {fest.filter((f) => f.in_window).length > 0 ? <>Now: <b>{fest.filter((f) => f.in_window).map((f) => f.title).join(", ")}</b>.</> : "No festival in the window right now."}</>
            : "Festival campaigns are off."}</small>
        </div>
      </div>
      <ol className="tsd-order">
        <li><b>Festival</b> near them (calendar)</li>
        <li><b>Season</b>: March–June home repairs & maintenance</li>
        <li><b>Regular days</b>: bathroom & kitchen cleaning</li>
      </ol>
      <p className="tsd-mini">Each step is used only if ExtraHand has real bookings for that service in the customer's area; otherwise the next one is tried.</p>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ history */

function History() {
  const toast = useToast();
  const [filter, setFilter] = useUrlState<string>("show", "all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const data = usePoll<SeedContactsPage>(() => api.marketing.seeding.contacts(filter, query, page * 50, 50), 20000, [filter, query, page]);
  const p = data.data;

  const retry = async (id: number | "all") => {
    setBusy(id);
    try {
      if (id === "all") {
        const r = await api.marketing.seeding.retryFailed();
        toast.success(r.retrying ? `Retrying ${r.retrying}` : "Nothing to retry", r.retrying ? "They go out on the next check (within a minute)." : undefined);
      } else {
        await api.marketing.seeding.retry(id);
        toast.success("Will retry", "It goes out on the next check (within a minute).");
      }
      await data.refresh();
    } catch (e) {
      toast.error("Could not retry", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="tsd-panel">
      <div className="tsd-panel-head">
        <h2>Campaign history</h2>
        <div className="tsd-tools">
          <label className="tsd-search"><Search size={14} /><input placeholder="Name, phone or city" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {(p?.counts.failed ?? 0) > 0 && (
            <button type="button" className="tsd-ghost dark" onClick={() => retry("all")} disabled={busy !== null}>
              {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry failed ({p?.counts.failed})
            </button>
          )}
        </div>
      </div>
      <div className="tsd-filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => { setFilter(f.key); setPage(0); }}>
            {f.label} <span>{p?.counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <ErrorNote error={data.error} />
      {!p && !data.error && <SkeletonRows rows={6} />}
      {p && p.items.length === 0 && (
        <p className="tsd-empty">{p.counts.all === 0 ? "No customer has been contacted yet. Once it is active, new customers show up here after the waiting time." : "Nobody matches this filter."}</p>
      )}
      {p && p.items.length > 0 && (
        <div className="tsd-table">
          <div className="tsd-row tsd-row-head">
            <span>Customer</span><span>Registered</span><span>Suggestion</span><span>WhatsApp</span><span>Call</span><span>Outcome</span>
          </div>
          {p.items.map((c) => <HistoryRow key={c.id} c={c} busy={busy === c.id} onRetry={() => retry(c.id)} />)}
        </div>
      )}
      {p && p.total > p.limit && (
        <div className="tsd-pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page * p.limit + 1}–{Math.min(p.total, (page + 1) * p.limit)} of {p.total}</span>
          <button disabled={(page + 1) * p.limit >= p.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <span data-label={label}>{children}</span>;
}

function HistoryRow({ c, busy, onRetry }: { c: SeedContact; busy: boolean; onRetry: () => void }) {
  const st = STATUS[c.status] ?? { label: c.status, tone: "off" };
  const canRetry = c.status === "failed" || (c.status === "messaged" && c.call_status === "failed");
  return (
    <div className="tsd-row">
      <Cell label="Customer">
        <b>{c.name || "—"}</b>
        <small>{c.phone} · {c.city || "no city"}{c.language_name ? ` · ${c.language_name}` : ""}</small>
      </Cell>
      <Cell label="Registered"><b>{fmtShortDate(c.registered_at)}</b><small>{fmtRelative(c.registered_at)}</small></Cell>
      <Cell label="Suggestion">
        {c.service_name ? (<><b>{c.service_name}</b><small>{c.reason === "festival" ? c.event_title : REASON[c.reason ?? ""]}{c.promo_code ? ` · ${c.promo_code}` : ""}</small></>) : <small>—</small>}
      </Cell>
      <Cell label="WhatsApp">
        {c.wa_status ? (<><b className={`tsd-t-${c.wa_status === "failed" ? "bad" : c.wa_status === "read" ? "ok" : "info"}`}>{c.wa_status}</b>
          <small>{c.wa_error ? c.wa_error : `${fmtRelative(c.wa_sent_at)}${c.wa_language ? ` · ${c.wa_language}` : ""}`}</small></>)
          : <small>{c.status === "pending" && c.wa_error ? c.wa_error : "—"}</small>}
      </Cell>
      <Cell label="Call">
        {c.call_status ? (<><b className={`tsd-t-${c.call_status === "failed" ? "bad" : c.call_status === "completed" ? "ok" : "info"}`}>{c.call_status}</b>
          <small>{c.call_error ? c.call_error : `${fmtRelative(c.call_at)}${c.call_duration ? ` · ${c.call_duration}s` : ""}`}</small></>) : <small>—</small>}
      </Cell>
      <Cell label="Outcome">
        <span className={`tsd-chip tsd-${st.tone}`}>{st.label}</span>
        <small>
          {c.status === "converted" ? `${c.converted_category ?? "booking"} · ${fmtRelative(c.converted_at)}`
            : c.skip_reason ? SKIP[c.skip_reason] ?? c.skip_reason
              : c.clicks ? `Clicked Book Now ${c.clicks}×` : ""}
        </small>
        {canRetry && (
          <button type="button" className="tsd-retry" onClick={onRetry} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retry
          </button>
        )}
      </Cell>
    </div>
  );
}
