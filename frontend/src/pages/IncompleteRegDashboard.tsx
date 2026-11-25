import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCheck,
  CheckCircle2,
  Clock3,
  FlaskConical,
  HandHeart,
  Hourglass,
  Loader2,
  MapPinOff,
  Phone,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Square,
  UserRoundPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AnimatedNumber } from "../components/motion";
import { ErrorNote, SkeletonRows, useToast } from "../components/ui";
import { usePoll } from "../hooks";
import type {
  WaAudience,
  WaIncompleteCompletedPage,
  WaIncompleteDashboard,
  WaIncompleteTemplateInfo,
  WaIncompleteUsersPage,
} from "../types";
import { AudienceBadge, fmtPhone, fmtWhen, IncompleteStatusPill } from "./incompleteRegShared";
import "./wa-commercials.css";
import "./wa-welcomers.css";
import "./wa-welcomer-dashboard.css";

const HELPER_COLOR = "#0ea5e9";
const CUSTOMER_COLOR = "#8b5cf6";

function metaBadge(status: string): { label: string; tone: "ok" | "wait" | "bad" | "idle" } {
  const s = (status || "").toUpperCase();
  if (s === "APPROVED") return { label: "Approved by Meta", tone: "ok" };
  if (s === "PENDING" || s === "IN_APPEAL") return { label: "In Meta review", tone: "wait" };
  if (s === "REJECTED" || s === "PAUSED" || s === "DISABLED") return { label: `Meta: ${s.toLowerCase()}`, tone: "bad" };
  if (s === "NOT_CREATED") return { label: "Not submitted yet", tone: "idle" };
  return { label: status || "Unknown", tone: "idle" };
}

function TemplatePreviewCard({
  title,
  audience,
  info,
  sampleName,
}: {
  title: string;
  audience: WaAudience;
  info: WaIncompleteTemplateInfo;
  sampleName: string;
}) {
  const st = metaBadge(info.status);
  const body = audience === "customer" ? info.body.replace(/\{\{\s*1\s*\}\}/g, sampleName || "Priya") : info.body;
  return (
    <div style={{ display: "grid", gap: "10px", alignContent: "start" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        <b style={{ fontSize: "14px", color: "var(--text)" }}>{title}</b>
        <span className={`wwl-chip ${st.tone === "ok" ? "wwl-t-sent" : st.tone === "wait" ? "wwl-t-warn" : st.tone === "bad" ? "wwl-t-failed" : "wwl-t-off"}`}>
          {st.tone === "ok" ? <CheckCircle2 size={12} /> : st.tone === "wait" ? <Hourglass size={12} /> : st.tone === "bad" ? <XCircle size={12} /> : null}
          {st.label}
        </span>
      </div>
      <div className="wwl-meta-status" style={{ marginBottom: 0 }}>
        <small style={{ color: "var(--muted)" }}>
          Template: <code style={{ fontWeight: 700 }}>{info.name}</code> · Language: <b>Telugu (te)</b> · {info.category}
        </small>
        {info.rejected_reason && <em style={{ color: "var(--danger)", fontSize: "12px" }}>Reason: {info.rejected_reason}</em>}
        {info.error && <em style={{ color: "var(--danger)", fontSize: "12px" }}>{info.error}</em>}
      </div>
      <div className="wwl-phone">
        <div className="wwl-phone-top">
          <img src="/extrahand_app_icon_white_bg.png" alt="" />
          ExtraHand
          <small>WhatsApp Business</small>
        </div>
        <div className="wwl-phone-msg">
          <div className="wwl-bubble">{body}</div>
        </div>
      </div>
    </div>
  );
}

export function IncompleteRegDashboard() {
  const toast = useToast();
  const data = usePoll<WaIncompleteDashboard>(() => api.whatsapp.incompleteRegDashboard(), 30000);
  const [busy, setBusy] = useState<string | null>(null);
  const [sampleName, setSampleName] = useState("Priya");
  const [testAudience, setTestAudience] = useState<WaAudience>("helper");
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("Priya");
  const d = data.data;

  const runAction = async (key: string, fn: () => Promise<unknown>, ok?: [string, string?]) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok[0], ok[1]);
      data.refresh();
    } catch (e) {
      toast.error("Action failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = () => {
    if (!d) return;
    if (d.active) {
      runAction("toggle", api.whatsapp.deactivateIncompleteReg, ["Automation paused", "No further incomplete registration messages will be sent."]);
    } else {
      runAction("toggle", api.whatsapp.activateIncompleteReg, [
        "Automation activated",
        "Only people who sign up from now on get a reminder, 5 hours after signup. Older signups are ignored.",
      ]);
    }
  };

  const refreshLive = () => runAction("refresh", () => api.whatsapp.incompleteRegDashboard(true), ["Refreshed", "Live ExtraHand incomplete list reloaded."]);

  const templatesNeedSetup =
    d && (["NOT_CREATED", "REJECTED"].includes(d.templates.helper.status) || ["NOT_CREATED", "REJECTED"].includes(d.templates.customer.status));

  const daily = d?.daily ?? [];
  const maxDay = Math.max(1, ...daily.map((x) => Math.max(x.helper_incomplete + x.customer_incomplete, x.sent)));

  return (
    <div className="wx-page wd">
      <header className="wx-banner">
        <div className="wx-banner-top">
          <div className="wx-banner-title">
            <span className="wx-kicker"><Hourglass size={13} /> Customer Engagement · Incomplete Register</span>
            <h1>Incomplete Registration Dashboard</h1>
            <p className="wd-sub">
              Detects Helpers &amp; Customers who stopped registration midway. When active, only registered helpers and customers who have not added their location, and who sign up after
              activation, get 1 Telugu reminder 5 hours after signup. Everyone else is left out.
            </p>
          </div>
          <div className="wx-banner-tools">
            {d && (
              <button
                type="button"
                className={`wwl-switch ${d.active ? "on" : "off"}`}
                onClick={toggleActive}
                disabled={busy === "toggle"}
                aria-pressed={d.active}
              >
                {busy === "toggle" ? <Loader2 size={14} className="animate-spin" /> : d.active ? <Play size={13} fill="currentColor" /> : <Square size={12} fill="currentColor" />}
                <span>{d.active ? "Active" : "Inactive"}</span>
              </button>
            )}
            {d?.active && (
              <button
                type="button"
                className="wx-ghost"
                onClick={() => runAction("check", api.whatsapp.checkIncompleteRegNow, ["Batch processed", "Checked eligible >5h users and queued reminders."])}
                disabled={busy === "check"}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 12px", height: "36px", borderRadius: "999px" }}
              >
                <Send size={13} /> {busy === "check" ? "Sending…" : "Send batch now"}
              </button>
            )}
            <button
              type="button"
              className="wx-ghost wx-square"
              onClick={refreshLive}
              disabled={busy === "refresh"}
              title="Re-scan ExtraHand live users"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={busy === "refresh" ? "spin" : ""} />
            </button>
          </div>
        </div>

        {d && (
          <div className="wd-switches">
            <Link to="/engagement/incomplete/users" className={d.active ? "on" : ""}>
              <i /> {d.active ? `Active since ${fmtWhen(d.activated_at)} · only signups after this` : "Inactive · Click Active to start"}
            </Link>
            <Link to="/engagement/incomplete/users">
              View {d.counts.total_incomplete.toLocaleString("en-IN")} incomplete users <ArrowRight size={12} />
            </Link>
            <span className="wd-fresh">
              <i /> {d.loading ? "Scanning ExtraHand…" : `Updated ${fmtWhen(d.fetched_at)}`} · 5h wait · 1 msg / user
            </span>
          </div>
        )}
      </header>

      <ErrorNote error={data.error || d?.error} />
      {!d && !data.error && (
        <div className="wx-sheet">
          <p className="wd-loading"><RefreshCw size={14} className="spin" /> Loading Incomplete Registration status…</p>
          <SkeletonRows rows={6} />
        </div>
      )}

      {d && (
        <>
          {/* KPIs */}
          <div className="wd-kpis wd-kpis-5">
            <Kpi
              icon={Users}
              color={CUSTOMER_COLOR}
              label="Total incomplete"
              value={d.counts.total_incomplete}
              note={`${d.counts.helper_incomplete.toLocaleString("en-IN")} helpers · ${d.counts.customer_incomplete.toLocaleString("en-IN")} customers`}
            />
            <Kpi
              icon={CheckCircle2}
              color="#16a34a"
              label="Completed registration"
              value={d.counts.total_completed}
              note={`${d.counts.helper_completed.toLocaleString("en-IN")} helpers · ${d.counts.customer_completed.toLocaleString("en-IN")} customers · ${d.counts.completed_after_reminder.toLocaleString("en-IN")} after reminder`}
            />
            <Kpi
              icon={Clock3}
              color="#d97706"
              label="New signups: Eligible / Waiting"
              value={d.counts.ready_to_send}
              note={`${d.counts.waiting_5h} waiting in 5h window · ${d.counts.no_phone} no phone · ${d.counts.old_skipped.toLocaleString("en-IN")} old ignored · ${d.counts.not_targeted.toLocaleString("en-IN")} location added (not messaged)`}
            />
            <Kpi
              icon={Send}
              color="#10b981"
              label="Reminders sent"
              value={d.counts.sent}
              note={`${d.counts.delivered} delivered · ${d.counts.read} read`}
            />
            <Kpi
              icon={CheckCheck}
              color={HELPER_COLOR}
              label="Failed / Simulated"
              value={d.counts.failed + d.counts.simulated}
              note={`${d.counts.failed} failed · ${d.counts.simulated} simulated`}
            />
          </div>

          {/* Stage Breakdown & 30-day Trend */}
          <div className="wd-two">
            <section className="wx-sheet">
              <div className="wd-head">
                <h2><BarChart3 size={16} /> Where users stopped registration</h2>
                <Link to="/engagement/incomplete/users" style={{ fontSize: "12px", fontWeight: 700, color: "var(--wx-mid)" }}>
                  Open list <ArrowRight size={12} />
                </Link>
              </div>
              <div className="wd-funnel">
                {d.stages.map((s) => {
                  const pct = d.counts.total_incomplete ? Math.round((s.count / d.counts.total_incomplete) * 100) : 0;
                  const color = s.key === "profile_pending" || s.key === "kyc_pending" ? HELPER_COLOR : CUSTOMER_COLOR;
                  return (
                    <div key={s.key} className="wd-step" style={{ "--c": color } as CSSProperties}>
                      <span className="wd-step-label">{s.label}</span>
                      <span className="wd-step-bar">
                        <motion.i initial={{ width: 0 }} animate={{ width: `${s.count ? Math.max(pct, 2) : 0}%` }} transition={{ duration: 0.5 }} />
                      </span>
                      <b>{s.count.toLocaleString("en-IN")}</b>
                      <small>{pct}%</small>
                    </div>
                  );
                })}
              </div>
              <div className="wd-rates" style={{ marginTop: "14px" }}>
                <div style={{ "--c": HELPER_COLOR } as CSSProperties}>
                  <span><HandHeart size={11} /> Helpers incomplete</span>
                  <b>{d.counts.helper_incomplete.toLocaleString("en-IN")}</b>
                  <small>Profile pending or KYC pending</small>
                </div>
                <div style={{ "--c": CUSTOMER_COLOR } as CSSProperties}>
                  <span><UserRoundPlus size={11} /> Customers incomplete</span>
                  <b>{d.counts.customer_incomplete.toLocaleString("en-IN")}</b>
                  <small>Role not chosen, no location, or name missing</small>
                </div>
                <div style={{ "--c": "#16a34a", gridColumn: "1 / -1" } as CSSProperties}>
                  <span><CheckCircle2 size={11} /> Completed registration</span>
                  <b>{d.counts.total_completed.toLocaleString("en-IN")}</b>
                  <small>
                    {d.counts.helper_completed.toLocaleString("en-IN")} helpers · {d.counts.customer_completed.toLocaleString("en-IN")} customers ·{" "}
                    {d.counts.completed_after_reminder.toLocaleString("en-IN")} completed after our reminder
                    {d.counts.sent ? ` (${Math.round((d.counts.completed_after_reminder / d.counts.sent) * 100)}% of sent)` : ""}
                  </small>
                </div>
              </div>
            </section>

            <section className="wx-sheet">
              <div className="wd-head">
                <h2><BarChart3 size={16} /> Last 30 days</h2>
                <span className="wd-legend">
                  <i style={{ background: HELPER_COLOR }} /> Helpers
                  <i style={{ background: CUSTOMER_COLOR }} /> Customers
                  <i className="line" /> Sent
                </span>
              </div>
              <div className="wd-trend">
                <svg viewBox="0 0 900 220" role="img" aria-label="Incomplete registrations per day, last 30 days">
                  {[0, 0.5, 1].map((t) => {
                    const y = 194 - t * 168;
                    return (
                      <g key={t}>
                        <line x1={26} x2={874} y1={y} y2={y} className="wd-grid" />
                        <text x={20} y={y + 4} className="wd-axis" textAnchor="end">{Math.round(maxDay * t)}</text>
                      </g>
                    );
                  })}
                  {daily.map((day, i) => {
                    const step = 848 / Math.max(1, daily.length);
                    const bw = Math.max(4, step * 0.62);
                    const x = 26 + i * step + (step - bw) / 2;
                    const yOf = (v: number) => 194 - (v / maxDay) * 168;
                    const hTop = yOf(day.helper_incomplete);
                    const cTop = yOf(day.helper_incomplete + day.customer_incomplete);
                    return (
                      <g key={day.date}>
                        <title>{`${day.date}: ${day.helper_incomplete} helpers, ${day.customer_incomplete} customers incomplete · ${day.sent} reminders sent`}</title>
                        <rect x={x} width={bw} rx={2} fill={HELPER_COLOR} y={hTop} height={194 - hTop} />
                        <rect x={x} width={bw} rx={2} fill={CUSTOMER_COLOR} y={cTop} height={hTop - cTop} />
                      </g>
                    );
                  })}
                  <path
                    d={daily
                      .map((day, i) => {
                        const step = 848 / Math.max(1, daily.length);
                        const x = 26 + i * step + step / 2;
                        const y = 194 - (day.sent / maxDay) * 168;
                        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(" ")}
                    className="wd-line"
                  />
                </svg>
              </div>
              <p className="wd-foot" style={{ marginTop: "8px" }}>
                <Clock3 size={13} /> Every user receives at most 1 message lifetime. Only signups after activation are messaged; anyone who completes within 5 hours is skipped.
              </p>
            </section>
          </div>

          <UsersStatusSection refreshKey={d.fetched_at} totals={d.counts} />

          {/* Telugu Templates & Meta Setup + Test Send */}
          <section className="wx-sheet">
            <div className="wx-sheet-head">
              <span className="wx-num">02</span>
              <h2>Telugu WhatsApp Templates &amp; Meta Approval</h2>
              <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
                  Preview name:
                  <input
                    value={sampleName}
                    onChange={(e) => setSampleName(e.target.value)}
                    placeholder="Priya"
                    style={{ width: "110px", height: "30px", padding: "0 8px", borderRadius: "8px", border: "1px solid var(--wx-rule)", background: "var(--surface)", color: "var(--text)", fontSize: "12.5px" }}
                  />
                </label>
                {templatesNeedSetup && (
                  <button
                    type="button"
                    className="wwl-submit"
                    style={{ margin: 0, height: "32px", padding: "0 14px" }}
                    disabled={busy === "setup"}
                    onClick={() => runAction("setup", api.whatsapp.setupIncompleteRegTemplates, [
                      "Submitted to Meta",
                      "Both Telugu templates have been submitted for Meta approval.",
                    ])}
                  >
                    {busy === "setup" ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                    Submit Telugu Templates to Meta
                  </button>
                )}
              </div>
            </div>

            {templatesNeedSetup && (
              <div className="wd-warn" style={{ marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertTriangle size={15} />
                <span>Submit the Telugu templates to Meta and wait for <b>APPROVED</b> status before live WhatsApp sending begins.</span>
              </div>
            )}

            <div className="wd-two">
              <TemplatePreviewCard title="1. Helper Registration Pending (Telugu)" audience="helper" info={d.templates.helper} sampleName={sampleName} />
              <TemplatePreviewCard title="2. Customer Registration Pending (Telugu)" audience="customer" info={d.templates.customer} sampleName={sampleName} />
            </div>
          </section>

          {/* Test Mode */}
          <section className="wx-sheet">
            <div className="wx-sheet-head">
              <span className="wx-num">03</span>
              <h2><FlaskConical size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Test Template Send</h2>
              <span className="wx-sheet-aside wx-aside">not counted in analytics or commercials</span>
            </div>
            <div className="wd-two">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runAction("test", () => api.whatsapp.testIncompleteReg(testPhone, testAudience, testName), [
                    "Test sent",
                    `Sent ${testAudience} Telugu template to ${testPhone}.`,
                  ]);
                }}
                style={{ display: "grid", gap: "10px", alignContent: "start" }}
              >
                <div className="wwl-seg" role="tablist" aria-label="Test template audience">
                  <button type="button" className={testAudience === "helper" ? "on" : ""} onClick={() => setTestAudience("helper")}>Helper Template</button>
                  <button type="button" className={testAudience === "customer" ? "on" : ""} onClick={() => setTestAudience("customer")}>Customer Template</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
                    WhatsApp number
                    <input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      style={{ height: "36px", padding: "0 10px", borderRadius: "9px", border: "1px solid var(--wx-rule)", background: "var(--surface)", color: "var(--text)" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
                    Customer name (shown in the Customer greeting)
                    <input
                      value={testName}
                      onChange={(e) => setTestName(e.target.value)}
                      placeholder="Type a name, e.g. Priya"
                      style={{ height: "36px", padding: "0 10px", borderRadius: "9px", border: "1px solid var(--wx-rule)", background: "var(--surface)", color: "var(--text)" }}
                    />
                    {testAudience === "helper" && (
                      <small style={{ fontSize: "11px" }}>The Helper template has no name in it; switch to Customer Template to use this name.</small>
                    )}
                  </label>
                </div>
                <button type="submit" className="wwl-submit" style={{ justifySelf: "start" }} disabled={!testPhone.trim() || busy === "test"}>
                  {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send Test Message
                </button>
              </form>

              <div>
                <b style={{ fontSize: "13px", display: "block", marginBottom: "8px" }}>Recent test sends</b>
                {d.recent_tests.length === 0 ? (
                  <p className="wd-empty">No test messages sent yet.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
                    {d.recent_tests.slice(0, 6).map((t) => (
                      <li key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", borderRadius: "10px", border: "1px solid var(--wx-rule)" }}>
                        <div style={{ fontSize: "12.5px" }}>
                          <b>{fmtPhone(t.phone)}</b> · <span style={{ textTransform: "capitalize" }}>{t.audience}</span>
                          {t.error && <div style={{ color: "var(--danger)", fontSize: "11.5px" }}>{t.error}</div>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <small style={{ color: "var(--muted)", fontSize: "11px" }}>{fmtWhen(t.created_at)}</small>
                          <IncompleteStatusPill status={t.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: I, color, label, value, note }: { icon: typeof Users; color: string; label: string; value: number; note: string }) {
  return (
    <motion.div className="wd-kpi" style={{ "--c": color } as CSSProperties} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <span className="wd-kpi-icon"><I size={19} /></span>
      <span className="wd-kpi-label">{label}</span>
      <b className="wd-kpi-value"><AnimatedNumber value={value} /></b>
      <small>{note}</small>
    </motion.div>
  );
}

const LIST_LIMIT = 25;

type ListGroup = "completed" | "incomplete" | "no_location";
type MsgFilter = "all" | "not_sent" | "sent" | "delivered" | "read" | "failed";

const LIST_AUDIENCES = [
  { key: "all", label: "All" },
  { key: "helper", label: "Helpers" },
  { key: "customer", label: "Customers" },
] as const;

const MSG_FILTERS: { key: MsgFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_sent", label: "Not sent" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
];

type ListResult =
  | { kind: "completed"; page: WaIncompleteCompletedPage }
  | { kind: "incomplete"; page: WaIncompleteUsersPage };

/** One table for Completed, Incomplete and No-location users, filtered by role and by our WhatsApp message status. */
function UsersStatusSection({ refreshKey, totals }: { refreshKey: string | null; totals: WaIncompleteDashboard["counts"] }) {
  const [group, setGroup] = useState<ListGroup>("completed");
  const [audience, setAudience] = useState<"all" | "helper" | "customer">("all");
  const [status, setStatus] = useState<MsgFilter>("all");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => setOffset(0), [group, audience, status, q]);

  const data = usePoll<ListResult>(
    async () =>
      group === "completed"
        ? { kind: "completed", page: await api.whatsapp.incompleteRegCompleted({ audience, status, q, offset, limit: LIST_LIMIT }) }
        : {
            kind: "incomplete",
            page: await api.whatsapp.incompleteRegUsers({
              audience, status, q, offset, limit: LIST_LIMIT, location: group === "no_location" ? "missing" : undefined,
            }),
          },
    30000,
    [group, audience, status, q, offset, refreshKey],
  );
  const res = data.data && data.data.kind === (group === "completed" ? "completed" : "incomplete") ? data.data : null;
  const page = res?.page;
  const c = page?.counts as Record<string, number> | undefined;
  const statusCount = (k: MsgFilter) => (c ? (k === "all" ? (c.not_sent ?? 0) + (c.sent ?? 0) + (c.failed ?? 0) : c[k] ?? 0) : undefined);

  const GROUPS: { key: ListGroup; label: string; n: number }[] = [
    { key: "completed", label: "Completed", n: totals.total_completed },
    { key: "incomplete", label: "Incomplete", n: totals.total_incomplete },
    { key: "no_location", label: "No location", n: totals.no_location },
  ];

  return (
    <section className="wx-sheet">
      <div className="wx-sheet-head">
        <span className="wx-num">01</span>
        <h2>
          <Users size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Users &amp; WhatsApp Status
        </h2>
        <span className="wx-sheet-aside wx-aside">
          {totals.total_completed.toLocaleString("en-IN")} completed · {totals.completed_after_reminder.toLocaleString("en-IN")} after our reminder
        </span>
      </div>

      <ErrorNote error={data.error || page?.error} />

      <div className="wwl-people-tools">
        <div className="wwl-people-row">
          <div className="wwl-seg" role="tablist" aria-label="Which users">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" className={group === g.key ? "on" : ""} onClick={() => setGroup(g.key)}>
                {g.key === "completed" && <CheckCircle2 size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                {g.key === "incomplete" && <Hourglass size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                {g.key === "no_location" && <MapPinOff size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                {g.label} ({g.n.toLocaleString("en-IN")})
              </button>
            ))}
          </div>
          <div className="wwl-seg" role="tablist" aria-label="Role">
            {LIST_AUDIENCES.map((a) => (
              <button key={a.key} type="button" className={audience === a.key ? "on" : ""} onClick={() => setAudience(a.key)}>
                {a.key === "helper" && <HandHeart size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                {a.key === "customer" && <UserRoundPlus size={12} style={{ verticalAlign: "-1px", marginRight: "4px" }} />}
                {a.label}
              </button>
            ))}
          </div>
          <div className="wwl-search">
            <Search size={14} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search name, phone, city, user id…" />
          </div>
        </div>
        <div className="wwl-filters" aria-label="WhatsApp message status">
          {MSG_FILTERS.map((f) => {
            const n = statusCount(f.key);
            return (
              <button key={f.key} type="button" className={status === f.key ? "on" : ""} onClick={() => setStatus(f.key)}>
                {f.label} {n !== undefined && <span>{n.toLocaleString("en-IN")}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!res ? (
        <SkeletonRows rows={6} />
      ) : res.page.loading && res.page.items.length === 0 ? (
        <p className="wx-empty"><RefreshCw size={14} className="spin" /> Scanning ExtraHand registrations…</p>
      ) : res.page.items.length === 0 ? (
        <p className="wx-empty">No users match this filter.</p>
      ) : (
        <>
          <div className="wwl-table-wrap">
            <table className="wx-ledger">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  {res.kind === "incomplete" && <th>What is missing</th>}
                  <th>City</th>
                  <th>Signed up</th>
                  <th>Our WhatsApp message</th>
                </tr>
              </thead>
              <tbody>
                {res.kind === "completed"
                  ? res.page.items.map((u) => (
                      <tr key={`${u.audience}-${u.user_id}`}>
                        <td>
                          <b>{u.name || "Unnamed"}</b>
                          <div className="wwl-person-meta"><Phone size={11} /> {fmtPhone(u.phone)}</div>
                        </td>
                        <td><AudienceBadge audience={u.audience} /></td>
                        <td>{u.city || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(u.registered_at)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <MsgCell status={u.reminder_status} at={u.reminder_sent_at} />
                        </td>
                      </tr>
                    ))
                  : res.page.items.map((u) => (
                      <tr key={`${u.audience}-${u.user_id}`}>
                        <td>
                          <b>{u.name || "Unnamed"}</b>
                          <div className="wwl-person-meta"><Phone size={11} /> {fmtPhone(u.phone)}</div>
                        </td>
                        <td><AudienceBadge audience={u.audience} /></td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: "12.5px" }}>{u.stage_label}</div>
                          <small style={{ color: "var(--muted)", fontSize: "11px" }}>{u.missing.join(", ")}</small>
                        </td>
                        <td>{u.city || "No location"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(u.registered_at)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <MsgCell status={u.msg_status} at={u.sent_at} />
                          {u.error && <div style={{ color: "var(--danger)", fontSize: "11px", maxWidth: "200px", whiteSpace: "normal" }}>{u.error}</div>}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          <div className="wwl-pager">
            <span>Showing {offset + 1}–{Math.min(offset + res.page.items.length, res.page.total)} of {res.page.total.toLocaleString("en-IN")}</span>
            <button type="button" className="wsm-page-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIST_LIMIT))}>
              Previous
            </button>
            <button type="button" className="wsm-page-btn" disabled={offset + res.page.items.length >= res.page.total} onClick={() => setOffset(offset + LIST_LIMIT)}>
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Our reminder's WhatsApp status (Sent / Delivered / Read / Failed, or why nothing was sent) and when it went. */
function MsgCell({ status, at }: { status: string | null; at: string | null }) {
  if (!status) return <span className="wwl-chip wwl-t-off">Not sent</span>;
  const sent = ["sent", "sending", "delivered", "read", "failed"].includes(status);
  return (
    <>
      <IncompleteStatusPill status={status === "sending" ? "sent" : status} />
      {sent && at && <div style={{ color: "var(--muted)", fontSize: "11px" }}>{fmtWhen(at)}</div>}
    </>
  );
}
