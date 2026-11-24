import { motion } from "framer-motion";
import {
  Bell, Bot, CheckCircle2, CircleSlash, FlaskConical, Loader2, Phone, Plus, RotateCcw, Send, ShieldCheck, X, XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useToast } from "../components/ui";
import { usePoll } from "../hooks";
import type { WsMessage, WsSettings } from "../types";
import { CardHead, Skeleton, fmtTime } from "./EngagementKit";
import { HealthWarnings, Kicker, SupportSwitch, WaText } from "./SupportShared";

/** Customer Engagement → WhatsApp Support → Settings & Test: the switches, the test numbers, what is set up, the
 * agent's rules, and a chat tester that talks to the real agent with a customer's real data (nothing is sent). */

export function SupportSettingsPage() {
  const s = usePoll<WsSettings>(api.whatsapp.supportSettings, 20000);
  if (!s.data) {
    return <div className="cw-page ws-page">{s.error ? <div className="cw-error">{s.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Loading…</>} />}</div>;
  }
  const d = s.data;
  return (
    <div className="cw-page ws-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <Kicker />
            <h1>Settings &amp; Test</h1>
            <p>Turn the agent on, choose who gets AI replies, and try it here with a customer's real data before customers see it.</p>
          </div>
          <div className="cw-head-tools"><SupportSwitch settings={d} onChange={s.refresh} /></div>
        </div>
      </header>

      <div className="ws-settings-grid">
        <div className="ws-settings-col">
          <Switches d={d} onChange={s.refresh} />
          <section className="cw-card">
            <CardHead icon={ShieldCheck} title="Setup check" />
            <ul className="ws-checks">
              <Check ok={d.health.whatsapp_configured || d.health.whatsapp_simulated} label="WhatsApp connected" note={d.health.whatsapp_simulated ? "simulated (WHATSAPP_SIMULATED)" : undefined} />
              <Check ok={!!d.health.webhook_last_seen && Date.now() - new Date(d.health.webhook_last_seen).getTime() < 2 * 86400000}
                label="Meta webhook reaching the server" note={d.health.webhook_last_seen ? `last seen ${new Date(d.health.webhook_last_seen).toLocaleString("en-IN")}` : "never"} />
              <Check ok={d.health.signature_check} label="Webhook signature check" note={d.health.signature_check ? "META_APP_SECRET set" : "set META_APP_SECRET"} />
              <Check ok={d.health.ai_configured} label="AI model" note={d.health.ai_configured ? d.health.ai_model : "no OPENROUTER_API_KEY: fixed replies"} />
              <Check ok={d.health.extrahand_live} label="Live ExtraHand data" note={d.health.extrahand_live ? "bookings, helpers, payments, refunds" : "EXTRAHAND_MODE is not live"} />
            </ul>
            <HealthWarnings health={d.health} />
          </section>
          <Rules />
        </div>
        <Tester testNumbers={d.test_numbers} />
      </div>
    </div>
  );
}

function Check({ ok, label, note }: { ok: boolean; label: string; note?: string }) {
  return <li className={ok ? "ok" : "bad"}>{ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<span>{label}</span>{note && <small>{note}</small>}</li>;
}

function Switches({ d, onChange }: { d: WsSettings; onChange: () => void }) {
  const toast = useToast();
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (body: Partial<Omit<WsSettings, "health">>, ok: string) => {
    setBusy(true);
    try { await api.whatsapp.saveSupportSettings(body); toast.success(ok); onChange(); } catch (e) { toast.error("Could not save", (e as Error).message); } finally { setBusy(false); }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const digits = num.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a 10-digit number"); return; }
    void save({ test_numbers: [...d.test_numbers, digits] }, "Test number added");
    setNum("");
  };
  return (
    <section className="cw-card">
      <CardHead icon={Bot} title="Who gets AI replies" />
      <div className="ws-toggle-row">
        <div><b>Test mode</b><small>Only the test numbers below get AI replies. Turn off to answer every customer.</small></div>
        <button className={`ws-toggle ${d.test_mode ? "on" : ""}`} role="switch" aria-checked={d.test_mode} disabled={busy}
          onClick={() => {
            if (d.test_mode && !window.confirm("Turn off test mode? Every customer who writes will get AI replies (when the agent is on).")) return;
            void save({ test_mode: !d.test_mode }, d.test_mode ? "Test mode off: all customers" : "Test mode on");
          }}><i /></button>
      </div>
      <div className="ws-numbers">
        {d.test_numbers.map((p) => (
          <span key={p} className="ws-number"><Phone size={11} /> +{p}
            <button aria-label={`Remove +${p}`} onClick={() => save({ test_numbers: d.test_numbers.filter((x) => x !== p) }, "Test number removed")}><X size={11} /></button>
          </span>
        ))}
        <form onSubmit={add} className="ws-number-add">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Add test number" inputMode="tel" aria-label="Test number" />
          <button className="cw-btn" disabled={busy}><Plus size={13} /></button>
        </form>
      </div>
      <div className="ws-toggle-row">
        <div><b><Bell size={13} /> Alert the care team</b><small>Send a WhatsApp to Care Team members (with a phone) when a new case is created.</small></div>
        <button className={`ws-toggle ${d.notify_care ? "on" : ""}`} role="switch" aria-checked={d.notify_care} disabled={busy}
          onClick={() => save({ notify_care: !d.notify_care }, d.notify_care ? "Care alerts off" : "Care alerts on")}><i /></button>
      </div>
    </section>
  );
}

function Rules() {
  const can = ["Answer about the customer's own bookings, dates, amounts, helper and payment / refund status",
    "Reply in Telugu, Hindi or English, also in English letters, the way the customer writes",
    "Take a cancel or reschedule request, only after the customer replies YES",
    "Record complaints (helper, payment, unfinished work, refund requests) as support cases",
    "Hand the chat to a person when asked, when the customer is upset, or when it cannot help"];
  const cannot = ["Show another customer's data (only bookings of the number that wrote)",
    "Cancel, reschedule, refund or approve anything by itself: the team does that in ExtraHand",
    "Invent payment or refund details, or share helpers' phone numbers"];
  return (
    <section className="cw-card">
      <CardHead icon={ShieldCheck} title="What the agent does" />
      <ul className="ws-rules">{can.map((t) => <li key={t} className="ok"><CheckCircle2 size={14} /> {t}</li>)}</ul>
      <ul className="ws-rules">{cannot.map((t) => <li key={t} className="no"><CircleSlash size={14} /> {t}</li>)}</ul>
    </section>
  );
}

const SAMPLES = ["Hi", "Naa booking status enti?", "मेरी बुकिंग कब है?", "Helper raaledu", "I want to cancel my booking", "Refund eppudu vastundi?", "Talk to a person"];
const ACTION_LABEL: Record<string, string> = {
  confirm_cancel: "asks YES to cancel", confirm_reschedule: "asks YES to reschedule", cancel_request: "cancel request → case",
  reschedule_request: "reschedule request → case", create_ticket: "support case created", handover: "handed to a person",
  declined: "customer said NO", not_possible: "not possible", ask_booking: "asked which booking",
};

function Tester({ testNumbers }: { testNumbers: string[] }) {
  const toast = useToast();
  const [phone, setPhone] = useState(testNumbers[0]?.slice(-10) ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<WsMessage[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const valid = phone.replace(/\D/g, "").length >= 10;
  const load = async () => {
    if (!valid) { setMsgs([]); return; }
    try { setMsgs((await api.whatsapp.supportTestHistory(phone)).messages); } catch { setMsgs([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [phone]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, busy]);

  const send = async (t: string) => {
    if (!valid || !t.trim()) return;
    setBusy(true);
    setMsgs((m) => [...m, { id: -Date.now(), direction: "in", sender: "customer", text: t, status: null, language: null, intent: null,
      intent_label: null, action: null, error: null, author: null, llm_ms: null, llm_cost: null, created_at: new Date().toISOString() }]);
    setText("");
    try {
      const r = await api.whatsapp.supportTestChat(phone, t.trim());
      if (r.skipped === "human") toast.info("A person has this chat", "Hand it back to the AI in Conversations, or press Reset.");
      await load();
    } catch (e) {
      toast.error("The agent failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!valid) return;
    await api.whatsapp.supportTestReset(phone);
    setMsgs([]);
  };

  return (
    <section className="cw-card ws-tester">
      <CardHead icon={FlaskConical} title="Try the agent" note="the real agent and data · nothing is sent on WhatsApp" />
      <div className="ws-tester-top">
        <label className="ws-search"><Phone size={14} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Chat as customer number…" inputMode="tel" aria-label="Customer number" />
        </label>
        <button className="cw-btn" onClick={reset} disabled={!valid}><RotateCcw size={13} /> Reset</button>
      </div>
      <div className="ws-phone">
        <div className="ws-phone-head"><span className="ws-ava ai"><Bot size={14} /></span><div><b>ExtraHand Support</b><small>{busy ? "typing…" : "AI agent"}</small></div></div>
        <div className="ws-phone-body">
          {!valid && <p className="ws-empty center">Enter a customer's phone number to chat as them.</p>}
          {valid && msgs.length === 0 && <p className="ws-empty center">Say hi, or pick a sample below.</p>}
          {msgs.map((m) => m.sender === "system" ? <div key={m.id} className="ws-sys">{m.text}</div> : (
            <motion.div key={m.id} className={`ws-bubble-row ${m.direction === "out" ? "out" : "in"}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div className={`ws-bubble ${m.sender}`}>
                <p><WaText text={m.text} /></p>
                <span className="ws-meta">
                  {m.sender === "customer" && m.language && <em>{m.language}</em>}
                  {m.sender === "customer" && m.intent_label && <em>{m.intent_label}</em>}
                  {m.action && m.action !== "none" && <em className="act">{ACTION_LABEL[m.action] ?? m.action}</em>}
                  {m.sender === "ai" && m.llm_ms ? <em>{(m.llm_ms / 1000).toFixed(1)}s</em> : null}
                  {m.error && <em className="bad" title={m.error}>fixed reply</em>}
                  {fmtTime(m.created_at)}
                </span>
              </div>
            </motion.div>
          ))}
          {busy && <div className="ws-bubble-row out"><div className="ws-bubble ai typing"><i /><i /><i /></div></div>}
          <div ref={end} />
        </div>
        <div className="ws-samples">{SAMPLES.map((t) => <button key={t} disabled={!valid || busy} onClick={() => send(t)}>{t}</button>)}</div>
        <form className="ws-phone-compose" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type as the customer…" disabled={!valid} aria-label="Message" />
          <button className="cw-btn primary" disabled={!valid || busy || !text.trim()} aria-label="Send"><Send size={14} /></button>
        </form>
      </div>
    </section>
  );
}
