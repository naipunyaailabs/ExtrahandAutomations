import {
  Activity,
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Radio,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { useUrlState } from "../hooks";
import { countryDigits, taskLink, useBranding } from "../branding";
import { useToast, WhatsAppIcon } from "./ui";
import { useConfig } from "./Layout";
import { AnimatedNumber } from "./motion";
import { TaskBoard } from "./TaskBoard";
import { TaskDetailView } from "../pages/TicketDetail";
import { WhatsAppAutomationFlow } from "./WhatsAppAutomationFlow";
import { TaskAlertTemplate } from "./TaskAlertTemplate";
import { WhatsAppBulkMessaging } from "./WhatsAppBulkMessaging";
import type {
  Ticket,
  WhatsAppStatus,
  TaskLocationCandidateHelper,
  WhatsAppBroadcastResult,
  Helper,
  EventItem,
} from "../types";

export type WhatsAppSection = "dispatch" | "dashboard" | "send" | "orders" | "replies" | "device" | "bulk";





interface WhatsAppAgentViewProps {
  section: WhatsAppSection;
  tickets: Ticket[];
  helpers?: Helper[];
  events?: EventItem[];
  onRefreshAll: () => void;
}

export function WhatsAppAgentView({
  section,
  tickets,
  helpers = [],
  events = [],
  onRefreshAll,
}: WhatsAppAgentViewProps) {
  const toast = useToast();
  const branding = useBranding();
  const config = useConfig();
  const matchRadiusKm = config?.runtime?.match_radius_km ?? null;
  const radiusText = matchRadiusKm != null ? `${matchRadiusKm} km` : "configured radius";
  const syncMinutes = config?.sync_interval_seconds ? Math.max(1, Math.round(config.sync_interval_seconds / 60)) : null;
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  // Test mode comes from the backend (WHATSAPP_SIMULATED); Meta hosts the number, so there is nothing to pair
  const isSimulated = Boolean(config?.whatsapp_simulated || status?.simulated);

  // WhatsApp Channel Controls: Automation & Bulk Messaging (Active / Inactive)
  // Both channels start DEACTIVE; the real state is loaded from the server below
  const [automationActive, setAutomationActive] = useState<boolean>(false);
  const [isTogglingChannel, setIsTogglingChannel] = useState<string | null>(null);

  // Active / Available Tasks
  const availableTickets = tickets.length > 0 ? tickets : [];

  // Computed stats for Dashboard, Charts & Analytics
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      const cat = (t.category || "General").trim();
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const total = tickets.length || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({
        name,
        count,
        percent: Math.min(100, Math.round((count / total) * 100)),
      }));
  }, [tickets]);

  const recentDispatches = useMemo(() => {
    return (events || [])
      .filter((e) => e.kind.includes("whatsapp") || e.kind.includes("created") || e.kind.includes("synced"))
      .slice(0, 5);
  }, [events]);

  // Date comparison logic: compares task scheduled_at or created_at with today's date
  const getTicketDateInfo = (t: Ticket | null | undefined) => {
    if (!t) return { status: "past", label: "Date unspecified", isToday: false, isUpcoming: false, isPast: true, badge: "Previous", diffDays: -1 };
    const dtStr = t.scheduled_at || t.created_at;
    if (!dtStr) return { status: "past", label: "Date unspecified", isToday: false, isUpcoming: false, isPast: true, badge: "Previous", diffDays: -1 };
    const d = new Date(dtStr);
    const now = new Date();
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // The backend decides "today" (booked today or scheduled for today, India time) - same as the dashboards
    const diffDays =
      typeof t.days_from_today === "number" ? t.days_from_today : Math.round((dDay - nowDay) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return {
        status: "today",
        label: `Today (${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        badge: "Current",
        isToday: true,
        isUpcoming: false,
        isPast: false,
        diffDays: 0
      };
    } else if (diffDays > 0) {
      return {
        status: "upcoming",
        label: `In ${diffDays} day${diffDays > 1 ? 's' : ''} (${d.toLocaleDateString([], { month: 'short', day: 'numeric' })})`,
        badge: `In ${diffDays} day${diffDays > 1 ? 's' : ''}`,
        isToday: false,
        isUpcoming: true,
        isPast: false,
        diffDays
      };
    } else {
      const pastDays = Math.abs(diffDays);
      return {
        status: "past",
        label: `${pastDays} day${pastDays > 1 ? 's' : ''} ago (${d.toLocaleDateString([], { month: 'short', day: 'numeric' })})`,
        badge: "Previous",
        isToday: false,
        isUpcoming: false,
        isPast: true,
        diffDays
      };
    }
  };

  const todayCount = useMemo(() => availableTickets.filter(t => getTicketDateInfo(t).isToday).length, [availableTickets]);
  const upcomingCount = useMemo(() => availableTickets.filter(t => getTicketDateInfo(t).isUpcoming).length, [availableTickets]);

  // Selected task state
  // The open task is kept in the URL (?task=<id>): a reload stays on it, Back returns to the task list
  const [openTaskId, openTask, backToTaskList] = useUrlState<string>("task", "", { push: true });
  const selectedTicketId = openTaskId || availableTickets[0]?.id || "";

  const selectedTicket = availableTickets.find((t) => t.id === selectedTicketId) || availableTickets[0];

  // SubView: "list" (Master list of all tasks with arrow) or "detail" (Task detail & helper drill-down)
  const subView: "list" | "detail" = openTaskId ? "detail" : "list";

  const [locationCandidates, setLocationCandidates] = useState<TaskLocationCandidateHelper[]>([]);
  const [, setLoadingCandidates] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<WhatsAppBroadcastResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [deliveredPhones, setDeliveredPhones] = useState<Set<string>>(new Set());

  // Dynamic candidate computation strictly matching task's city and service taxonomy
  const activeCandidates = useMemo<TaskLocationCandidateHelper[]>(() => {
    const list = locationCandidates ?? [];
    // If ticket has an assignee, ensure they are in the list with In Progress status
    if (selectedTicket?.assignee && selectedTicket.assignee.name) {
      const exists = list.some(
        c => c.helper_id === selectedTicket.assignee?.id ||
             (selectedTicket.assignee?.phone && c.phone.includes(selectedTicket.assignee.phone.slice(-8)))
      );
      if (!exists) {
        return [
          {
            helper_id: selectedTicket.assignee.id || "assigned-active",
            name: selectedTicket.assignee.name,
            phone: selectedTicket.assignee.phone || "",
            skills: selectedTicket.category ? [selectedTicket.category] : [],
            city: selectedTicket.city || null,
            distance_km: null,
          },
          ...list,
        ];
      }
    }
    return list;
  }, [locationCandidates, selectedTicket]);


  // Load location candidates whenever selected task changes
  useEffect(() => {
    if (!selectedTicketId) return;
    let cancelled = false;
    setLoadingCandidates(true);
    api.whatsapp.taskCandidates(selectedTicketId)
      .then((res) => {
        if (!cancelled) {
          setLocationCandidates(res.helpers || res.candidates || []);
        }
      })
      .catch((err) => {
        console.warn("Could not load location candidates:", err);
        if (!cancelled) setLocationCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTicketId]);

  const appTaskUrl = selectedTicket ? taskLink(branding, selectedTicket.id) : "";

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await api.whatsapp.status();
      setStatus(res);
      if (typeof res.automation_active === "boolean") {
        setAutomationActive(res.automation_active);
      }
    } catch (e: unknown) {
      console.warn("Could not fetch WhatsApp status:", e);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Also load initial channel control settings
    api.whatsapp
      .channelControls()
      .then((controls) => {
        if (typeof controls.automation_active === "boolean") setAutomationActive(controls.automation_active);
      })
      .catch(() => {});

    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAutomation = async () => {
    const nextVal = !automationActive;
    setAutomationActive(nextVal);
    setIsTogglingChannel("automation");
    try {
      const res = await api.whatsapp.toggleChannel({ automation_active: nextVal });
      if (typeof res.automation_active === "boolean") {
        setAutomationActive(res.automation_active);
      }
      toast.success(
        nextVal ? "WhatsApp Automation: ACTIVE" : "WhatsApp Automation: INACTIVE",
        nextVal
          ? "Automated task dispatches & work orders can now send messages."
          : "Automation messaging is paused and cannot send messages."
      );
    } catch (err) {
      setAutomationActive(!nextVal);
      toast.error("Toggle Failed", "Could not toggle WhatsApp Automation channel.");
    } finally {
      setIsTogglingChannel(null);
    }
  };



  const handleBroadcastToLocationHelpers = async () => {
    if (!automationActive) {
      toast.error(
        "Automation Inactive",
        "WhatsApp Automation is currently turned OFF. Toggle Automation to Active at the top to broadcast work orders."
      );
      return;
    }
    if (!selectedTicket) {
      toast.error("No task selected", "Please select a task to broadcast.");
      return;
    }
    setBroadcasting(true);
    try {
      const res = await api.whatsapp.broadcastTask(selectedTicket.id);
      setBroadcastResult(res);
      // Only messages WhatsApp actually accepted are marked as delivered (simulated / failed ones are not)
      const newDelivered = new Set(deliveredPhones);
      (res.candidates || []).forEach((c) => {
        if (c.status !== "sent" && c.status !== "delivered") return;
        const p = (c.phone || "").replace(/[^0-9]/g, "").slice(-10);
        if (p) newDelivered.add(p);
      });
      setDeliveredPhones(newDelivered);

      const where = res.location || selectedTicket.city || "the task area";
      const sent = res.sent_count || 0;
      const simulated = res.simulated_count || 0;
      const failed = res.failed_count || 0;
      if (!res.ok) {
        toast.error("Broadcast not sent", res.summary || "No helpers found in this location");
      } else if (sent > 0) {
        toast.success(
          "WhatsApp alert sent",
          `Sent to ${sent} helper(s) in ${where}.${failed ? ` ${failed} failed.` : ""}${simulated ? ` ${simulated} only simulated.` : ""}`
        );
      } else if (simulated > 0) {
        toast.info("Test mode only", `${simulated} message(s) were simulated in ${where}. No real WhatsApp message was sent.`);
      } else {
        toast.error("Broadcast failed", failed ? `All ${failed} message(s) failed to send.` : res.summary || "No message was sent.");
      }
      onRefreshAll();
    } catch (e: unknown) {
      // The request failed: nothing was sent, so nothing is marked as delivered
      toast.error("Broadcast failed", (e as Error)?.message || "Could not reach the WhatsApp service. No message was sent.");
    } finally {
      setBroadcasting(false);
    }
  };

  const connected = status?.status === "WORKING";

  const statusPills = (
    <div className="agent-status-pills">
      <div className="agent-pill" title="Meta WhatsApp Business Cloud API Connection">
        <span className={`dot ${connected ? "success" : "live"}`} />
        <span>Gateway: <b>{connected ? "Live Meta API" : isSimulated ? "Simulated (test mode)" : status ? `Not connected (${status.status})` : "Checking…"}</b></span>
      </div>
      <div className="agent-pill" title="Admin WhatsApp Dispatch Line">
        <Smartphone size={14} style={{ color: "#10b981" }} />
        <span>Admin: <b className="mono">{status?.phone_number || "—"}</b></span>
      </div>
    </div>
  );

  const header = (title: string, text: string, actions?: ReactNode) => (
    <div className="wa-section-head">
      <div>
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      {actions && <div className="wa-section-actions">{actions}</div>}
    </div>
  );


  const isDispatch = section === "dispatch";
  const isDashboard = section === "dashboard" || section === "orders";
  const isSend = section === "send" || section === "replies";

  const messagesTodayCount = status?.messages_today ?? 0;
  const totalMessagesSentCount = status?.messages_total ?? 0;
  const deliveryRate = status?.delivery_rate ?? "—";

  return (
    <div className="agent-features-container whatsapp-theme">
      {/* =========================================================================
          VIEW 0: WHATSAPP DISPATCH DASHBOARD (DEDICATED MODULE: ANIMATED FLOW ONLY)
          ========================================================================= */}
      {isDispatch && (
        <div className="whatsapp-dispatch-dedicated-view" style={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
          {/* Animated Interactive Flow Diagram */}
          <WhatsAppAutomationFlow
            tickets={tickets}
            helpers={helpers}
            status={status}
            automationActive={automationActive}
            onToggleAutomation={handleToggleAutomation}
            isTogglingChannel={isTogglingChannel}
            onRefresh={onRefreshAll}
          />

          {/* The message every matching helper receives for a new task */}
          <TaskAlertTemplate />
        </div>
      )}

      {/* =========================================================================
          VIEW 1: WHATSAPP DASHBOARD (Hero, 6 KPI Cards, Demand Chart, Logs)
          ========================================================================= */}
      {isDashboard && (
        <>
          {header(
            "WhatsApp Agent Overview",
            "Real-time autonomous dispatch telemetry, partner network capacity, and live WhatsApp delivery pipeline.",
            statusPills,
          )}

          <div className="wa-tasks-master-view">
            {/* ANIMATED WHATSAPP AGENT CONSOLE HERO BANNER */}
            <div className="whatsapp-console-hero">
              {/* Top Row: Identity & Status + Refresh */}
              <div className="whatsapp-hero-top-row">
                <div className="whatsapp-agent-identity">
                  <div className="whatsapp-avatar-beacon">
                    <span className="beacon-ring" />
                    <span className="beacon-ring r2" />
                    <Send size={22} style={{ transform: "rotate(-10deg)" }} />
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <h2 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, color: "var(--text)", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>AI WhatsApp Dispatch Agent</span>
                        <div className="whatsapp-signal-waves" title="Autonomous dispatch engine active">
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                      </h2>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                      <span className={`pill ${automationActive ? "tone-success" : "tone-neutral"}`} style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                        <span className="live-dot" style={{ background: automationActive ? "#10b981" : "#94a3b8" }} />
                        <span>
                          {automationActive ? "Automation on" : "Automation paused"}
                          {syncMinutes ? ` · ExtraHand sync every ${syncMinutes} min` : ""}
                        </span>
                      </span>

                      <span className="tag" style={{ margin: 0, fontSize: "11px" }}>
                        <Radio size={11} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                        {status?.status === "WORKING"
                          ? "Gateway: Live Paired"
                          : isSimulated
                          ? "Gateway: Simulated (test mode)"
                          : `Gateway: Not connected${status ? ` (${status.status})` : ""}`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Sync */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onRefreshAll}
                    style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  >
                    <RefreshCw size={13} />
                    <span>Sync Live ExtraHand</span>
                  </button>
                </div>
              </div>

              {/* Middle Row: 6-in-a-row KPI Metrics Strip including Messages Sent Today & Total */}
              <div className="whatsapp-kpi-bar">
                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Active Tasks</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#059669" }}>
                    <AnimatedNumber value={tickets.length} />
                  </span>
                  <span className="whatsapp-kpi-sub">
                    <span style={{ color: "#059669", fontWeight: 600 }}>{todayCount} Today</span> · {upcomingCount} Upcoming
                  </span>
                </div>

                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Messages Today</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#10b981" }}>
                    <AnimatedNumber value={messagesTodayCount} />
                  </span>
                  <span className="whatsapp-kpi-sub">
                    <span style={{ color: "#059669", fontWeight: 600 }}>{deliveryRate}</span> Delivered Today
                  </span>
                </div>

                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Total Messages Sent</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#2563eb" }}>
                    <AnimatedNumber value={totalMessagesSentCount} />
                  </span>
                  <span className="whatsapp-kpi-sub">
                    Meta Cloud API Dispatches
                  </span>
                </div>

                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Auto Match Radius</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#d97706" }}>
                    {matchRadiusKm != null ? `${matchRadiusKm} km` : "—"}
                  </span>
                  <span className="whatsapp-kpi-sub">
                    From Settings · GPS distance
                  </span>
                </div>

                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Not Delivered</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#dc2626" }}>
                    <AnimatedNumber value={status?.messages_failed_total ?? 0} />
                  </span>
                  <span className="whatsapp-kpi-sub">
                    Failed · {status?.messages_simulated_total ?? 0} test-only (simulated)
                  </span>
                </div>
              </div>
            </div>

            {/* VISUAL ANALYTICS & CHARTS GRID */}
                <div className="whatsapp-charts-grid">
                  {/* Chart 1: Service Demand Distribution */}
                  <div className="whatsapp-chart-card">
                    <div className="whatsapp-chart-head">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <BarChart3 size={16} style={{ color: "#059669" }} />
                        <span style={{ fontWeight: 700, fontSize: "13px" }}>Service Category Demand</span>
                      </div>
                      <span className="badge" style={{ fontSize: "11px", background: "var(--surface-2)" }}>
                        {tickets.length} total works
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                      {categoryStats.map((c) => (
                        <div key={c.name} className="whatsapp-bar-item">
                          <div className="whatsapp-bar-meta">
                            <span style={{ fontWeight: 600, color: "var(--text)" }}>{c.name}</span>
                            <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                              {c.count} tasks ({c.percent}%)
                            </span>
                          </div>
                          <div className="whatsapp-bar-track">
                            <div className="whatsapp-bar-fill" style={{ width: `${Math.max(c.percent, 8)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Chart 2: Recent Live Autonomous Dispatch Activity */}
                  <div className="whatsapp-chart-card">
                    <div className="whatsapp-chart-head">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Activity size={16} style={{ color: "#0284c7" }} />
                        <span style={{ fontWeight: 700, fontSize: "13px" }}>Live Engine Activity</span>
                      </div>
                      <span className={`pill ${automationActive ? "tone-live" : "tone-neutral"}`} style={{ fontSize: "11px" }}>
                        {automationActive ? <><span className="live-dot" /> Listening</> : "Paused"}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                      {recentDispatches.length === 0 ? (
                        <div style={{ padding: "16px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
                          Engine is active. Ready to broadcast incoming customer tasks.
                        </div>
                      ) : (
                        recentDispatches.map((e) => (
                          <div
                            key={e.id}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              padding: "6px 8px",
                              borderRadius: "8px",
                              background: "var(--surface-2)",
                              fontSize: "12px",
                            }}
                          >
                            <CheckCircle2 size={14} style={{ color: "#059669", flexShrink: 0, marginTop: "2px" }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {e.message}
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {e.created_at ? new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 2: SEND WORK ORDER (Tasks List, Search, Date Filters, Helper Broadcast)
              ========================================================================= */}
          {isSend && (
            <>
              {header(
                "Send Work Order",
                "Broadcast customer tasks via WhatsApp to helpers matching BOTH the location area and the specific service skill.",
                statusPills,
              )}

              {subView === "list" ? (
                <TaskBoard tickets={tickets} onOpenTask={openTask} onChanged={onRefreshAll} />
            ) : (
              <TaskDetailView
                id={openTaskId}
                onBack={backToTaskList}
                backLabel="Back to all tasks"
                helperAction={(h) => {
                  const digits = (h.phone || "").replace(/\D/g, "");
                  const phone = digits.length === 10 ? `${countryDigits(branding)}${digits}` : digits;
                  const text = `Hi ${h.name || "Helper"}, booking ${selectedTicket?.title || "Task"} is available in ${selectedTicket?.city || "your area"}: ${appTaskUrl}`;
                  return phone ? (
                    <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
                      className="wa-direct-chat-btn" title="Open a direct WhatsApp chat with this helper">
                      <WhatsAppIcon size={13} /> <span>Direct Chat</span>
                    </a>
                  ) : null;
                }}
                extra={
                  <section className="card wa-msg-card">
                    <header className="wa-msg-head">
                      <div>
                        <h3><WhatsAppIcon size={16} /> WhatsApp message to helpers</h3>
                        <p className="small muted">Meta template format · exactly what every matched helper receives for this task</p>
                      </div>
                      <div className="wa-send-head-badges">
                        <span className={`wa-head-badge ${automationActive ? "active" : ""}`}>
                          {automationActive && <span className="wa-badge-pulse" />}
                          <span>{automationActive ? `Location & skill matching on (${radiusText})` : "Automation paused"}</span>
                        </span>
                        <span className="wa-head-badge meta">
                          <WhatsAppIcon size={13} />
                          <span>{connected ? "Meta Cloud API connected" : isSimulated ? "Test mode (simulated)" : "Meta Cloud API not connected"}</span>
                        </span>
                      </div>
                    </header>
                    <div className="wa-msg-grid">
                      <TaskAlertTemplate ticketId={openTaskId} compact />
                      <div className="wa-msg-side">
                      <div>
                        <div className="text-xs muted" style={{ marginBottom: "5px", fontWeight: 650, color: "var(--text-2)" }}>Direct Task In-App Link (Sent in WhatsApp):</div>
                        <div className="wa-copy-link-box">
                          <span className="wa-copy-link-url">
                            {appTaskUrl}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: "4px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "5px", borderRadius: "6px" }}
                            onClick={() => {
                              navigator.clipboard.writeText(appTaskUrl);
                              setCopiedLink(true);
                              setTimeout(() => setCopiedLink(false), 2000);
                              toast.success("Link copied", "Direct task URL copied to clipboard.");
                            }}
                          >
                            {copiedLink ? <Check size={12} style={{ color: "#059669" }} /> : <Copy size={12} />}
                            <span>{copiedLink ? "Copied" : "Copy"}</span>
                          </button>
                        </div>
                      </div>
                      {/* Warning banner if WhatsApp Automation is Inactive */}
                      {!automationActive && (
                        <div
                          style={{
                            marginBottom: "0.85rem",
                            padding: "9px 14px",
                            borderRadius: "8px",
                            background: "rgba(239, 68, 68, 0.08)",
                            border: "1.5px solid rgba(239, 68, 68, 0.35)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "8px",
                            fontSize: "12.5px",
                            color: "#991b1b",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <AlertCircle size={16} style={{ color: "#ef4444", flexShrink: 0 }} />
                            <span>
                              <strong>WhatsApp Automation is OFF:</strong> task alerts can't be sent. Click <strong>Activate Automation</strong> to turn it on.
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={handleToggleAutomation}
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              background: "#ef4444",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Activate Automation
                          </button>
                        </div>
                      )}

                      {/* Primary Broadcast Action Button */}
                      <motion.button
                        whileHover={automationActive ? { scale: 1.01 } : {}}
                        whileTap={automationActive ? { scale: 0.98 } : {}}
                        className="wa-broadcast-submit-btn"
                        onClick={handleBroadcastToLocationHelpers}
                        disabled={broadcasting || !automationActive}
                        style={
                          !automationActive
                            ? {
                                background: "#f87171",
                                borderColor: "#f87171",
                                cursor: "not-allowed",
                              }
                            : undefined
                        }
                      >
                        {broadcasting ? (
                          <RefreshCw size={16} className="spin" />
                        ) : (
                          <WhatsAppIcon size={17} />
                        )}
                        <span>
                          {!automationActive
                            ? "Can't send: WhatsApp Automation is OFF"
                            : broadcasting
                            ? "Broadcasting via WhatsApp..."
                            : `Broadcast via WhatsApp to All (${activeCandidates.length}) Matched Helpers`}
                        </span>
                      </motion.button>
                  {/* Broadcast Delivery Confirmation / Status Card */}
                  {broadcastResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        marginTop: "0.5rem",
                        padding: "1rem",
                        borderRadius: "12px",
                        background: broadcastResult.ok ? "#f0fdf4" : "#fef2f2",
                        border: `1.5px solid ${broadcastResult.ok ? "#bbf7d0" : "#fecaca"}`
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        {broadcastResult.ok ? (
                          <CheckCircle2 size={18} style={{ color: "#059669" }} />
                        ) : (
                          <AlertCircle size={18} style={{ color: "#ef4444" }} />
                        )}
                        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 750, color: broadcastResult.ok ? "#065f46" : "#991b1b" }}>
                          {broadcastResult.ok ? "WhatsApp Broadcast Completed!" : "Broadcast Report"}
                        </h4>
                      </div>

                      <p className="text-xs" style={{ margin: "4px 0 6px 0", color: "var(--text)" }}>
                        {broadcastResult.summary}
                      </p>
                      <div className="text-xs muted" style={{ fontWeight: 600 }}>
                        {broadcastResult.sent_count} sent · {broadcastResult.simulated_count} simulated · {broadcastResult.failed_count} failed
                      </div>
                    </motion.div>
                  )}
                      </div>
                    </div>
                  </section>
                }
              />
        )}
      </>
    )}

      {section === "device" && (
        <>
          {header(
            "Meta WhatsApp connection",
            "Messages go out through Meta's official WhatsApp Business Cloud API. Meta hosts the number, so there is no phone to pair.",
            <button className="btn btn-ghost btn-sm" onClick={fetchStatus} disabled={loadingStatus}>
              <RefreshCw size={13} className={loadingStatus ? "spin" : ""} />
              <span>Check again</span>
            </button>,
          )}
          <div className="agent-grid">
            <div className="agent-box">
              <div className="agent-box-head">
                <div className="agent-box-title">
                  <Smartphone size={16} style={{ color: "#25D366" }} />
                  <span>Connection status</span>
                </div>
                <span className={`agent-tag ${connected ? "wa-tag-ok" : ""}`}>
                  {connected ? "Connected" : isSimulated ? "Test mode" : status?.status === "AUTH_FAILED" ? "Token problem" : "Not connected"}
                </span>
              </div>
              <dl className="wa-task-facts">
                <div><dt>Status</dt><dd>{status?.status ? status.status.replace(/_/g, " ") : "Checking…"}</dd></div>
                <div><dt>Sending number</dt><dd className="mono">{status?.phone_number || "—"}</dd></div>
                <div><dt>Business name</dt><dd>{status?.verified_name || "—"}</dd></div>
                <div><dt>Quality rating</dt><dd>{status?.quality_rating || "—"}</dd></div>
                <div><dt>Phone number ID</dt><dd className="mono">{status?.phone_number_id || "Not set"}</dd></div>
                <div><dt>API version</dt><dd>{status?.api_version || "—"}</dd></div>
              </dl>
              {status?.error && (
                <div className="error-note" style={{ marginTop: "10px", fontSize: "12.5px" }}>{status.error}</div>
              )}
            </div>

            <div className="agent-box">
              <div className="agent-box-head">
                <div className="agent-box-title">
                  <WhatsAppIcon size={16} />
                  <span>{connected ? "All set" : "How to fix"}</span>
                </div>
              </div>
              {connected ? (
                <p className="text-sm muted">
                  Meta accepted the number and token. Task alerts, work orders and bulk messages are sent from{" "}
                  <b>{status?.phone_number || "your WhatsApp Business number"}</b>.
                </p>
              ) : isSimulated ? (
                <p className="text-sm muted">
                  Test mode is on (<span className="mono">WHATSAPP_SIMULATED=true</span>): messages are only recorded, not sent.
                  Set it to <span className="mono">false</span> in the backend <span className="mono">.env</span> to send real messages.
                </p>
              ) : status?.status === "AUTH_FAILED" ? (
                <ol className="text-sm" style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "6px" }}>
                  <li>The Meta access token has expired or is wrong.</li>
                  <li>In Meta Business Settings › System users, generate a <b>permanent</b> token with WhatsApp messaging permission.</li>
                  <li>Put it in <span className="mono">META_WA_ACCESS_TOKEN</span> in the backend <span className="mono">.env</span> and restart the backend.</li>
                </ol>
              ) : status?.status === "NOT_CONFIGURED" ? (
                <p className="text-sm muted">
                  Set <span className="mono">META_WA_PHONE_NUMBER_ID</span> and <span className="mono">META_WA_ACCESS_TOKEN</span> in the backend{" "}
                  <span className="mono">.env</span>, then restart the backend.
                </p>
              ) : (
                <p className="text-sm muted">Could not reach Meta right now. Check the server's internet connection and try again.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* =========================================================================
          VIEW 4: BULK MESSAGING MODULE (Recipients, Templates, Dynamic Tags, Dispatch)
          ========================================================================= */}
      {section === "bulk" && (
        <WhatsAppBulkMessaging
          status={status}
          onRefreshStatus={fetchStatus}
        />
      )}

    </div>
  );
}
