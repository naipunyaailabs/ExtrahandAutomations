/**
 * Shared by the WhatsApp Support pages (Dashboard, Conversations, Support Cases, Settings & Test):
 * routes, the AI on/off switch, the setup warnings and small labels.
 * Backend: backend/whatsapp/support/ (/api/whatsapp/support/*).
 */
import { AlertTriangle, Bot, CheckCircle2, FlaskConical, Loader2, Power } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/ui";
import type { WsHealth, WsSettings } from "../types";
import "./engagement-dash.css";
import "./support.css";

export const SUPPORT_ROUTES = {
  dashboard: "/engagement/support/dashboard",
  conversations: "/engagement/support/conversations",
  cases: "/engagement/support/cases",
  settings: "/engagement/support/settings",
};

export const LANG_SHORT: Record<string, string> = { te: "తె", hi: "हि", en: "EN", "te-latn": "Te", "hi-latn": "Hi" };
export const CASE_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "wait" }, in_progress: { label: "In progress", tone: "info" }, resolved: { label: "Done", tone: "ok" },
};

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

/** The agent's main switch: Off → On (test mode) → On for every customer. */
export function SupportSwitch({ settings, onChange }: { settings: Pick<WsSettings, "active" | "test_mode" | "test_numbers">; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = !settings.active;
    if (next && settings.test_mode && settings.test_numbers.length === 0) {
      toast.warning("Add a test number", "In test mode only test numbers get AI replies. Add yours in Settings & Test.");
    }
    if (next && !settings.test_mode && !window.confirm("Turn on the AI agent for EVERY customer who writes on WhatsApp?")) return;
    setBusy(true);
    try {
      await api.whatsapp.saveSupportSettings({ active: next });
      toast.success(next ? "WhatsApp Support AI is ON" : "WhatsApp Support AI is OFF",
        next ? (settings.test_mode ? "Test mode: only test numbers get AI replies." : "Every customer gets AI replies.") : "No AI replies are sent.");
      onChange();
    } catch (e) {
      toast.error("Could not change", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`ws-switch ${settings.active ? "on" : ""}`}>
      <span className="ws-switch-state">
        <i />
        {settings.active ? (settings.test_mode ? <>AI on · <b>test mode</b></> : <>AI on · <b>all customers</b></>) : "AI off"}
      </span>
      <button className={`cw-btn ${settings.active ? "" : "primary"}`} onClick={toggle} disabled={busy}>
        {busy ? <Loader2 size={13} className="spin" /> : <Power size={13} />} {settings.active ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}

/** What still has to be set up before customers get answers. */
export function HealthWarnings({ health, compact }: { health: WsHealth; compact?: boolean }) {
  const issues: { text: string; fix: string }[] = [];
  if (!health.whatsapp_configured && !health.whatsapp_simulated)
    issues.push({ text: "WhatsApp is not connected", fix: "Set META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN on the server." });
  const seen = health.webhook_last_seen ? new Date(health.webhook_last_seen).getTime() : 0;
  if (!seen || Date.now() - seen > 2 * 86400000)
    issues.push({ text: health.webhook_last_seen ? `Meta's webhook has not reached the server since ${new Date(health.webhook_last_seen).toLocaleDateString("en-IN")}` : "Meta's webhook has never reached the server",
      fix: "In Meta → WhatsApp → Configuration, set the callback URL to https://<backend>/api/whatsapp/webhook and subscribe to messages. Without it no customer message arrives." });
  if (!health.ai_configured)
    issues.push({ text: "The AI is not set up (OPENROUTER_API_KEY)", fix: "Without it the agent still answers, with simple fixed replies." });
  if (!health.extrahand_live)
    issues.push({ text: "ExtraHand data is not live (EXTRAHAND_MODE)", fix: "The agent needs live ExtraHand data to answer about bookings." });
  if (!health.signature_check)
    issues.push({ text: "Webhook signature check is off", fix: "Set META_APP_SECRET so only Meta can post to the webhook." });
  if (!issues.length) return compact ? null : <div className="ws-health ok"><CheckCircle2 size={15} /> Everything is set up.</div>;
  return (
    <div className="ws-health">
      <AlertTriangle size={15} />
      <div>
        <b>{issues.length === 1 ? "One thing to set up" : `${issues.length} things to set up`}</b>
        <ul>{issues.slice(0, compact ? 2 : 5).map((i) => <li key={i.text}><span>{i.text}.</span> {i.fix}</li>)}</ul>
        {compact && <Link to={SUPPORT_ROUTES.settings}>See Settings &amp; Test</Link>}
      </div>
    </div>
  );
}

export function TestsToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="ws-tests">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <FlaskConical size={13} /> Show tester chats
    </label>
  );
}

export function Kicker() {
  return <span className="cw-kicker"><Bot size={13} /> Customer Engagement · WhatsApp Support</span>;
}

/** WhatsApp text: *bold* shown in bold, like on the phone. */
export function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return <>{parts.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}
