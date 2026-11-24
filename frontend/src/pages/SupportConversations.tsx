import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, Bot, CheckCheck, CircleSlash, Hand, Loader2, MessagesSquare, Phone, RotateCcw, Search, Send, UserRound,
  X, XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/ui";
import { usePoll } from "../hooks";
import type { WsBooking, WsConversation, WsConversationDetail, WsMessage } from "../types";
import { Skeleton, fmtTime, n } from "./EngagementKit";
import { CASE_STATUS, Kicker, LANG_SHORT, SUPPORT_ROUTES, SupportSwitch, TestsToggle, WaText, ago } from "./SupportShared";

/** Customer Engagement → WhatsApp Support → Conversations: every customer chat with the AI agent, live. Open one to
 * read it, see the customer's bookings, take over and reply yourself, hand back to the AI or close it. */

type Filter = "all" | "ai" | "human" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Open" }, { key: "ai", label: "AI answering" }, { key: "human", label: "With a person" }, { key: "closed", label: "Closed" },
];
const ME_KEY = "ws-team-name";

export function SupportConversationsPage() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [tests, setTests] = useState(false);
  const settings = usePoll(api.whatsapp.supportSettings, 30000);
  const list = usePoll<WsConversation[]>(() => api.whatsapp.supportConversations({
    status: filter === "closed" ? "closed" : "open", mode: filter === "ai" || filter === "human" ? filter : undefined,
    q: q || undefined, includeTests: tests,
  }), 8000, [filter, q, tests]);
  const picked = Number(params.get("c")) || null;
  const pick = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("c", String(id)); else p.delete("c");
    setParams(p, { replace: true });
  };
  const rows = list.data ?? [];

  return (
    <div className="cw-page ws-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <Kicker />
            <h1>Conversations</h1>
            <p>Customers chatting with the AI agent on WhatsApp. Open a chat to read it, take over and reply, or hand it back to the AI.</p>
          </div>
          <div className="cw-head-tools">
            {settings.data && <SupportSwitch settings={settings.data} onChange={settings.refresh} />}
          </div>
        </div>
      </header>

      <div className={`ws-inbox ${picked ? "has-chat" : ""}`}>
        <aside className="ws-list">
          <div className="ws-list-tools">
            <label className="ws-search"><Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search conversations" />
            </label>
            <div className="ws-tabs" role="tablist">
              {FILTERS.map((f) => (
                <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>{f.label}</button>
              ))}
            </div>
            <TestsToggle on={tests} set={setTests} />
          </div>
          {!list.data ? (
            <div className="ws-list-empty"><Loader2 size={16} className="spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="ws-list-empty"><MessagesSquare size={22} /><b>No conversations</b><span>When customers write on WhatsApp, their chats appear here.</span></div>
          ) : (
            <ul>
              {rows.map((c, i) => (
                <motion.li key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}>
                  <button className={`ws-row ${picked === c.id ? "on" : ""}`} onClick={() => pick(c.id)}>
                    <span className={`ws-ava ${c.mode}`}>{(c.customer_name || "?").trim().charAt(0).toUpperCase()}</span>
                    <span className="ws-row-main">
                      <span className="ws-row-top">
                        <b>{c.customer_name || `+${c.phone}`}</b>
                        <small>{ago(c.last_message_at)}</small>
                      </span>
                      <span className="ws-row-msg">
                        {c.last_message?.sender === "ai" && <Bot size={12} />}
                        {c.last_message?.sender === "human" && <UserRound size={12} />}
                        {c.last_message?.text ?? ""}
                      </span>
                      <span className="ws-row-tags">
                        {c.language && <em className="lang" title={c.language_label ?? ""}>{LANG_SHORT[c.language] ?? c.language}</em>}
                        {c.mode === "human" && <em className="team">With {c.assigned_to || "a person"}</em>}
                        {c.waiting_yes && <em className="wait">Waiting for YES</em>}
                        {c.is_test && <em className="test">Test</em>}
                        {c.last_intent_label && c.last_intent !== "other" && <em>{c.last_intent_label}</em>}
                      </span>
                    </span>
                    {c.messages_since_reply > 0 && c.mode === "human" && <span className="ws-unread">{c.messages_since_reply}</span>}
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </aside>
        <AnimatePresence mode="wait">
          {picked ? <Chat key={picked} id={picked} onClose={() => pick(null)} onChange={list.refresh} /> : (
            <div className="ws-nochat"><MessagesSquare size={34} /><b>Pick a conversation</b><span>The chat and the customer's bookings open here.</span></div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Chat({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const data = usePoll<WsConversationDetail>(() => api.whatsapp.supportConversation(id), 6000, [id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(() => { try { return localStorage.getItem(ME_KEY) ?? ""; } catch { return ""; } });
  const end = useRef<HTMLDivElement>(null);
  const count = data.data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [count]);
  const remember = (v: string) => { setMe(v); try { localStorage.setItem(ME_KEY, v); } catch { /* private mode */ } };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); data.refresh(); onChange(); } catch (e) { toast.error("Could not do that", (e as Error).message); } finally { setBusy(false); }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const m = await api.whatsapp.supportReply(id, text.trim(), me || undefined);
      if (m.status === "failed") toast.error("Not delivered", m.error ?? "WhatsApp refused the message.");
      setText("");
      data.refresh(); onChange();
    } catch (err) {
      toast.error("Could not send", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const c = data.data;
  return (
    <motion.section className="ws-chat-wrap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      {!c ? (
        data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Opening the chat…</>} />
      ) : (
        <>
          <div className="ws-chat">
            <header className="ws-chat-head">
              <span className={`ws-ava big ${c.mode}`}>{(c.customer_name || "?").trim().charAt(0).toUpperCase()}</span>
              <div>
                <b>{c.customer_name || "Unknown customer"}</b>
                <small><Phone size={11} /> +{c.phone}{c.language_label ? ` · ${c.language_label}` : ""}{c.is_test ? " · tester chat" : ""}</small>
              </div>
              <span className={`ws-mode ${c.mode}`}>{c.status === "closed" ? "Closed" : c.mode === "ai" ? <><Bot size={12} /> AI answering</> : <><UserRound size={12} /> {c.assigned_to || "A person"} answering</>}</span>
              <div className="ws-chat-actions">
                {c.mode === "ai" ? (
                  <button className="cw-btn" disabled={busy} onClick={() => act(() => api.whatsapp.supportTakeover(id, me || undefined), "You took over. The AI is paused.")}><Hand size={13} /> Take over</button>
                ) : (
                  <button className="cw-btn" disabled={busy} onClick={() => act(() => api.whatsapp.supportHandback(id), "Handed back to the AI")}><Bot size={13} /> Hand back to AI</button>
                )}
                {c.status !== "closed" && <button className="cw-btn" disabled={busy} onClick={() => act(() => api.whatsapp.supportClose(id), "Conversation closed")}><CheckCheck size={13} /> Close</button>}
                <button className="cw-btn ws-x" onClick={onClose} aria-label="Close the chat"><X size={14} /></button>
              </div>
            </header>
            <div className="ws-msgs">
              {c.messages.map((m, i) => <Bubble key={m.id} m={m} prev={c.messages[i - 1]} />)}
              <div ref={end} />
            </div>
            <form className="ws-compose" onSubmit={send}>
              {!c.window_open && !c.is_test && (
                <p className="ws-compose-note"><CircleSlash size={12} /> The customer last wrote more than 24 hours ago: WhatsApp will not deliver a free reply now.</p>
              )}
              <div className="ws-compose-row">
                <input className="ws-me" value={me} onChange={(e) => remember(e.target.value)} placeholder="Your name" aria-label="Your name" />
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={c.mode === "ai" ? "Type to take over and reply…" : "Type your reply…"}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(e as unknown as FormEvent); } }} />
                <button className="cw-btn primary" disabled={busy || !text.trim()} aria-label="Send">{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}</button>
              </div>
            </form>
          </div>
          <CustomerPane c={c} />
        </>
      )}
    </motion.section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  confirm_cancel: "Asked to confirm cancel", confirm_reschedule: "Asked to confirm reschedule", cancel_request: "Cancel request sent to team",
  reschedule_request: "Reschedule request sent to team", create_ticket: "Support case created", handover: "Handed to a person",
  declined: "Customer said NO", not_possible: "Not possible", ask_booking: "Asked which booking",
};

function Bubble({ m, prev }: { m: WsMessage; prev?: WsMessage }) {
  if (m.sender === "system") return <div className="ws-sys">{m.text} · {fmtTime(m.created_at)}</div>;
  const mine = m.direction === "out";
  const first = !prev || prev.sender !== m.sender;
  return (
    <motion.div className={`ws-bubble-row ${mine ? "out" : "in"}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className={`ws-bubble ${m.sender} ${first ? "first" : ""}`}>
        {first && mine && <span className="ws-who">{m.sender === "ai" ? <><Bot size={11} /> AI agent</> : <><UserRound size={11} /> {m.author || "Team"}</>}</span>}
        <p><WaText text={m.text} /></p>
        <span className="ws-meta">
          {m.action && m.action !== "none" && <em className="act">{ACTION_LABEL[m.action] ?? m.action}</em>}
          {m.sender === "customer" && m.intent_label && m.intent !== "other" && <em>{m.intent_label}</em>}
          {m.status === "failed" && <em className="bad" title={m.error ?? ""}><XCircle size={10} /> not delivered</em>}
          {m.error && m.sender === "ai" && <em className="bad" title={m.error}>fixed reply (AI unavailable)</em>}
          {fmtTime(m.created_at)}
          {mine && m.status === "sent" && <CheckCheck size={12} />}
        </span>
      </div>
    </motion.div>
  );
}

function CustomerPane({ c }: { c: WsConversationDetail }) {
  const cu = c.customer;
  return (
    <aside className="ws-pane">
      <h4><UserRound size={14} /> Customer</h4>
      {!cu.found ? (
        <p className="ws-empty">No ExtraHand account or booking for this number.</p>
      ) : (
        <dl className="ws-kv">
          <div><dt>Name</dt><dd>{cu.customer?.name ?? c.customer_name ?? "—"}</dd></div>
          {cu.customer?.city && <div><dt>City</dt><dd>{cu.customer.city}</dd></div>}
          {cu.customer?.member_since && <div><dt>Customer since</dt><dd>{cu.customer.member_since}</dd></div>}
          <div><dt>Bookings</dt><dd>{n(cu.total_bookings)}</dd></div>
        </dl>
      )}
      {cu.error && <p className="ws-empty warn">{cu.error}</p>}
      {cu.bookings.length > 0 && (
        <>
          <h4>Bookings <small>as of {cu.as_of}</small></h4>
          <ul className="ws-bookings">{cu.bookings.slice(0, 6).map((b) => <BookingCard key={b.booking_id} b={b} />)}</ul>
        </>
      )}
      <h4>Support cases</h4>
      {c.cases.length === 0 ? <p className="ws-empty">None from this chat.</p> : (
        <ul className="ws-cases-mini">
          {c.cases.map((k) => (
            <li key={k.id}>
              <span>#{k.id} {k.category_label}</span>
              <em className={`ws-tag ${CASE_STATUS[k.status]?.tone}`}>{CASE_STATUS[k.status]?.label}</em>
            </li>
          ))}
        </ul>
      )}
      <Link className="cx-link" to={SUPPORT_ROUTES.cases}>All support cases <ArrowRight size={13} /></Link>
    </aside>
  );
}

function BookingCard({ b }: { b: WsBooking }) {
  const st = (b.status ?? "").toLowerCase();
  const tone = /cancel|expired|reject/.test(st) ? "bad" : /complet|done|closed/.test(st) ? "ok" : "info";
  return (
    <li className="ws-booking">
      <div className="ws-booking-top"><b>{b.service || b.category || "Service"}</b><em className={`ws-tag ${tone}`}>{(b.status ?? "—").replace(/_/g, " ")}</em></div>
      <small>{[b.scheduled_date, b.scheduled_time].filter(Boolean).join(" · ") || (b.booked_on ? `Booked ${b.booked_on}` : "")}</small>
      <small>
        {b.amount_rupees ? `₹${b.amount_rupees.toLocaleString("en-IN")}` : ""}{b.payment_status ? ` · ${b.payment_status}` : ""}
        {b.helper_name ? ` · ${b.helper_name}` : b.helper_assigned === false ? " · no helper yet" : ""}
      </small>
      {b.refund && <small className={b.refund.refunded ? "ok" : ""}><RotateCcw size={10} /> {b.refund.refunded ? `Refunded${b.refund.amount_rupees ? ` ₹${b.refund.amount_rupees}` : ""}${b.refund.refunded_on ? ` on ${b.refund.refunded_on}` : ""}` : "No refund recorded"}</small>}
      <code>{b.booking_ref || b.booking_id}</code>
    </li>
  );
}
