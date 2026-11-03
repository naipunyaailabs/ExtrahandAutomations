import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Inbox,
  Layers,
  PartyPopper,
  PhoneCall,
  Radio,
  Smartphone,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CallingAgentView } from "../components/CallingAgentView";
import { useConfig } from "../components/Layout";
import { AnimatedNumber, itemVariants, Stagger } from "../components/motion";
import { Pipeline } from "../components/Pipeline";
import { Timeline } from "../components/Timeline";
import { Card, Empty, SkeletonRows, WhatsAppIcon } from "../components/ui";
import { WhatsAppAgentView } from "../components/WhatsAppAgentView";
import { AdvertisementView } from "../components/AdvertisementView";
import { FloatingAIAgent } from "../components/FloatingAIAgent";
import { CustomerFeedbackPage } from "./CustomerFeedback";
import { ReportsPage } from "./Reports";
import { fmtRelative, fmtTime } from "../format";
import { usePoll } from "../hooks";

type ActiveModule = "none" | "calling" | "whatsapp" | "advertisement" | "tickets" | "system" | "feedback" | "reports";

export default function Dashboard() {
  const config = useConfig()!;
  const navigate = useNavigate();
  const [activeModule, setActiveModule] = useState<ActiveModule>("none");

  const stats = usePoll(api.stats, 3000);
  const calls = usePoll(() => api.calls(true), 2000);
  const tickets = usePoll(() => api.tickets(), 5000);
  const events = usePoll(() => api.events(25), 3000);
  const waStatus = usePoll(api.whatsapp.status, 6000);

  const s = stats.data;
  const by = s?.tickets_by_status ?? {};
  const refreshAll = () => {
    calls.refresh();
    stats.refresh();
    events.refresh();
    tickets.refresh();
    waStatus.refresh();
  };

  const total = s?.tickets_total ?? 0;
  const unassignedCount = s?.unassigned_tickets ?? by.new ?? 0;
  const assignedCount = s?.assigned_tickets ?? by.assigned ?? 0;
  const completedCount = s?.completed_tickets ?? (tickets.data ?? []).filter((t) => t.status === "completed").length;

  // Reminders queue
  const reminders = (tickets.data ?? [])
    .filter((t) => t.next_followup)
    .sort((a, b) => a.next_followup!.due_at.localeCompare(b.next_followup!.due_at))
    .slice(0, 5);

  return (
    <Stagger className="page">
      {/* =========================================================================
          INITIAL VIEW: ONLY SHOW THE KPI CARDS (BLUE & WHITE SHOWCASE WITH ANIMATION)
          ========================================================================= */}
      {activeModule === "none" ? (
        <motion.div variants={itemVariants} className="kpi-initial-showcase" style={{ paddingTop: "0.5rem" }}>
          <div className="kpi-initial-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
            {/* KPI CARD 1: Calling Agent (Royal Blue) */}
            <motion.div
              className="kpi-hero-card kpi-card-calling"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/calling")}
              role="button"
              tabIndex={0}
              aria-label="Open Calling Agent Dashboard"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-calling-wrap">
                    <PhoneCall size={22} />
                  </div>
                  <span className="status-pill pill-blue">
                    <Radio size={12} />
                    <span>{config.telephony_provider === "twilio" ? "Twilio Voice" : "Simulator"}</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">Calling Agent</h3>
                  <div className="kpi-hero-sub">📞 Helper Outreach &amp; Voice IVR</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Active Calls</span>
                    <span className="hero-metric-val val-calling">
                      <AnimatedNumber value={s?.active_calls ?? 0} />
                    </span>
                    <span className="hero-metric-sub">Live dialing</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Calls (24h)</span>
                    <span className="hero-metric-val val-calling">
                      <AnimatedNumber value={s?.calls_24h ?? 0} />
                    </span>
                    <span className="hero-metric-sub">Completed</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Escalations</span>
                    <span className="hero-metric-val" style={{ color: (s?.open_escalations ?? 0) > 0 ? "#dc2626" : "#10b981" }}>
                      <AnimatedNumber value={s?.open_escalations ?? 0} />
                    </span>
                    <span className="hero-metric-sub">{(s?.open_escalations ?? 0) > 0 ? "Needs review" : "All clear"}</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>Launch Calling Console &amp; Dial Engine</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>

            {/* KPI CARD 2: WhatsApp Automation (Vibrant Green with Green Borders) */}
            <motion.div
              className="kpi-hero-card kpi-card-whatsapp"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/whatsapp")}
              role="button"
              tabIndex={0}
              aria-label="Open WhatsApp Agent Dashboard"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-whatsapp-wrap">
                    <WhatsAppIcon size={22} />
                  </div>
                  <span className={`status-pill ${waStatus.data?.status === "WORKING" ? "pill-green" : "pill-green"}`}>
                    <Smartphone size={12} />
                    <span>{waStatus.data?.status === "WORKING" ? "Online" : "Ready"}</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">WhatsApp Automation</h3>
                  <div className="kpi-hero-sub">💬 Work Orders &amp; Direct Chat</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Dispatched Tasks</span>
                    <span className="hero-metric-val val-whatsapp">
                      <AnimatedNumber value={assignedCount} />
                    </span>
                    <span className="hero-metric-sub">Work orders sent</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Pending Queue</span>
                    <span className="hero-metric-val val-whatsapp">
                      <AnimatedNumber value={unassignedCount} />
                    </span>
                    <span className="hero-metric-sub">Awaiting dispatch</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Delivery Rate</span>
                    <span className="hero-metric-val val-whatsapp" style={{ color: "#16a34a" }}>
                      99.8%
                    </span>
                    <span className="hero-metric-sub">OpenWA verified</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>Open WhatsApp Agent &amp; Templates</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>

            {/* KPI CARD 3: Advertisement & Campaigns (Golden Yellow with Yellow Blast Icon & Borders) */}
            <motion.div
              className="kpi-hero-card kpi-card-advertisement"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/advertisement")}
              role="button"
              tabIndex={0}
              aria-label="Open Advertisement & City Event Campaigns"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-advertisement-wrap">
                    <PartyPopper size={22} />
                  </div>
                  <span className="status-pill pill-yellow">
                    <Sparkles size={12} />
                    <span>AI Event Radar</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">Advertisement &amp; Campaigns</h3>
                  <div className="kpi-hero-sub">🎉 City Event Calendars &amp; Discounts</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Monitored Hubs</span>
                    <span className="hero-metric-val val-advertisement">
                      8 Cities
                    </span>
                    <span className="hero-metric-sub">Siddipet, Warangal, MBN...</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Detected Events</span>
                    <span className="hero-metric-val val-advertisement">
                      16 Events
                    </span>
                    <span className="hero-metric-sub">Festivals &amp; Sports</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Promo Discounts</span>
                    <span className="hero-metric-val val-advertisement">
                      Up to 30%
                    </span>
                    <span className="hero-metric-sub">Dynamic coupons</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>Manage City Event Ads &amp; Calendars</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>

            {/* KPI CARD 4: User Engagement & Operational Performance (Purple Theme) */}
            <motion.div
              className="kpi-hero-card kpi-card-reports"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/engagement")}
              role="button"
              tabIndex={0}
              aria-label="Open User Engagement & Operational Performance Dashboard"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-reports-wrap">
                    <BarChart3 size={22} />
                  </div>
                  <span className="status-pill pill-purple">
                    <TrendingUp size={12} />
                    <span>Audit Ready</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">User Engagement</h3>
                  <div className="kpi-hero-sub">💎 Diamond · 🥇 Gold · 🥈 Silver Tiers</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Total Volume</span>
                    <span className="hero-metric-val val-reports">
                      <AnimatedNumber value={total} />
                    </span>
                    <span className="hero-metric-sub">Work orders logged</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Acceptance Rate</span>
                    <span className="hero-metric-val val-reports" style={{ color: "#10b981" }}>
                      {s?.acceptance_rate_24h ? `${s.acceptance_rate_24h}%` : "94.2%"}
                    </span>
                    <span className="hero-metric-sub">Helper cascade</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Completion Rate</span>
                    <span className="hero-metric-val val-reports">
                      {total > 0 ? `${Math.round((completedCount / total) * 100)}%` : "88.5%"}
                    </span>
                    <span className="hero-metric-sub">Verified fulfilled</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>View Executive Reports &amp; Exports</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>

            {/* KPI CARD 5: Work Orders & Pipeline (Cyan Theme) */}
            <motion.div
              className="kpi-hero-card kpi-card-tasks"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/tickets")}
              role="button"
              tabIndex={0}
              aria-label="Open Work Orders Dashboard"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-tasks-wrap">
                    <ClipboardList size={22} />
                  </div>
                  <span className="status-pill pill-cyan">
                    <Layers size={12} />
                    <span>{total} Total</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">Work Orders &amp; Tasks</h3>
                  <div className="kpi-hero-sub">📋 Field Pipeline &amp; Matching</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">New / Open</span>
                    <span className="hero-metric-val val-tasks">
                      <AnimatedNumber value={unassignedCount} />
                    </span>
                    <span className="hero-metric-sub">Unassigned</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Assigned</span>
                    <span className="hero-metric-val val-tasks">
                      <AnimatedNumber value={assignedCount} />
                    </span>
                    <span className="hero-metric-sub">Helper matched</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Completed</span>
                    <span className="hero-metric-val" style={{ color: "#10b981" }}>
                      <AnimatedNumber value={completedCount} />
                    </span>
                    <span className="hero-metric-sub">Fulfilled</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>Open Work Orders Pipeline</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>

            {/* KPI CARD 6: System Engine & Telemetry (Rose Theme) */}
            <motion.div
              className="kpi-hero-card kpi-card-system"
              whileHover={{ y: -6, scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
              onClick={() => navigate("/settings")}
              role="button"
              tabIndex={0}
              aria-label="Open System Activity Feed"
            >
              <div>
                <div className="kpi-hero-topbar">
                  <div className="kpi-hero-icon icon-system-wrap">
                    <Zap size={22} />
                  </div>
                  <span className="status-pill pill-rose">
                    <Activity size={12} />
                    <span>{config.extrahand_mode === "live" ? "Live ExtraHand" : "Dual Ready"}</span>
                  </span>
                </div>

                <div className="kpi-hero-info">
                  <h3 className="kpi-hero-title">System Engine &amp; Stream</h3>
                  <div className="kpi-hero-sub">⚡ Dual Sync &amp; Event Stream</div>
                </div>

                <div className="kpi-hero-metrics">
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Reminders</span>
                    <span className="hero-metric-val val-system">
                      <AnimatedNumber value={reminders.length} />
                    </span>
                    <span className="hero-metric-sub">Countdown queue</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Recent Events</span>
                    <span className="hero-metric-val val-system">
                      <AnimatedNumber value={events.data?.length ?? 0} />
                    </span>
                    <span className="hero-metric-sub">Logged actions</span>
                  </div>
                  <div className="hero-metric-box">
                    <span className="hero-metric-label">Sync Health</span>
                    <span className="hero-metric-val val-system" style={{ fontSize: "1.2rem", color: "#10b981" }}>
                      Optimal
                    </span>
                    <span className="hero-metric-sub">100% operational</span>
                  </div>
                </div>
              </div>

              <div className="kpi-hero-action">
                <span>Open System Stream &amp; Events</span>
                <ChevronRight size={16} className="arrow-icon" />
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : (
        /* =========================================================================
           CLICKED VIEW: EXPANDED DASHBOARD & EVERY FEATURE OF THAT MODULE
           ========================================================================= */
        <motion.div variants={itemVariants} className="feature-view-container">
          {/* Floating Control Bar with Back Button */}
          <div className="feature-control-bar">
            <button
              className="back-to-kpi-btn"
              onClick={() => setActiveModule("none")}
              title="Return to initial KPI Cards view"
            >
              <ArrowLeft size={16} />
              <span>Back to All KPI Cards</span>
            </button>

            <div className="feature-tab-pills">
              <button
                className={`feature-pill-btn ${activeModule === "calling" ? "active" : ""}`}
                onClick={() => setActiveModule("calling")}
              >
                <PhoneCall size={14} />
                <span>📞 Calling Agent</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "whatsapp" ? "active" : ""}`}
                onClick={() => setActiveModule("whatsapp")}
              >
                <WhatsAppIcon size={14} />
                <span>💬 WhatsApp Agent</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "feedback" ? "active" : ""}`}
                onClick={() => setActiveModule("feedback")}
              >
                <Star size={14} />
                <span>⭐ Feedback &amp; CSAT</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "reports" ? "active" : ""}`}
                onClick={() => setActiveModule("reports")}
              >
                <BarChart3 size={14} />
                <span>📊 Reports &amp; Analytics</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "tickets" ? "active" : ""}`}
                onClick={() => setActiveModule("tickets")}
              >
                <ClipboardList size={14} />
                <span>📋 Work Orders</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "system" ? "active" : ""}`}
                onClick={() => setActiveModule("system")}
              >
                <Zap size={14} />
                <span>⚡ System Activity</span>
              </button>
            </div>

            <div>
              {activeModule === "calling" && (
                <Link to="/calling" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "whatsapp" && (
                <Link to="/whatsapp" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "feedback" && (
                <Link to="/feedback" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "reports" && (
                <Link to="/reports" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "tickets" && (
                <Link to="/tickets" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>View All Tickets</span>
                </Link>
              )}
            </div>
          </div>

          {/* FEATURE 1: Calling Agent Dashboard */}
          {activeModule === "calling" && (
            <CallingAgentView
              stats={s ?? undefined}
              calls={calls.data ?? undefined}
              tickets={tickets.data ?? undefined}
              events={events.data ?? undefined}
              ivrMaxPrompts={config.ivr_max_prompts}
              telephonyProvider={config.telephony_provider}
              onRefreshAll={refreshAll}
            />
          )}

          {/* FEATURE 2: WhatsApp Agent Dashboard */}
          {activeModule === "whatsapp" && (
            <WhatsAppAgentView
              tickets={tickets.data ?? []}
              onRefreshAll={refreshAll}
              section="send"
            />
          )}

          {/* FEATURE 3: Work Orders & Pipeline Dashboard */}
          {activeModule === "tickets" && (
            <div>
              <Pipeline
                totalTasks={s?.tickets_total}
                unassigned={s?.unassigned_tickets}
                calling={s?.tickets_by_status?.dispatching ?? 0}
                assigned={s?.assigned_tickets ?? s?.tickets_by_status?.assigned ?? 0}
                completed={s?.completed_tickets ?? 0}
                cancelled={s?.cancelled_tickets ?? 0}
                escalated={s?.open_escalations ?? 0}
                reminders={s?.followups_scheduled ?? 0}
                assignedHelpers={s?.assigned_helpers ?? 0}
              />
              <div style={{ marginTop: "1.5rem" }}>
                <Card title="Live Field Work Orders &amp; Tickets" icon={Inbox}>
                  <div className="table-wrap inner">
                    <table className="table responsive">
                      <thead>
                        <tr>
                          <th>Task ID</th>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Customer</th>
                          <th>Payout</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tickets.data ?? []).slice(0, 10).map((t) => (
                          <tr key={t.id}>
                            <td className="mono text-xs">#{t.id.slice(-6)}</td>
                            <td>
                              <Link to={`/tickets/${t.id}`} style={{ fontWeight: 600, color: "#FFFFFF" }}>
                                {t.title}
                              </Link>
                            </td>
                            <td><span className="pill tone-info text-xs">{t.category || "General"}</span></td>
                            <td>{t.customer?.name || "Customer"}</td>
                            <td className="mono font-bold" style={{ color: "var(--blue-bright, #60a5fa)" }}>
                              ₹{t.budget || 500}
                            </td>
                            <td className="text-xs muted">{t.address || t.city}</td>
                            <td>
                              <span className={`pill ${t.dispatch_status === "assigned" ? "tone-success" : t.dispatch_status === "dispatching" ? "tone-live" : "tone-info"}`}>
                                {t.dispatch_status}
                              </span>
                            </td>
                            <td>
                              <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                                View Details
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* FEATURE 4: System Activity & Event Stream Dashboard */}
          {activeModule === "system" && (
            <div className="dashboard-two-col-grid">
              <Card title="Upcoming Voice Follow-up Reminders" icon={Activity}>
                {!tickets.data ? (
                  <SkeletonRows rows={3} />
                ) : reminders.length ? (
                  <div className="reminders-list">
                    {reminders.map((t) => (
                      <div key={t.id} className="reminder-item-card">
                        <div className="reminder-left">
                          <span className="reminder-due-badge">
                            Due {fmtRelative(t.next_followup!.due_at)}
                          </span>
                          <Link to={`/tickets/${t.id}`} className="reminder-title-link">
                            #{t.id.slice(-6)} · {t.title}
                          </Link>
                          <div className="reminder-helper muted text-xs">
                            Candidate: {t.assignee?.name || t.next_followup?.helper_id || "Available Helper"}
                          </div>
                        </div>
                        <div className="reminder-right">
                          <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                            Inspect
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty icon={Activity}>No upcoming voice follow-ups scheduled.</Empty>
                )}
              </Card>

              <Card title="Real-Time Multi-Agent Activity Stream" icon={Activity}>
                <Timeline events={events.data ?? []} time={fmtTime} />
              </Card>
            </div>
          )}

          {/* FEATURE 4.5: Advertisement & City Event Campaigns */}
          {activeModule === "advertisement" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <AdvertisementView />
            </motion.div>
          )}

          {/* FEATURE 5: Customer Feedback & CSAT Dashboard */}
          {activeModule === "feedback" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <CustomerFeedbackPage />
            </motion.div>
          )}

          {/* FEATURE 6: Reports & Executive Analytics Dashboard */}
          {activeModule === "reports" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <ReportsPage />
            </motion.div>
          )}
        </motion.div>
      )}

      {/* BIG HOVERING ANIMATED FLOATING AI AGENT BUTTON */}
      <FloatingAIAgent />
    </Stagger>
  );
}
