/**
 * Shared by the Cancellation Engagement pages (Dashboard, Cancelled Works, Template, Messages & Replies):
 * routes, the follow-up message status tag, and the link from a chart / table row into the Cancelled Works list.
 */
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircleHeart } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { useToast } from "../components/ui";
import type { WaCancelFollowupOverview, WaCancelFollowupRow } from "../types";
import "./cancel-followup.css";
import "./cancellation.css";

export const CANCEL_ROUTES = {
  dashboard: "/engagement/cancellation/dashboard",
  works: "/engagement/cancellation/works",
  template: "/engagement/cancellation/template",
  messages: "/engagement/cancellation/replies", // Message Status was merged into Messages & Replies
  replies: "/engagement/cancellation/replies",
  refunds: "/engagement/refunds",
};

/** Filters the Cancelled Works list understands (all optional), carried in the URL. */
export interface WorksFilter {
  side?: string; from?: string | null; to?: string | null; label?: string; city?: string | null;
  reason?: string | null; category?: string | null; q?: string;
}
export function worksLink(f: WorksFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const qs = p.toString();
  return qs ? `${CANCEL_ROUTES.works}?${qs}` : CANCEL_ROUTES.works;
}

export const MSG_STATUS: Record<string, { label: string; tone: string }> = {
  sending: { label: "Sending", tone: "wait" },
  sent: { label: "Sent", tone: "ok" },
  answered: { label: "Answered", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  no_phone: { label: "No phone", tone: "mute" },
  skipped_repeat: { label: "Skipped: messaged this week", tone: "mute" },
};

/** Where a follow-up message stands: Answered, Read, Delivered, Sent, Failed, or why it was not sent. */
export function msgState(r: WaCancelFollowupRow): { key: string; label: string; tone: string } {
  if (r.status === "sent" && r.delivery === "read") return { key: "read", label: "Read", tone: "ok" };
  if (r.status === "sent" && r.delivery === "delivered") return { key: "delivered", label: "Delivered", tone: "ok" };
  if (r.status === "sent" && r.delivery === "failed") return { key: "failed", label: "Not delivered", tone: "bad" };
  const s = MSG_STATUS[r.status] ?? { label: r.status, tone: "mute" };
  return { key: r.status, ...s };
}

export function StatusTag({ r }: { r: WaCancelFollowupRow }) {
  const s = msgState(r);
  return <span className={`cf-tag ${s.tone}`}>{s.label}</span>;
}

/* ------------------------------------------------------------------ the follow-up on/off switch (Dashboard) */

const fmtWhen = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

/** The Activate / Deactivate switch for the cancellation follow-up message, with whether Meta has approved the
 * template (nothing is sent before that). Starts Inactive. */
export function FollowupSwitch({ data, error, onChanged }: { data: WaCancelFollowupOverview | null; error?: string | null; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!data) {
    // the switch is always shown; it works once the state has loaded
    return (
      <div className={`cx-switch-card ${error ? "error" : ""}`}>
        <span className="cx-switch-icon"><MessageCircleHeart size={18} /></span>
        <div className="cx-switch-text">
          <b>Follow-up message to customers who cancel</b>
          <small>{error
            ? <span className="warn"><AlertTriangle size={11} /> Could not load the switch: {error}</span>
            : <><Loader2 size={11} className="spin" /> Checking whether it is on…</>}</small>
        </div>
        {error
          ? <button className="cw-btn" onClick={onChanged}>Try again</button>
          : <button className="cf-switch" role="switch" aria-checked={false} disabled><i /><span>…</span></button>}
      </div>
    );
  }
  const approved = data.setup.template.status === "APPROVED" && data.setup.flow.status === "PUBLISHED";
  const toggle = async () => {
    setBusy(true);
    try {
      if (data.active) {
        await api.whatsapp.deactivateCancelFollowup();
        toast.success("Follow-up turned off", "No more messages will be sent.");
      } else {
        await api.whatsapp.activateCancelFollowup();
        toast.success("Follow-up turned on", approved ? "Customers who cancel from now on get the message."
          : "It starts sending once Meta approves the template.");
      }
      onChanged();
    } catch (e) {
      toast.error("Could not change the switch", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`cx-switch-card ${data.active ? "on" : ""}`}>
      <span className="cx-switch-icon"><MessageCircleHeart size={18} /></span>
      <div className="cx-switch-text">
        <b>Follow-up message to customers who cancel</b>
        <small>
          {data.active ? <>On since {fmtWhen(data.since)} · only cancellations after that</> : <>Off · nobody is messaged</>}
          {" · "}
          {approved
            ? <span className="ok"><CheckCircle2 size={11} /> Template approved</span>
            : <Link to={CANCEL_ROUTES.template} className="warn"><AlertTriangle size={11} /> Template not approved yet</Link>}
        </small>
      </div>
      <button className={`cf-switch ${data.active ? "on" : ""}`} role="switch" aria-checked={data.active} disabled={busy} onClick={toggle}>
        <i /><span>{busy ? "…" : data.active ? "Active" : "Inactive"}</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ test sends and the Meta webhook */
export function TestTag() {
  return <span className="cx-test" title="Sent from Test mode on the Template page">TEST</span>;
}

/** "Include test messages" switch */
export function TestsSwitch({ on, onChange, count }: { on: boolean; onChange: (v: boolean) => void; count: number }) {
  return (
    <label className="cw-switch cx-tests-switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i /> Include test messages{count ? ` (${count})` : ""}
    </label>
  );
}

/** Warns when Meta's webhook has not reached this backend since the last follow-up was sent: delivery reports,
 * read receipts and customers' replies all arrive that way, so without it everything stays "Sent". */
export function WebhookWarning({ lastSeen, lastSent }: { lastSeen: string | null; lastSent: string | null }) {
  if (!lastSent) return null;
  const seen = lastSeen ? new Date(lastSeen.endsWith("Z") || lastSeen.includes("+") ? lastSeen : `${lastSeen}Z`) : null;
  if (seen && seen.getTime() >= new Date(lastSent).getTime()) return null;
  return (
    <div className="cx-webhook">
      <AlertTriangle size={16} />
      <div>
        <b>Meta's delivery reports and replies are not reaching this server.</b>
        <span>
          {seen ? <>The last one arrived {fmtWhen(seen.toISOString())}, before the latest message was sent.</> : <>None has arrived yet.</>}{" "}
          Until the webhook address in the Meta dashboard points to this backend (…/api/whatsapp/webhook), messages stay
          “Sent” (never Delivered or Read) and customers' replies do not appear here.
        </span>
      </div>
    </div>
  );
}
