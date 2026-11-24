import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileText, FlaskConical, Hourglass, Info, Loader2, MessageCircleHeart,
  MessageSquareWarning, RefreshCw, Rocket, Send, ShieldCheck, X, XCircle,
} from "lucide-react";
import { useState, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/ui";
import { usePoll } from "../hooks";
import type { WaCancelFollowupOverview, WaCancelFollowupRow } from "../types";
import { CANCEL_ROUTES } from "./CancellationShared";
import { CardHead, Skeleton, fmtDate, fmtTime } from "./EngagementKit";
import "./cancellation.css";
import "./cancel-followup.css";

/** Cancellation Engagement → Template: the WhatsApp "what went wrong?" message (English + Telugu, with the
 * customer's name) and its reason form, whether Meta has approved them, and Test mode (send the real message to
 * your own number and watch it get delivered, read and answered). The on/off switch is on the Cancellation
 * Dashboard. Backend: backend/whatsapp/cancel_followup.py. */

type Tone = "good" | "wait" | "bad" | "idle";
/** Meta's status in plain words, with what it means for sending */
const META: Record<string, { label: string; tone: Tone; icon: ElementType; means: string }> = {
  APPROVED: { label: "Approved", tone: "good", icon: CheckCircle2, means: "Meta approved it. It can be sent." },
  PUBLISHED: { label: "Published", tone: "good", icon: CheckCircle2, means: "The form is live in WhatsApp." },
  PENDING: { label: "In review", tone: "wait", icon: Hourglass, means: "Meta is reviewing it. This usually takes minutes, sometimes a few hours." },
  IN_APPEAL: { label: "In appeal", tone: "wait", icon: Hourglass, means: "An appeal is being reviewed by Meta." },
  DRAFT: { label: "Draft", tone: "wait", icon: Clock3, means: "Created but not published yet. Run “Set up in Meta” again." },
  REJECTED: { label: "Rejected", tone: "bad", icon: XCircle, means: "Meta rejected it. Change the text and set it up again." },
  PAUSED: { label: "Paused", tone: "bad", icon: XCircle, means: "Meta paused it after low ratings from customers." },
  DISABLED: { label: "Disabled", tone: "bad", icon: XCircle, means: "Meta disabled it." },
  NOT_CREATED: { label: "Not set up", tone: "idle", icon: Info, means: "Not in Meta yet. Click “Set up in Meta”." },
  UNKNOWN: { label: "Unknown", tone: "idle", icon: Info, means: "Could not ask Meta right now. Try again." },
};
const meta = (s: string) => META[s] ?? { label: s, tone: "idle" as Tone, icon: Info, means: "" };
const LANGS: Record<string, string> = { en: "English", en_US: "English (US)", te: "Telugu" };

/** WhatsApp's *bold* and line breaks, with {{1}} / {{2}} filled in with the name */
function WaText({ text, name }: { text: string; name: string }) {
  const filled = text.replace(/\{\{[12]\}\}/g, name || "{{name}}");
  return (
    <>
      {filled.split("\n").map((line, i) => (
        <span key={i} className="cf-line">
          {line.split(/(\*[^*]+\*)/g).map((part, j) => (part.startsWith("*") && part.endsWith("*") && part.length > 2
            ? <b key={j}>{part.slice(1, -1)}</b> : <span key={j}>{part}</span>))}
          {line === "" && <br />}
        </span>
      ))}
    </>
  );
}

export function CancellationTemplatePage() {
  const toast = useToast();
  const data = usePoll<WaCancelFollowupOverview>(api.whatsapp.cancelFollowup, 15000);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("Priya");
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("");
  const d = data.data;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: [string, string?]) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok[0], ok[1]);
      await data.refresh();
    } catch (e) {
      toast.error("Could not do that", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!d) {
    return (
      <div className="cw-page cf-page">
        {data.error ? <div className="cw-error">{data.error}</div> : <Skeleton note={<><Loader2 size={15} className="spin" /> Asking Meta about the template…</>} />}
      </div>
    );
  }

  const t = meta(d.setup.template.status);
  const f = meta(d.setup.flow.status);
  const ready = d.setup.ready;
  const needsSetup = ["NOT_CREATED", "DRAFT", "DEPRECATED"].includes(d.setup.flow.status)
    || ["NOT_CREATED", "REJECTED"].includes(d.setup.template.status);
  const overall: { label: string; tone: Tone; icon: ElementType; text: string } = ready
    ? { label: "Approved", tone: "good", icon: ShieldCheck, text: "Meta approved the message and the form. It can be sent." }
    : t.tone === "bad" || f.tone === "bad" ? { label: "Needs a fix", tone: "bad", icon: XCircle, text: "Meta did not accept it. See below." }
      : t.tone === "wait" || f.tone === "wait" ? { label: "Waiting for Meta", tone: "wait", icon: Hourglass, text: "Sent to Meta for review. Nothing goes out until it is approved." }
        : { label: "Not set up", tone: "idle", icon: Info, text: "The message is not in Meta yet. Set it up to send it for approval." };
  const O = overall.icon;
  const tests = d.recent.filter((r) => r.is_test);
  const bodyLen = d.template.body.length;

  return (
    <div className="cw-page cf-page">
      <header className="cw-banner">
        <div className="cw-banner-top">
          <div>
            <span className="cw-kicker"><MessageCircleHeart size={13} /> Cancellation Engagement</span>
            <h1>Cancellation Template</h1>
            <p>The WhatsApp message customers who cancel get, asking what went wrong, with a short form for the reason.</p>
          </div>
          <div className={`ct-badge ${overall.tone}`}>
            <O size={22} />
            <span><b>{overall.label}</b><small>{overall.text}</small></span>
          </div>
        </div>
        <div className="ct-banner-foot">
          <Link className={`cx-chip ${d.active ? "on" : ""}`} to={CANCEL_ROUTES.dashboard}>
            <i /> Sending is {d.active ? "on" : "off"} · switch it on the Cancellation Dashboard →
          </Link>
          <span className="ct-checked">Checked with Meta {d.setup.checked_at ? fmtTime(d.setup.checked_at) : "just now"} · every 15 seconds on this page</span>
        </div>
      </header>

      {/* approval status */}
      <section className="cw-card">
        <CardHead icon={ShieldCheck} title="Approval status">
          <div className="ct-actions">
            {needsSetup && (
              <button className="cw-btn primary" disabled={busy === "setup"} onClick={() => run("setup", api.whatsapp.cancelFollowupSetup,
                ["Sent to Meta", "The form is published and the message is in review. Approval usually takes minutes to a few hours."])}>
                {busy === "setup" ? <Loader2 size={13} className="spin" /> : <Rocket size={13} />} {d.setup.template.status === "REJECTED" ? "Set up again" : "Set up in Meta"}
              </button>
            )}
            <button className="cw-btn" disabled={busy === "check"} onClick={() => run("check", data.refresh)}>
              <RefreshCw size={13} className={busy === "check" ? "spin" : ""} /> Check now
            </button>
          </div>
        </CardHead>
        <div className="ct-status-grid">
          <StatusTile step={1} title="Reason form (WhatsApp Flow)" m={f} detail={d.setup.flow.id ? `Form ID ${d.setup.flow.id}` : "Created by “Set up in Meta”"}
            extra={d.setup.flow.validation_errors?.length ? `${d.setup.flow.validation_errors.length} problems reported by Meta` : d.setup.flow.error} />
          <StatusTile step={2} title="Message template" m={t} detail={`${d.template.name} · ${(d.setup.template.category || "utility").toLowerCase()} · ${LANGS[d.setup.template.language ?? "en"] ?? d.setup.template.language} with Telugu text`}
            extra={d.setup.template.rejected_reason ? `Meta's reason: ${d.setup.template.rejected_reason}`
              : d.setup.template.category && d.setup.template.category !== "UTILITY" ? `Meta classed it as ${d.setup.template.category.toLowerCase()}: each message costs the marketing rate.` : d.setup.template.error} />
          <div className={`ct-tile ${ready ? "good" : "idle"}`}>
            <span className="ct-step">3</span>
            <div>
              <b>Ready to send</b>
              <span className={`ct-pill ${ready ? "good" : "idle"}`}>{ready ? <><CheckCircle2 size={12} /> Yes</> : <><Clock3 size={12} /> Not yet</>}</span>
              <p>{ready
                ? d.active ? "Sending is on: customers who cancel get it automatically." : "Turn sending on on the Cancellation Dashboard when you are ready."
                : "Needs steps 1 and 2 approved. Test mode works once the message is approved."}</p>
              <Link className="cx-link" to={CANCEL_ROUTES.dashboard}>Cancellation Dashboard <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      <div className="cf-previews">
        {/* the message */}
        <section className="cw-card">
          <CardHead icon={FileText} title="The message" note="what the customer sees" />
          <label className="cf-name">
            Preview with name
            <input value={previewName} onChange={(e) => setPreviewName(e.target.value)} placeholder="Customer's first name" />
          </label>
          <div className="cf-phone">
            <div className="cf-chat-head"><span className="cf-dp">EH</span><div><b>ExtraHand</b><small>WhatsApp Business</small></div></div>
            <div className="cf-chat">
              <div className="cf-bubble">
                <div className="cf-body"><WaText text={d.template.body} name={previewName.trim()} /></div>
                <div className="cf-foot">{d.template.footer}<span>{fmtTime(new Date().toISOString())}</span></div>
                <div className="cf-btn"><FileText size={14} /> {d.template.button}</div>
              </div>
            </div>
          </div>
          <dl className="ct-details">
            <div><dt>Template name</dt><dd className="cw-mono">{d.template.name}</dd></div>
            <div><dt>Name in the message</dt><dd>Customer's first name, in both greetings</dd></div>
            <div><dt>Button</dt><dd>{d.template.button} → opens the form</dd></div>
            <div><dt>Length</dt><dd>{bodyLen} of 1,024 characters</dd></div>
          </dl>
        </section>

        {/* the form */}
        <section className="cw-card">
          <CardHead icon={MessageSquareWarning} title="The form" note="opens inside WhatsApp" />
          <div className="cf-phone form">
            <div className="cf-form-head"><X size={16} /><b>{d.form.title}</b><span /></div>
            <div className="cf-form">
              <h3>{d.form.question}</h3>
              <p className="te">{d.form.question_te}</p>
              <div className="cf-group">
                <b>{d.form.select}</b><small>{d.form.select_te}</small>
                {d.form.reasons.map((r, i) => (
                  <div key={r.id} className="cf-radio">
                    <span className={i === 0 ? "cf-dot on" : "cf-dot"} />
                    <span><b>{r.en}</b><small>{r.te}</small></span>
                  </div>
                ))}
              </div>
              <div className="cf-group">
                <b>{d.form.note}</b>
                <div className="cf-textarea">{d.form.note_te}</div>
              </div>
            </div>
            <div className="cf-submit">{d.form.submit}</div>
          </div>
          <p className="cw-chart-foot">WhatsApp limits form labels to 30 characters, so each reason shows English with Telugu under it.</p>
        </section>

        {/* test mode */}
        <section className="cw-card ct-test">
          <CardHead icon={FlaskConical} title="Test mode" note="not counted in results" />
          <p className="ct-test-intro">
            Send the real message to your own WhatsApp, open the form, and submit it. Each step shows below as it happens,
            so you can check everything works before turning sending on.
          </p>
          {!ready && (
            <p className="ct-test-lock"><AlertTriangle size={13} /> Test mode works once Meta approves the message (status above).</p>
          )}
          <form className="cf-test" onSubmit={(e) => { e.preventDefault(); run("test", () => api.whatsapp.cancelFollowupTest(testPhone, testName), ["Test sent", "Open WhatsApp on that phone. Its progress shows here."]); }}>
            <label><span>Your WhatsApp number</span>
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />
            </label>
            <label><span>Name to show (optional)</span>
              <input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. Priya" />
            </label>
            <button className="cw-btn primary" disabled={!testPhone.trim() || busy === "test" || d.setup.template.status !== "APPROVED"}
              title={d.setup.template.status !== "APPROVED" ? "Needs the message approved by Meta" : undefined}>
              {busy === "test" ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Send test message
            </button>
          </form>

          <div className="ct-history">
            <b>Test messages</b>
            {tests.length === 0 ? <p className="cw-empty small">No tests yet.</p> : (
              <ul>
                {tests.slice(0, 8).map((r) => <TestRow key={r.id} r={r} />)}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusTile({ step, title, m, detail, extra }: {
  step: number; title: string; m: ReturnType<typeof meta>; detail: string; extra?: ReactNode;
}) {
  const I = m.icon;
  return (
    <div className={`ct-tile ${m.tone}`}>
      <span className="ct-step">{step}</span>
      <div>
        <b>{title}</b>
        <span className={`ct-pill ${m.tone}`}><I size={12} /> {m.label}</span>
        <p>{m.means}</p>
        <small>{detail}</small>
        {extra && <small className="ct-extra">{extra}</small>}
      </div>
    </div>
  );
}

/** one test send: sent → delivered → read → answered */
function TestRow({ r }: { r: WaCancelFollowupRow }) {
  const failed = r.status === "failed" || r.delivery === "failed";
  const answered = r.status === "answered";
  const read = answered || r.delivery === "read";
  const delivered = read || r.delivery === "delivered";
  const sent = answered || r.status === "sent";
  const steps: [string, boolean][] = [["Sent", sent], ["Delivered", delivered], ["Read", read], ["Answered", answered]];
  return (
    <li className={failed ? "failed" : ""}>
      <div className="ct-test-top">
        <span><b>{r.customer_phone}</b>{r.customer_name ? ` · ${r.customer_name}` : ""}</span>
        <small>{fmtDate(r.created_at)} {fmtTime(r.created_at)}</small>
      </div>
      {failed ? <small className="cf-err" title={r.error ?? undefined}><XCircle size={11} /> Not sent: {r.error ?? "WhatsApp refused it"}</small> : (
        <ol className="ct-progress">
          {steps.map(([label, done]) => <li key={label} className={done ? "done" : ""}><i />{label}</li>)}
        </ol>
      )}
      {answered && <small className="ct-answer">Answered “{r.answer_reason_label}”{r.answer_note ? ` — “${r.answer_note}”` : ""}</small>}
    </li>
  );
}
