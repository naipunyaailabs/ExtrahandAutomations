import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, ChevronDown, ExternalLink, MessageCircle, PhoneCall, PhoneMissed, PhoneOff, Search, Users, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime, fmtDuration, fmtRelative, humanize } from "../format";
import type { Call, EventItem, TaskLocationCandidateHelper, TicketDetail } from "../types";
import { itemVariants } from "./motion";
import { Avatar, Empty, Phone, Pill, toneOf } from "./ui";

/**
 * "Helpers for this task": every helper matched to a task with their WhatsApp alert status, the call status,
 * the key they pressed and their reply. Shared by the task page (Calling) and WhatsApp > Send Work Order.
 */

type Matched = { helpers?: TaskLocationCandidateHelper[]; candidates?: TaskLocationCandidateHelper[]; city?: string | null; service?: string | null } | null | undefined;

type ReplyKind = "accepted" | "declined" | "no_answer" | "live" | "failed" | "queued" | "not_called";

/** WhatsApp alert delivery states from Meta (message ledger). */
const WA_STATUS: Record<string, { label: string; tone: string }> = {
  read: { label: "Read", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Sent", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  simulated: { label: "Test only", tone: "warn" },
};

/** What each key means on the helper call (backend ivr.DIGIT_OUTCOMES["dispatch"]). */
const KEY_MEANING: Record<string, { label: string; tone: string }> = {
  "1": { label: "Accept", tone: "success" },
  "2": { label: "No", tone: "danger" },
  "0": { label: "No", tone: "danger" },
};

const REPLY: Record<ReplyKind, { label: string; tone: string }> = {
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  no_answer: { label: "No answer", tone: "warn" },
  live: { label: "On call now", tone: "live" },
  failed: { label: "Call failed", tone: "danger" },
  queued: { label: "In queue", tone: "info" },
  not_called: { label: "Not called", tone: "neutral" },
};

function replyOf(call: Call | undefined): ReplyKind {
  if (!call) return "not_called";
  if (call.status !== "ended") return "live";
  switch (call.outcome) {
    case "accepted": case "confirmed": return "accepted";
    case "declined": case "rejected": return "declined";
    case "failed": return "failed";
    default: return "no_answer"; // no_answer, busy, no_input, hung_up, missed
  }
}

/** What the helper said or did on a call, in plain words. */
function replyText(call: Call): string {
  if (call.status === "queued") return "Waiting to dial";
  if (call.status === "ringing") return "Phone is ringing…";
  if (call.status === "in_progress" || call.status === "handoff") return "Listening to the task details…";
  switch (call.outcome) {
    case "accepted": case "confirmed": return `Accepted the task`;
    case "declined": case "rejected": return `Said no to the task`;
    case "no_answer": return "Did not pick up";
    case "busy": return "Line was busy";
    case "no_input": return `Picked up but pressed nothing${call.prompts_played ? ` (message played ${call.prompts_played}×)` : ""}`;
    case "hung_up": return "Hung up before replying";
    case "missed": return "Missed the call";
    case "failed": return call.error ? `Call failed: ${call.error}` : "Call failed";
    default: return call.outcome ? humanize(call.outcome) : "Call ended";
  }
}

interface HelperRow {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  distance_km: number | null;
  skills: string[];
  verified: boolean;
  matched: boolean;       // matched now by location + service
  queuePos: number | null; // waiting in the running call queue
  calls: Call[];          // dispatch calls to this helper, newest first
  waAccepted: EventItem | null;
}

type Filter = "all" | "called" | "accepted" | "declined" | "no_answer" | "not_called";

/** Matched helpers merged with dispatch runs, calls and WhatsApp replies; plus the per-status counts. */
export function useHelperRows(t: TicketDetail | null | undefined, matched: Matched) {
  const rows = useMemo<HelperRow[]>(() => {
    if (!t) return [];
    const map = new Map<string, HelperRow>();
    const add = (h: { id: string; name?: string | null; phone?: string | null; city?: string | null; distance_km?: number | null; skills?: string[]; verified?: boolean }) => {
      const cur = map.get(h.id);
      if (cur) {
        cur.name = cur.name || h.name || "";
        cur.phone = cur.phone || h.phone || null;
        cur.city = cur.city || h.city || null;
        cur.distance_km = cur.distance_km ?? h.distance_km ?? null;
        if (!cur.skills.length && h.skills?.length) cur.skills = h.skills;
        cur.verified = cur.verified || !!h.verified;
        return cur;
      }
      const row: HelperRow = {
        id: h.id, name: h.name || "Helper", phone: h.phone || null, city: h.city || null,
        distance_km: h.distance_km ?? null, skills: h.skills ?? [], verified: !!h.verified,
        matched: false, queuePos: null, calls: [], waAccepted: null,
      };
      map.set(h.id, row);
      return row;
    };
    const list: TaskLocationCandidateHelper[] = matched?.helpers ?? matched?.candidates ?? [];
    for (const h of list) {
      add({ id: h.helper_id, name: h.name, phone: h.phone, city: h.city, distance_km: h.distance_km, skills: h.skills, verified: h.is_verified }).matched = true;
    }
    for (const run of t.runs) {
      run.candidates.forEach((c, i) => {
        const row = add({ id: c.helper_id, name: c.name, phone: c.phone, distance_km: c.distance_km, skills: c.skills });
        if (run.status === "running" && i > run.current_index) row.queuePos = i - run.current_index;
      });
    }
    for (const c of t.calls) {
      if (c.purpose !== "dispatch" || !c.helper_id) continue;
      add({ id: c.helper_id, name: c.helper_name, phone: c.phone }).calls.push(c);
    }
    for (const e of t.events) {
      if (e.kind !== "whatsapp_accepted") continue;
      for (const row of map.values()) if (row.name && e.message.includes(row.name)) row.waAccepted = e;
    }
    const rank = (r: HelperRow) => {
      const k = r.waAccepted ? "accepted" : replyOf(r.calls[0]);
      return { live: 0, accepted: 1, queued: 2, declined: 3, no_answer: 4, failed: 5, not_called: 6 }[k === "not_called" && r.queuePos ? "queued" : k];
    };
    for (const r of map.values()) r.calls.sort((a, b) => b.id - a.id);
    return [...map.values()].sort((a, b) => rank(a) - rank(b) || (a.distance_km ?? 999) - (b.distance_km ?? 999) || a.name.localeCompare(b.name));
  }, [t, matched]);

  const waOf = (phone: string | null) => {
    const key = (phone ?? "").replace(/\D/g, "").slice(-10);
    return key ? t?.whatsapp_alerts?.[key] ?? null : null;
  };
  const waSent = rows.filter((r) => { const w = waOf(r.phone); return w && w.status !== "failed"; }).length;
  const kindOf = (r: HelperRow): ReplyKind => (r.waAccepted ? "accepted" : r.calls.length ? replyOf(r.calls[0]) : r.queuePos ? "queued" : "not_called");
  const counts = {
    all: rows.length,
    called: rows.filter((r) => r.calls.length).length,
    accepted: rows.filter((r) => kindOf(r) === "accepted").length,
    declined: rows.filter((r) => kindOf(r) === "declined").length,
    no_answer: rows.filter((r) => ["no_answer", "failed"].includes(kindOf(r))).length,
    not_called: rows.filter((r) => ["not_called", "queued"].includes(kindOf(r))).length,
  };
  return { rows, waOf, waSent, kindOf, counts };
}

interface Props {
  t: TicketDetail;
  matched: Matched;
  /** Extra button(s) per helper row, e.g. Direct Chat on the WhatsApp page. */
  action?: (r: { id: string; name: string; phone: string | null }) => ReactNode;
}

export function TaskHelpersTable({ t, matched, action }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { rows, waOf, waSent, kindOf, counts } = useHelperRows(t, matched);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const k = kindOf(r);
    const ok = filter === "all" ? true
      : filter === "called" ? r.calls.length > 0
      : filter === "no_answer" ? k === "no_answer" || k === "failed"
      : filter === "not_called" ? k === "not_called" || k === "queued"
      : k === filter;
    return ok && (!needle || `${r.name} ${r.phone ?? ""} ${r.city ?? ""} ${r.skills.join(" ")}`.toLowerCase().includes(needle));
  });
  const lastBroadcast = [...t.events].reverse().find((e) => e.kind.startsWith("whatsapp_") && e.kind.includes("broadcast"));

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" }, { key: "called", label: "Called" }, { key: "accepted", label: "Accepted" },
    { key: "declined", label: "Declined" }, { key: "no_answer", label: "No answer" }, { key: "not_called", label: "Not called yet" },
  ];

  return (
    <motion.section variants={itemVariants} className="card td-helpers">
      <header className="td-helpers-head">
        <div>
          <h3><Users size={16} /> Helpers for this task</h3>
          <p className="small muted">
            Matched by <b>location</b> ({matched?.city || t.city || "—"}) and <b>service</b> ({matched?.service || t.category || "—"}).
            {lastBroadcast && <> · <MessageCircle size={12} style={{ verticalAlign: "-2px" }} /> WhatsApp alert sent {fmtRelative(lastBroadcast.created_at)}</>}
          </p>
        </div>
        <div className="td-kpis">
          <div className="td-kpi"><b>{counts.all}</b><span>Matched</span></div>
          <div className="td-kpi tone-success" title="Helpers the WhatsApp task alert reached Meta for"><b>{waSent}</b><span>WhatsApp sent</span></div>
          <div className="td-kpi"><b>{counts.called}</b><span>Called</span></div>
          <div className="td-kpi tone-success"><b>{counts.accepted}</b><span>Accepted</span></div>
          <div className="td-kpi tone-danger"><b>{counts.declined}</b><span>Declined</span></div>
          <div className="td-kpi tone-warn"><b>{counts.no_answer}</b><span>No answer</span></div>
        </div>
      </header>

      {rows.length > 0 && <div className="td-toolbar">
        <div className="td-chips">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`td-chip ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label} <span>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="td-search">
          <Search size={14} />
          <input placeholder="Search helper, phone, skill…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>}

      {!matched && rows.length === 0 ? (
        <div className="td-empty">Finding helpers near this task…</div>
      ) : shown.length === 0 ? (
        <Empty icon={Users}>
          {rows.length === 0
            ? `No helper offers "${t.category ?? "this service"}" in ${t.city ?? "this location"}.`
            : "No helpers match this filter."}
        </Empty>
      ) : (
        <div className="td-table">
          <div className="td-row td-row-head">
            <span>Helper</span><span className="td-dist">Distance</span><span className="td-skills">Skills</span><span className="td-wa">WhatsApp</span><span>Call status</span><span className="td-keys">Pressed key</span><span className="td-reply">Reply</span><span />
          </div>
          {shown.map((r) => {
            const last = r.calls[0];
            const kind = kindOf(r);
            const isOpen = open === r.id;
            return (
              <div key={r.id} className={`td-row-wrap ${isOpen ? "open" : ""} ${t.assignee?.id === r.id ? "assigned" : ""}`}>
                <div className="td-row" role="button" tabIndex={0}
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpen(isOpen ? null : r.id); }}>
                  <span className="td-helper">
                    <Avatar name={r.name} size={32} />
                    <span className="td-helper-text">
                      <span className="td-helper-name">
                        {r.name}
                        {r.verified && <BadgeCheck size={13} className="td-verified" aria-label="Verified" />}
                        {t.assignee?.id === r.id && <span className="td-assigned-tag">Assigned</span>}
                        {!r.matched && <span className="td-old-tag" title="Called earlier; does not match the current location/service filter">earlier</span>}
                      </span>
                      <span className="small muted"><Phone value={r.phone} />{r.city ? ` · ${r.city}` : ""}</span>
                      {action && <span className="td-row-action" onClick={(e) => e.stopPropagation()}>{action(r)}</span>}
                    </span>
                  </span>
                  <span className="td-dist">{r.distance_km != null ? `${r.distance_km} km` : <span className="muted">same city</span>}</span>
                  <span className="td-skills" title={r.skills.join(", ")}>
                    {r.skills.slice(0, 2).map((s) => <span key={s} className="td-skill">{humanize(s)}</span>)}
                    {r.skills.length > 2 && <span className="muted small">+{r.skills.length - 2}</span>}
                  </span>
                  <span className="td-wa">{(() => {
                    const w = waOf(r.phone);
                    if (!w) return <span className="muted small">Not sent</span>;
                    const v = WA_STATUS[w.status] ?? { label: humanize(w.status), tone: "neutral" };
                    return (
                      <>
                        <span className={`pill tone-${v.tone}`} title={w.error ?? undefined}><MessageCircle size={11} />{v.label}</span>
                        <span className="small muted" title={w.error ?? undefined}>{w.error && w.status === "failed" ? (w.error.includes("(401)") ? "Token rejected (401)" : w.error.split(":")[0]) : fmtRelative(w.at)}</span>
                      </>
                    );
                  })()}</span>
                  <span className="td-status">
                    <span className={`pill tone-${REPLY[kind].tone} ${kind === "live" ? "live" : ""}`}>
                      <span className="pill-dot" />{kind === "queued" ? `In queue · #${r.queuePos}` : REPLY[kind].label}
                    </span>
                    {last && <span className="small muted">{fmtRelative(last.created_at)}{r.calls.length > 1 ? ` · ${r.calls.length} calls` : ""}</span>}
                  </span>
                  <span className="td-keys">{(() => {
                    if (!last) return <span className="muted">—</span>;
                    const digits = (last.digits ?? "").split("").filter(Boolean);
                    if (!digits.length) {
                      return <span className="muted small">{kind === "live" ? "Waiting…" : "No key"}</span>;
                    }
                    const k = digits[digits.length - 1];
                    const meaning = KEY_MEANING[k] ?? { label: "Wrong key", tone: "neutral" };
                    return (
                      <>
                        <span className="td-keycaps" title={`Pressed: ${digits.join(", ")}`}>
                          {digits.slice(-3).map((d, i) => <kbd key={i} className="td-keycap">{d}</kbd>)}
                        </span>
                        <span className={`small tone-text-${meaning.tone}`}>{meaning.label}</span>
                      </>
                    );
                  })()}</span>
                  <span className="td-reply">
                    {r.waAccepted ? (
                      <><MessageCircle size={13} /> Accepted on WhatsApp</>
                    ) : last ? (
                      <>
                        {kind === "accepted" ? <Check size={13} /> : kind === "declined" ? <X size={13} /> : kind === "live" ? <PhoneCall size={13} /> : <PhoneMissed size={13} />}
                        <span className="truncate">{replyText(last)}</span>
                      </>
                    ) : (
                      <span className="muted">{r.queuePos ? "Will be called soon" : "—"}</span>
                    )}
                  </span>
                  <span className="td-caret"><motion.span animate={{ rotate: isOpen ? 180 : 0 }} style={{ display: "inline-flex" }}><ChevronDown size={15} /></motion.span></span>
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div key="more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: "hidden" }}>
                      <div className="td-more">
                        {r.calls.length === 0 && !r.waAccepted && (
                          <div className="muted small">
                            {r.queuePos ? `Waiting in the call queue (position ${r.queuePos}).` : "This helper has not been called for this task yet."}
                            {r.skills.length > 0 && <> Skills: {r.skills.map(humanize).join(", ")}.</>}
                          </div>
                        )}
                        {r.waAccepted && (
                          <div className="td-call">
                            <div className="td-call-head"><MessageCircle size={14} /> WhatsApp · {fmtDateTime(r.waAccepted.created_at)}</div>
                            <div className="small">{r.waAccepted.message}</div>
                          </div>
                        )}
                        {r.calls.map((c) => (
                          <div key={c.id} className={`td-call tone-${toneOf(c.outcome ?? c.status)}`}>
                            <div className="td-call-head">
                              {c.status === "ended" ? <PhoneOff size={14} /> : <PhoneCall size={14} />}
                              <span>{fmtDateTime(c.created_at)}</span>
                              {c.duration_seconds ? <span className="muted">· {fmtDuration(c.duration_seconds)}</span> : null}
                              <span className="muted">· {humanize(c.provider)}</span>
                              <Pill value={c.outcome ?? c.status} />
                              <Link to={`/calls/${c.id}`} className="td-call-link" onClick={(e) => e.stopPropagation()}>Call details <ExternalLink size={11} /></Link>
                            </div>
                            <div className="td-call-reply">{replyText(c)}</div>
                            {c.summary && <div className="small"><b>Summary:</b> {c.summary}</div>}
                            {c.transcript && <pre className="td-transcript">{c.transcript}</pre>}
                            {c.error && c.outcome !== "failed" && <div className="small danger-text">{c.error}</div>}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}
