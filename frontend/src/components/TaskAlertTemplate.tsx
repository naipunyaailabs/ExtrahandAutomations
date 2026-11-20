import { CheckCircle2, Clock3, ExternalLink, FileText, Link2, MessageSquareText, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import type { WaTaskAlertTemplate } from "../types";
import { ErrorNote, SkeletonRows } from "./ui";
import "./task-alert-template.css";

const STATUS: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  APPROVED: { label: "Approved by Meta", tone: "ok", icon: CheckCircle2 },
  PENDING: { label: "Waiting for Meta approval", tone: "wait", icon: Clock3 },
  REJECTED: { label: "Rejected by Meta", tone: "bad", icon: XCircle },
};

/** Renders WhatsApp *bold* and _italic_ markers the way the app shows them. */
function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b>
        : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i>
        : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** The new-task alert helpers receive: Meta template status, a WhatsApp preview and how each blank is filled. */
export function TaskAlertTemplate({ ticketId, compact = false }: { ticketId?: string; compact?: boolean } = {}) {
  const data = usePoll<WaTaskAlertTemplate>(() => api.whatsapp.taskAlertTemplate(ticketId), 60000, [ticketId]);
  const t = data.data;
  const [view, setView] = useState<"template" | "text">("template");
  const st = STATUS[t?.status ?? ""] ?? { label: t?.status === "NOT_FOUND" ? "Not created yet" : t?.status ?? "", tone: "bad", icon: XCircle };
  const StIcon = st.icon;
  const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <section className={`tat ${compact ? "tat-compact" : ""}`}>
      {!compact && <header className="tat-head">
        <div className="tat-title">
          <span className="tat-icon"><FileText size={18} /></span>
          <div>
            <h3>Message template · new task alert</h3>
            <p>What every helper matching a new task's location and service receives on WhatsApp.</p>
          </div>
        </div>
        <button type="button" className="tat-refresh" onClick={data.refresh} title="Check Meta status again" aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </header>}

      <ErrorNote error={data.error || (t?.error ? `Meta: ${t.error}` : null)} />
      {!t && !data.error && <SkeletonRows rows={6} />}

      {t && (
        <>
          <div className="tat-badges">
            <span className={`tat-badge tat-${st.tone}`}><StIcon size={13} /> {st.label}</span>
            <span className="tat-badge tat-cat">{t.category.charAt(0) + t.category.slice(1).toLowerCase()} template</span>
            <code className="tat-name">{t.name}</code>
            <span className={`tat-badge ${t.in_use === "template" ? "tat-ok" : "tat-wait"}`}>
              In use now: {t.in_use === "template" ? "this template" : "plain-text fallback"}
            </span>
          </div>

          {t.status !== "APPROVED" && (
            <div className={`tat-note ${t.status === "REJECTED" ? "tat-note-bad" : ""}`}>
              {t.status === "REJECTED"
                ? <>Meta rejected this template{t.rejected_reason ? ` (${t.rejected_reason})` : ""}. Alerts keep going out as plain text.</>
                : <>Until Meta approves it, alerts go out as plain text — Meta only delivers that to helpers who messaged ExtraHand in the last 24 hours. Once approved, the agent switches automatically.</>}
            </div>
          )}

          <div className="tat-grid">
            {/* ---------------------------------------------------------------- preview */}
            <div className="tat-preview">
              <div className="tat-seg" role="tablist" aria-label="Preview">
                <button role="tab" aria-selected={view === "template"} className={view === "template" ? "on" : ""} onClick={() => setView("template")}>
                  <FileText size={13} /> Template
                </button>
                <button role="tab" aria-selected={view === "text"} className={view === "text" ? "on" : ""} onClick={() => setView("text")}>
                  <MessageSquareText size={13} /> Text fallback
                </button>
              </div>
              <div className="tat-phone">
                <div className="tat-phone-top">
                  <img src="/extrahand_app_icon_white_bg.png" alt="" />
                  <div><b>ExtraHand</b><small>Verified business</small></div>
                </div>
                <div className="tat-chat">
                  <div className="tat-bubble">
                    <div className="tat-bubble-text">
                      {view === "template" ? (t.sample.filled_body || "Template text is loaded from Meta…") : <WaText text={t.fallback_text} />}
                    </div>
                    {view === "template" && t.footer && <div className="tat-footer">{t.footer}</div>}
                    <div className="tat-time">{time}</div>
                    {view === "template" && t.button && (
                      <a className="tat-button" href={t.sample.task_url} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} /> {t.button.text}
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <p className="tat-caption">
                {compact ? "Exactly what each matched helper receives for this task" : t.sample.from_real_task ? "Example filled with your latest real task." : "Example values."}
                {" "}(helper name shown as “Ravi”).
              </p>
            </div>

            {/* ---------------------------------------------------------------- how it's filled */}
            {!compact && <div className="tat-side">
              <h4>How the blanks are filled</h4>
              <ul className="tat-vars">
                {t.variables.map((v) => (
                  <li key={v.n}>
                    <code>{`{{${v.n}}}`}</code>
                    <div>
                      <b>{v.label}</b>
                      <span title={v.example}>{v.example}</span>
                    </div>
                  </li>
                ))}
                {t.button && (
                  <li>
                    <code><Link2 size={12} /></code>
                    <div>
                      <b>“{t.button.text}” button</b>
                      <span>Opens the task: {t.button.url.replace("{{1}}", "<task id>")}</span>
                    </div>
                  </li>
                )}
              </ul>

              <h4>Task alerts sent today</h4>
              <div className="tat-today">
                <div><b className="tabular">{t.today.template}</b><span>as template</span></div>
                <div><b className="tabular">{t.today.text}</b><span>as plain text</span></div>
                <div className={t.today.failed ? "tat-bad-n" : ""}><b className="tabular">{t.today.failed}</b><span>failed</span></div>
              </div>
            </div>}
          </div>
        </>
      )}
    </section>
  );
}
