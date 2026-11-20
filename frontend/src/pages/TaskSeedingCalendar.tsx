import { Check, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RotateCcw, Send, Sparkles, Ticket, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ErrorNote, SkeletonRows, useToast } from "../components/ui";
import { usePoll, useUrlState } from "../hooks";
import type { SeedFestivalCalendar, SeedFestivalDay, SeedTemplateLanguage, SeedTemplateView } from "../types";

type Lang = "te" | "hi" | "en";
const LANGS: { key: Lang; label: string }[] = [
  { key: "te", label: "Telugu" },
  { key: "hi", label: "Hindi" },
  { key: "en", label: "English" },
];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SAMPLE_NAME: Record<Lang, string> = { te: "పద్మ", hi: "प्रिया", en: "Priya" };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const nice = (s: string) => parse(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/* ============================================================================================== calendar */

export function FestivalCalendar() {
  const now = new Date();
  const [monthParam, setMonthParam] = useUrlState<string>("month", "");
  const ym = /^\d{4}-\d{2}$/.test(monthParam)
    ? { y: Number(monthParam.slice(0, 4)), m: Number(monthParam.slice(5, 7)) }
    : { y: now.getFullYear(), m: now.getMonth() + 1 };
  const setYm = (next: { y: number; m: number } | ((p: { y: number; m: number }) => { y: number; m: number })) => {
    const v = typeof next === "function" ? next(ym) : next;
    setMonthParam(`${v.y}-${String(v.m).padStart(2, "0")}`);
  };
  const cal = usePoll<SeedFestivalCalendar>(() => api.marketing.seeding.festivals(ym.y, ym.m), 60000, [ym.y, ym.m]);
  const c = cal.data && cal.data.year === ym.y && cal.data.month === ym.m ? cal.data : null;
  const [selId, setSelId] = useState<string | null>(null);
  const sel = c?.festivals.find((f) => f.id === selId) ?? null;

  // pick the next festival of the month that sends a message (or the first one) when the month changes
  useEffect(() => {
    if (!c) return;
    if (selId && c.festivals.some((f) => f.id === selId)) return;
    const next = c.festivals.find((f) => !f.past && f.enabled) ?? c.festivals.find((f) => !f.past) ?? c.festivals[0];
    setSelId(next?.id ?? null);
  }, [c, selId]);

  const move = (d: number) => {
    setSelId(null);
    setYm(({ y, m }) => {
      const n = m + d;
      return n < 1 ? { y: y - 1, m: 12 } : n > 12 ? { y: y + 1, m: 1 } : { y, m: n };
    });
  };

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(ym.y, ym.m, 0).getDate();
    const out: (Date | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) out.push(new Date(ym.y, ym.m - 1, d));
    while (out.length % 7) out.push(null);
    return out;
  }, [ym.y, ym.m]);

  const byDay = useMemo(() => {
    const map: Record<string, SeedFestivalDay[]> = {};
    for (const f of c?.festivals ?? []) {
      for (let d = parse(f.date_start); d <= parse(f.date_end || f.date_start); d.setDate(d.getDate() + 1)) {
        (map[iso(d)] ??= []).push(f);
      }
    }
    return map;
  }, [c]);

  // the panel's dates as they are being edited (before saving), so the shading follows them
  const [draft, setDraft] = useState<{ id: string; from: string; until: string; on: boolean } | null>(null);
  const live = sel && draft?.id === sel.id ? draft : sel ? { id: sel.id, from: sel.sends_from, until: sel.sends_until, on: sel.enabled } : null;
  const inWindow = (d: string) => !!live && live.on && !!live.from && !!live.until && d >= live.from && d <= live.until;
  const counts = { total: c?.festivals.length ?? 0, sending: c?.festivals.filter((f) => f.enabled).length ?? 0 };

  return (
    <section className="tsd-panel tsd-cal-wrap">
      <div className="tsd-panel-head">
        <div>
          <span className="tsd-aside">
            Festivals already registered in the Advertisement festival list · {counts.sending} of {counts.total} this month send a message
          </span>
        </div>
        <div className="tsd-cal-nav">
          <button type="button" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <b>{MONTHS[ym.m - 1]} {ym.y}</b>
          <button type="button" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={16} /></button>
          <button type="button" className="tsd-cal-today" onClick={() => { setSelId(null); setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }); }}>Today</button>
        </div>
      </div>
      <ErrorNote error={cal.error} />
      {c && !c.festival_campaigns && <p className="tsd-mini tsd-warn">Festival campaigns are switched off in the settings: these messages are not sent until it is on.</p>}

      <div className="tsd-cal-body">
        <div className="tsd-cal">
          <div className="tsd-cal-legend">
            <span><i className="tsd-lg-on" /> Sends a message</span>
            <span><i className="tsd-lg-off" /> No message</span>
            <span><i className="tsd-lg-win" /> Days the selected festival's message is sent</span>
          </div>
          <div className="tsd-cal-grid">
            {WEEK.map((w) => <div key={w} className="tsd-cal-wd">{w}</div>)}
            {!c && <div className="tsd-cal-loading"><SkeletonRows rows={5} /></div>}
            {c && cells.map((d, i) => {
              if (!d) return <div key={`x${i}`} className="tsd-cal-day blank" />;
              const key = iso(d);
              const list = byDay[key] ?? [];
              const cls = ["tsd-cal-day", key === c.today ? "today" : "", key < c.today ? "past" : "", inWindow(key) ? "win" : "",
                sel && key >= sel.date_start && key <= (sel.date_end || sel.date_start) ? "sel" : ""].join(" ");
              return (
                <div key={key} className={cls}>
                  <span className="tsd-cal-num">{d.getDate()}</span>
                  {list.slice(0, 3).map((f) => (
                    <button key={f.id} type="button" title={`${f.title} · ${f.region}`}
                      className={`tsd-cal-ev ${f.enabled ? "on" : "off"} ${f.id === selId ? "picked" : ""}`} onClick={() => setSelId(f.id)}>
                      {f.customised && <Sparkles size={10} />}
                      <span>{f.title}</span>
                    </button>
                  ))}
                  {list.length > 3 && <small className="tsd-cal-more">+{list.length - 3} more</small>}
                </div>
              );
            })}
          </div>
          {c && c.festivals.length === 0 && (
            <p className="tsd-mini"><CalendarDays size={12} /> No festival is registered for {MONTHS[ym.m - 1]}. Add festivals in Advertisement → States & Cities.</p>
          )}
        </div>

        <aside className="tsd-side-slot">
          {c && sel ? (
            <FestivalTemplate key={sel.id} f={sel} cal={c} onSaved={cal.refresh} onDraft={setDraft} />
          ) : (
            <div className="tsd-side tsd-side-empty"><CalendarDays size={22} /> Pick a festival in the calendar to set the message sent for it.</div>
          )}
        </aside>
      </div>
    </section>
  );
}

/* ============================================================================================== side panel */

function FestivalTemplate({ f, cal, onSaved, onDraft }: {
  f: SeedFestivalDay; cal: SeedFestivalCalendar; onSaved: () => void;
  onDraft: (d: { id: string; from: string; until: string; on: boolean }) => void;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(f.enabled);
  const [services, setServices] = useState<string[]>(f.services);
  const [promo, setPromo] = useState(f.promo_code);
  const [hooks, setHooks] = useState<Record<Lang, string>>(f.hooks);
  const [from, setFrom] = useState(f.sends_from);
  const [until, setUntil] = useState(f.sends_until);
  const [lang, setLang] = useState<Lang>("te");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setEnabled(f.enabled);
    setServices(f.services);
    setPromo(f.promo_code);
    setHooks(f.hooks);
    setFrom(f.sends_from);
    setUntil(f.sends_until);
  }, [f]);

  const dirty = enabled !== f.enabled || services.join() !== f.services.join() || promo !== f.promo_code || from !== f.sends_from || until !== f.sends_until
    || LANGS.some((l) => hooks[l.key] !== f.hooks[l.key]);
  const badDates = !from || !until || from > until;
  const names = services.map((k) => cal.services.find((s) => s.key === k)).filter(Boolean)
    .map((s) => (lang === "en" ? s!.name : s![lang]));
  const join = { te: " మరియు ", hi: " और ", en: " & " }[lang];
  const svcName = names.length === 0 ? "…" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")}${join}${names[names.length - 1]}`;
  // keep the calendar's order of services; the festival's own suggestion stays first
  const order = cal.services.map((s) => s.key).sort((a, b) => (a === f.suggested_service ? -1 : b === f.suggested_service ? 1 : 0));
  const toggle = (k: string) => setServices((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : order.filter((x) => x === k || cur.includes(x)));
  const fill = (text: string) => text
    .replace(/\{\{\s*1\s*\}\}/g, SAMPLE_NAME[lang])
    .replace(/\{\{\s*2\s*\}\}/g, hooks[lang] || "")
    .replace(/\{\{\s*3\s*\}\}/g, svcName)
    .replace(/\{\{\s*4\s*\}\}/g, f.region === "All-India" ? "Siddipet" : f.region);

  const save = async () => {
    setBusy("save");
    try {
      await api.marketing.seeding.saveFestival(f.id, { enabled, services, promo_code: promo, hooks, send_from: from, send_until: until });
      toast.success("Festival message saved", enabled ? `New customers get it from ${nice(from)} to ${nice(until)}.` : "No message is sent for this festival.");
      await onSaved();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const removeService = async (key: string, name: string) => {
    if (!window.confirm(`Remove "${name}"? Festivals that had it stop mentioning it.`)) return;
    try {
      await api.marketing.seeding.deleteService(key);
      setServices((cur) => cur.filter((x) => x !== key));
      toast.success("Service removed");
      await onSaved();
    } catch (e) {
      toast.error("Could not remove it", (e as Error).message);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      await api.marketing.seeding.resetFestival(f.id);
      toast.success("Back to the automatic message");
      await onSaved();
    } catch (e) {
      toast.error("Could not reset", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => onDraft({ id: f.id, from, until, on: enabled }), [f.id, from, until, enabled, onDraft]);

  // follows the dates being edited, not only the saved ones
  const today = cal.today;
  const when = !enabled ? { tone: "off", text: "No message for this festival" }
    : badDates ? { tone: "bad", text: "Pick a From date on or before the To date" }
      : until < today ? { tone: "off", text: `Sending ended on ${nice(until)}` }
        : from <= today ? { tone: "ok", text: `Sending now · until ${nice(until)}` }
          : { tone: "info", text: `Sends from ${nice(from)} to ${nice(until)}` };
  const unsaved = from !== f.sends_from || until !== f.sends_until;

  return (
    <div className="tsd-side">
      <div className="tsd-side-head">
        <span className="tsd-side-date">
          <b>{parse(f.date_start).getDate()}</b>
          <small>{MONTHS[parse(f.date_start).getMonth()].slice(0, 3)}</small>
        </span>
        <div>
          <h3>{f.title}</h3>
          <small>{f.region} · {f.category || "Festival"} · {f.status}</small>
        </div>
      </div>
      <p className={`tsd-note tsd-${when.tone}`}><i />{when.text}{unsaved && enabled && !badDates && <em className="tsd-unsaved">not saved yet</em>}</p>

      <div className="tsd-side-sec">
        <span className="tsd-side-label">Festival message</span>
        <div className="tsd-onoff" role="radiogroup" aria-label="Festival message">
          <button type="button" role="radio" aria-checked={enabled} className={enabled ? "on" : ""} onClick={() => setEnabled(true)}>
            <i /> On
          </button>
          <button type="button" role="radio" aria-checked={!enabled} className={!enabled ? "off" : ""} onClick={() => setEnabled(false)}>
            <i /> Off
          </button>
        </div>
        {!f.suggested_service && !f.customised && <small className="tsd-side-hint">Not a home-service festival by default: switch it on and choose a service to use it.</small>}
      </div>

      {enabled && (
        <>
          <div className="tsd-side-sec">
            <div className="tsd-side-row">
              <span className="tsd-side-label">Services in this message</span>
              <span className="tsd-quick">
                <button type="button" onClick={() => setServices(order)}>All services</button>
                {f.suggested_service && <button type="button" onClick={() => setServices([f.suggested_service!])}>Only suggested</button>}
              </span>
            </div>
            <div className="tsd-chips">
              {order.map((k) => {
                const s = cal.services.find((x) => x.key === k)!;
                const on = services.includes(k);
                return (
                  <span key={k} className={`tsd-chip-svc ${on ? "on" : ""}`}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(k)} title={s.custom ? `Added service · booking category: ${s.category}` : undefined}>
                      <i>{on && <Check size={11} strokeWidth={3} />}</i>
                      {s.name}
                      {k === f.suggested_service && <small>suggested</small>}
                    </button>
                    {s.custom && (
                      <button type="button" className="tsd-chip-x" aria-label={`Remove ${s.name}`} onClick={() => removeService(k, s.name)}>
                        <X size={12} />
                      </button>
                    )}
                  </span>
                );
              })}
              {!adding && (
                <button type="button" className="tsd-chip-add" onClick={() => setAdding(true)}><Plus size={13} /> Add service</button>
              )}
            </div>
            {adding && <AddService cal={cal} onDone={async (key) => { setAdding(false); if (key) { await onSaved(); setServices((cur) => [...cur, key]); } }} />}
            <small className="tsd-side-hint">Every selected service goes in one message. Each customer only sees the ones ExtraHand has in their area.</small>
          </div>

          <div className="tsd-side-sec">
            <span className="tsd-side-label"><CalendarDays size={12} /> Send dates</span>
            <div className="tsd-dates">
              <label><small>From</small><input type="date" className="tsd-input" value={from} max={until || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <span className="tsd-dates-arrow">→</span>
              <label><small>To</small><input type="date" className="tsd-input" value={until} min={from || undefined} onChange={(e) => setUntil(e.target.value)} /></label>
            </div>
            {badDates
              ? <small className="tsd-side-hint tsd-warn">The first day must be on or before the last day.</small>
              : <small className="tsd-side-hint">Every new customer contacted between these days (on) gets this message; outside them, or when off, they get the regular one. Festival day: {nice(f.date_start)}.</small>}
          </div>

          <label className="tsd-side-sec">
            <span className="tsd-side-label"><Ticket size={12} /> Coupon in the Book Now link</span>
            <input className="tsd-input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="e.g. DIWALI25" maxLength={40} />
          </label>

          <div className="tsd-side-sec">
            <div className="tsd-side-row">
              <span className="tsd-side-label">Festival line</span>
              <div className="tsd-pills sm">
                {LANGS.map((l) => (
                  <button key={l.key} type="button" className={lang === l.key ? "on" : ""} onClick={() => setLang(l.key)}>{l.label}</button>
                ))}
              </div>
            </div>
            <textarea className="tsd-input" rows={2} maxLength={200} value={hooks[lang]}
              onChange={(e) => setHooks((h) => ({ ...h, [lang]: e.target.value.replace(/\n/g, " ") }))} />
            <small className="tsd-side-hint">One line, shown as the second paragraph. Name, service and city are filled in for each customer.</small>
          </div>

          <TemplateEditor lang={lang} setLang={setLang} fallback={cal.template[lang]} fill={fill} />
        </>
      )}

      <div className="tsd-side-actions">
        <button type="button" className="tsd-save" onClick={save} disabled={!dirty || busy !== null || (enabled && (services.length === 0 || badDates))}>
          {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {dirty ? "Save festival message" : "Saved"}
        </button>
        {f.customised && (
          <button type="button" className="tsd-link" onClick={reset} disabled={busy !== null}>
            {busy === "reset" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Back to automatic
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================================== add a service */

function AddService({ cal, onDone }: { cal: SeedFestivalCalendar; onDone: (key: string | null) => void }) {
  const toast = useToast();
  const [en, setEn] = useState("");
  const [te, setTe] = useState("");
  const [hi, setHi] = useState("");
  const [category, setCategory] = useState(cal.categories[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const s = await api.marketing.seeding.addService({ en, te: te || undefined, hi: hi || undefined, category });
      toast.success("Service added", `${s.name} is ticked for this festival. Press Save to keep it.`);
      onDone(s.key);
    } catch (e) {
      toast.error("Could not add it", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tsd-add">
      <div className="tsd-add-head">
        <b>New service</b>
        <button type="button" className="tsd-chip-x" aria-label="Cancel" onClick={() => onDone(null)}><X size={13} /></button>
      </div>
      <input className="tsd-input" placeholder="Name in English, e.g. Sofa cleaning" value={en} maxLength={60} onChange={(e) => setEn(e.target.value)} autoFocus />
      <div className="tsd-add-row">
        <input className="tsd-input" placeholder="Telugu (optional)" value={te} maxLength={60} onChange={(e) => setTe(e.target.value)} />
        <input className="tsd-input" placeholder="Hindi (optional)" value={hi} maxLength={60} onChange={(e) => setHi(e.target.value)} />
      </div>
      <label className="tsd-add-cat">
        <small>Booking category</small>
        <select className="tsd-input tsd-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cal.categories.map((c) => <option key={c.slug} value={c.slug}>{c.label} · {c.bookings} booked</option>)}
        </select>
      </label>
      <small className="tsd-side-hint">Offered only to customers near a past booking of this category; Book Now opens it.</small>
      <button type="button" className="tsd-save" onClick={add} disabled={busy || en.trim().length < 3 || !category}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add service
      </button>
    </div>
  );
}

/* ============================================================================================== the WhatsApp template */

const META_STATE: Record<string, { tone: string; label: string }> = {
  APPROVED: { tone: "ok", label: "Approved by Meta" },
  PENDING: { tone: "wait", label: "In review at Meta" },
  REJECTED: { tone: "bad", label: "Rejected by Meta" },
  PAUSED: { tone: "wait", label: "Paused by Meta" },
  DISABLED: { tone: "bad", label: "Disabled by Meta" },
  NOT_SUBMITTED: { tone: "off", label: "Not sent to Meta" },
};
const FIELDS = [
  { v: "{{1}}", label: "Name" },
  { v: "{{2}}", label: "Festival line" },
  { v: "{{3}}", label: "Services" },
  { v: "{{4}}", label: "City" },
];

function metaOf(x: SeedTemplateLanguage) {
  const base = META_STATE[x.meta.status] ?? { tone: "off", label: x.meta.status };
  return x.meta.changed && x.meta.status !== "NOT_SUBMITTED" ? { tone: "info", label: "Changed · not sent to Meta" } : base;
}

/** The single WhatsApp template every festival uses: preview, its wording per language, and its review at Meta. */
function TemplateEditor({ lang, setLang, fallback, fill }: {
  lang: Lang; setLang: (l: Lang) => void;
  fallback: { body: string; footer: string; button: string };
  fill: (text: string) => string;
}) {
  const toast = useToast();
  const tpl = usePoll<SeedTemplateView>(() => api.marketing.seeding.template(), 30000);
  const [view, setView] = useState<SeedTemplateView | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fallback);
  const [busy, setBusy] = useState<"save" | "reset" | "meta" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (tpl.data) setView(tpl.data); }, [tpl.data]);
  const cur = view?.languages.find((x) => x.language === lang) ?? null;
  const saved = cur ?? { ...fallback };
  useEffect(() => { setEditing(false); }, [lang]);

  const shown = editing ? draft : saved;
  const dirty = editing && (draft.body !== saved.body || draft.footer !== saved.footer || draft.button !== saved.button);
  const missing = FIELDS.filter((x) => !draft.body.includes(x.v));
  const state = cur ? metaOf(cur) : null;
  const canSend = !!cur && !dirty && (cur.meta.status === "NOT_SUBMITTED" || cur.meta.status === "REJECTED"
    || (cur.meta.changed && cur.meta.status !== "PENDING"));

  const startEdit = () => {
    setDraft({ body: saved.body, footer: saved.footer, button: saved.button });
    setEditing(true);
  };
  const insert = (v: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? at;
    setDraft((d) => ({ ...d, body: d.body.slice(0, at) + v + d.body.slice(end) }));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + v.length, at + v.length); });
  };
  const save = async () => {
    setBusy("save");
    try {
      setView(await api.marketing.seeding.saveTemplate(lang, draft));
      setEditing(false);
      toast.success("Template saved", "Send it to Meta: customers get the new wording once Meta approves it.");
    } catch (e) {
      toast.error("Could not save the template", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    if (!window.confirm("Go back to the built-in wording for this language?")) return;
    setBusy("reset");
    try {
      setView(await api.marketing.seeding.resetTemplate(lang));
      setEditing(false);
      toast.success("Built-in wording restored");
    } catch (e) {
      toast.error("Could not reset", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    const name = LANGS.find((l) => l.key === lang)!.label;
    const again = cur?.meta.status !== "NOT_SUBMITTED";
    if (!window.confirm(`Send the ${name} template to Meta for review?${again
      ? "\n\nMeta reviews the change again; until it is approved, customers who read " + name + " get an approved language instead." : ""}`)) return;
    setBusy("meta");
    try {
      const res = await api.marketing.seeding.submitTemplate(lang);
      setView(res.template);
      const r = res.results[lang];
      if (r?.ok) toast.success(r.already ? "Nothing new to send" : "Sent to Meta", r.already ? `Meta status: ${r.status}` : "Meta usually reviews it within minutes to a day.");
      else toast.error("Meta did not accept it", r?.error ?? "Unknown error");
    } catch (e) {
      toast.error("Could not send to Meta", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tsd-side-sec tsd-tpl">
      <div className="tsd-side-row">
        <span className="tsd-side-label">WhatsApp template</span>
        {!editing && (
          <button type="button" className="tsd-link" onClick={startEdit} disabled={!cur}><Pencil size={12} /> Edit wording</button>
        )}
      </div>

      <div className="tsd-tpl-langs">
        {LANGS.map((l) => {
          const x = view?.languages.find((y) => y.language === l.key);
          const s = x ? metaOf(x) : null;
          return (
            <button key={l.key} type="button" className={`tsd-tpl-lang tsd-${s?.tone ?? "off"} ${lang === l.key ? "on" : ""}`} onClick={() => setLang(l.key)}
              title={s?.label}>
              <i /> {l.label}
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="tsd-tpl-edit">
          <div className="tsd-tpl-fields">
            <small>Insert:</small>
            {FIELDS.map((x) => (
              <button key={x.v} type="button" className={draft.body.includes(x.v) ? "" : "missing"} onClick={() => insert(x.v)}>
                <code>{x.v}</code> {x.label}
              </button>
            ))}
          </div>
          <textarea ref={area} className="tsd-input tsd-tpl-body" rows={8} maxLength={1024} value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          <div className="tsd-tpl-count">
            {missing.length > 0
              ? <span className="tsd-warn">Add {missing.map((x) => x.v).join(", ")}: every field must be used once.</span>
              : <span>Each field is filled in for every customer.</span>}
            <span>{draft.body.length}/1024</span>
          </div>
          <label className="tsd-tpl-line">
            <small>Footer <em>{draft.footer.length}/60</em></small>
            <input className="tsd-input" maxLength={60} value={draft.footer} onChange={(e) => setDraft((d) => ({ ...d, footer: e.target.value }))} />
          </label>
          <label className="tsd-tpl-line">
            <small>Button <em>{draft.button.length}/25</em></small>
            <input className="tsd-input" maxLength={25} value={draft.button} onChange={(e) => setDraft((d) => ({ ...d, button: e.target.value }))} />
          </label>
          <div className="tsd-tpl-actions">
            <button type="button" className="tsd-save" onClick={save} disabled={!dirty || missing.length > 0 || !draft.footer.trim() || !draft.button.trim() || busy !== null}>
              {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save wording
            </button>
            <button type="button" className="tsd-link" onClick={() => setEditing(false)} disabled={busy !== null}>Cancel</button>
            {cur?.edited && (
              <button type="button" className="tsd-link" onClick={reset} disabled={busy !== null}><RotateCcw size={12} /> Built-in wording</button>
            )}
          </div>
        </div>
      )}

      <div className="tsd-phone sm">
        <div className="tsd-phone-top"><img src="/extrahand_app_icon_white_bg.png" alt="" /> ExtraHand <small>Verified business</small></div>
        <div className="tsd-phone-msg">
          <div className="tsd-bubble">{fill(shown.body)}<small>{shown.footer}</small></div>
          <div className="tsd-phone-btn">↗ {shown.button}</div>
        </div>
      </div>

      <div className={`tsd-tpl-meta tsd-${state?.tone ?? "off"}`}>
        <div>
          <p className="tsd-note"><i />{tpl.error && !view ? "Could not read Meta's status" : state ? state.label : "Checking Meta…"}</p>
          {cur?.meta.status === "REJECTED" && cur.meta.rejected_reason && <small className="tsd-t-bad">Reason: {cur.meta.rejected_reason}</small>}
          {cur?.meta.status === "PENDING" && cur.meta.changed && <small>Your newer wording can be sent once this review is done.</small>}
          {dirty && <small>Save the wording first, then send it to Meta.</small>}
        </div>
        <button type="button" className="tsd-submit" onClick={send} disabled={!canSend || busy !== null}>
          {busy === "meta" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {cur?.meta.status === "APPROVED" && !cur.meta.changed ? "Approved" : cur?.meta.status === "PENDING" ? "In review" : "Send to Meta"}
        </button>
      </div>
      <small className="tsd-side-hint">One template for every festival, in Telugu, Hindi and English. Customers get it only after Meta approves it.</small>
    </div>
  );
}
