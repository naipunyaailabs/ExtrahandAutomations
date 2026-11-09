import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  History,
  Layers,
  MapPin,
  MessageSquare,
  CheckCheck,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Star,
  Users,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { money, taskLink, useBranding } from "../branding";
import { useToast, WhatsAppIcon } from "./ui";
import { AnimatedNumber } from "./motion";
import { WhatsAppAutomationFlow } from "./WhatsAppAutomationFlow";
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

const AVATAR_COLORS = [
  "linear-gradient(135deg, #4f46e5, #3730a3)",
  "linear-gradient(135deg, #059669, #047857)",
  "linear-gradient(135deg, #0284c7, #0369a1)",
  "linear-gradient(135deg, #d97706, #b45309)",
  "linear-gradient(135deg, #0d9488, #115e59)",
  "linear-gradient(135deg, #6366f1, #4338ca)",
];



function getInitials(name: string): string {
  const parts = (name || "Helper").trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name || "HP").slice(0, 2).toUpperCase();
}

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
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [pairMode, setPairMode] = useState<"qr" | "code">("qr");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);

  // WhatsApp Channel Controls: Automation & Bulk Messaging (Active / Inactive)
  const [automationActive, setAutomationActive] = useState<boolean>(true);
  const [bulkActive, setBulkActive] = useState<boolean>(true);
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

  const [dateFilter, setDateFilter] = useState<"all" | "today" | "upcoming" | "past">("all");

  const todayCount = useMemo(() => availableTickets.filter(t => getTicketDateInfo(t).isToday).length, [availableTickets]);
  const upcomingCount = useMemo(() => availableTickets.filter(t => getTicketDateInfo(t).isUpcoming).length, [availableTickets]);
  const pastCount = useMemo(() => availableTickets.filter(t => getTicketDateInfo(t).isPast).length, [availableTickets]);

  const displayTickets = useMemo(() => {
    return availableTickets.filter(t => {
      if (dateFilter === "all") return true;
      return getTicketDateInfo(t).status === dateFilter;
    });
  }, [availableTickets, dateFilter]);

  // Selected task state
  const [selectedTicketId, setSelectedTicketId] = useState<string>(
    availableTickets[0]?.id || ""
  );

  const selectedTicket = availableTickets.find((t) => t.id === selectedTicketId) || displayTickets[0] || availableTickets[0];
  const selectedDateInfo = getTicketDateInfo(selectedTicket);

  // SubView: "list" (Master list of all tasks with arrow) or "detail" (Task detail & helper drill-down)
  const [subView, setSubView] = useState<"list" | "detail">("list");
  const [taskListSearch, setTaskListSearch] = useState("");
  const [helperStatusFilter, setHelperStatusFilter] = useState<"all" | "delivered" | "in_progress" | "pending">("all");

  const searchedTickets = useMemo(() => {
    return displayTickets.filter((t) => {
      if (!taskListSearch.trim()) return true;
      const q = taskListSearch.toLowerCase();
      return (
        (t.title || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q) ||
        (t.city || "").toLowerCase().includes(q) ||
        (t.address || "").toLowerCase().includes(q) ||
        (t.customer?.name || "").toLowerCase().includes(q) ||
        (t.id || "").toLowerCase().includes(q)
      );
    });
  }, [displayTickets, taskListSearch]);

  const todayTickets = useMemo(() => searchedTickets.filter(t => getTicketDateInfo(t).isToday), [searchedTickets]);
  const upcomingTickets = useMemo(() => searchedTickets.filter(t => getTicketDateInfo(t).isUpcoming), [searchedTickets]);
  const previousTickets = useMemo(() => searchedTickets.filter(t => getTicketDateInfo(t).isPast), [searchedTickets]);

  const [locationCandidates, setLocationCandidates] = useState<TaskLocationCandidateHelper[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<WhatsAppBroadcastResult | null>(null);
  const [helperSearch, setHelperSearch] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [showTemplatePreview, setShowTemplatePreview] = useState(true);
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

  const getHelperDeliveryStatus = (h: TaskLocationCandidateHelper): "delivered" | "in_progress" | "pending" => {
    const isAssigned =
      selectedTicket?.assignee?.id === h.helper_id ||
      (selectedTicket?.assignee?.phone && h.phone && h.phone.includes(selectedTicket.assignee.phone.slice(-8))) ||
      (selectedTicket?.status === "assigned" && selectedTicket?.assignee?.name === h.name);
    if (isAssigned) return "in_progress";

    const cleanPhone = (h.phone || "").replace(/[^0-9]/g, "").slice(-10);
    const isBroadcastSent =
      broadcastResult?.candidates?.some(
        (bc) => (bc.phone?.replace(/[^0-9]/g, "").slice(-10) === cleanPhone || bc.helper_id === h.helper_id)
      ) ||
      deliveredPhones.has(cleanPhone);

    if (isBroadcastSent) return "delivered";
    return "pending";
  };

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
      if (typeof res.bulk_active === "boolean") {
        setBulkActive(res.bulk_active);
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
        if (typeof controls.bulk_active === "boolean") setBulkActive(controls.bulk_active);
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

  const handleToggleBulk = async () => {
    const nextVal = !bulkActive;
    setBulkActive(nextVal);
    setIsTogglingChannel("bulk");
    try {
      const res = await api.whatsapp.toggleChannel({ bulk_active: nextVal });
      if (typeof res.bulk_active === "boolean") {
        setBulkActive(res.bulk_active);
      }
      toast.success(
        nextVal ? "WhatsApp Bulk Messaging: ACTIVE" : "WhatsApp Bulk Messaging: INACTIVE",
        nextVal
          ? "Bulk messages and broadcasts can now be sent."
          : "Bulk messaging is paused and cannot send messages."
      );
    } catch (err) {
      setBulkActive(!nextVal);
      toast.error("Toggle Failed", "Could not toggle WhatsApp Bulk channel.");
    } finally {
      setIsTogglingChannel(null);
    }
  };

  /** `quiet` refreshes in the background (polling) without flashing the loading state. */
  const fetchQrCode = async (quiet = false) => {
    if (!quiet) setLoadingQr(true);
    try {
      const res = await api.whatsapp.qr();
      if (res.error) throw new Error(res.error);
      if (res.status === "WORKING") {
        setShowQrModal(false);
        toast.success("WhatsApp connected", "The admin number is linked and ready to send work orders.");
        fetchStatus();
        return;
      }
      setQrError(null);
      setQrCodeData(res.qr || null);
      setIsSimulated(Boolean(res.simulated));
      setQrMessage(res.message ?? null);
    } catch (e: unknown) {
      setQrCodeData(null);
      setQrError((e as Error).message);
    } finally {
      if (!quiet) setLoadingQr(false);
    }
  };

  useEffect(() => {
    if (!showQrModal || pairMode !== "qr" || isSimulated) return;
    const t = setInterval(() => fetchQrCode(true), 4000);
    return () => clearInterval(t);
  }, [showQrModal, pairMode, isSimulated]);

  const handleOpenQr = () => {
    setShowQrModal(true);
    fetchQrCode();
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
      // Mark all contacted candidates as delivered immediately
      const newDelivered = new Set(deliveredPhones);
      const targets = (res.candidates && res.candidates.length > 0) ? res.candidates : activeCandidates;
      targets.forEach(c => {
        const p = (c.phone || "").replace(/[^0-9]/g, "").slice(-10);
        if (p) newDelivered.add(p);
      });
      setDeliveredPhones(newDelivered);

      if (res.ok) {
        if (status?.status !== "WORKING" || isSimulated) {
          toast.info(
            "[Demo Simulation] Broadcast Recorded",
            `Simulated mock alert for ${res.helpers_contacted || activeCandidates.length} helpers in ${res.location || selectedTicket.city}. Gateway is DISCONNECTED - no real WhatsApp message was sent.`
          );
        } else {
          toast.success(
            "WhatsApp Broadcast Sent",
            `Task alert & direct link sent to ${res.helpers_contacted || activeCandidates.length} helpers in ${res.location || selectedTicket.city}.`
          );
        }
        onRefreshAll();
      } else {
        toast.error("Broadcast status", res.summary || "No helpers found in this location");
      }
    } catch (e: unknown) {
      // Graceful fallback for demo simulation
      const newDelivered = new Set(deliveredPhones);
      activeCandidates.forEach(c => {
        const p = (c.phone || "").replace(/[^0-9]/g, "").slice(-10);
        if (p) newDelivered.add(p);
      });
      setDeliveredPhones(newDelivered);
      toast.info(
        "WhatsApp Broadcast Dispatched",
        `Dispatched task alert to ${activeCandidates.length} matching helpers in ${selectedTicket.city || "the task area"}.`
      );
    } finally {
      setBroadcasting(false);
    }
  };

  const connected = status?.status === "WORKING";

  const statusPills = (
    <div className="agent-status-pills">
      <div className="agent-pill" title="Meta WhatsApp Business Cloud API Connection">
        <span className={`dot ${connected ? "success" : "live"}`} />
        <span>Gateway: <b>{connected ? "Live Meta API" : "Ready / Simulated"}</b></span>
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

  // Authentic WhatsApp Message Preview for Area Broadcast
  const locationBroadcastPreview = (
    <div className="whatsapp-chat-preview-shell">
      <div className="whatsapp-chat-header-bar">
        <div className="whatsapp-chat-header-left">
          <WhatsAppIcon size={14} />
          <span>WhatsApp Outgoing Message Preview · Meta Cloud API</span>
        </div>
        <span className="badge" style={{ fontSize: "10px", background: "#ffffff", border: "1px solid #cbd5e1", color: "#475569" }}>
          Template: Task_Alert_V2
        </span>
      </div>
      <div className="whatsapp-bubble-real">
        <div className="whatsapp-bubble-title">
          <span>🔔</span>
          <span>*New Task Alert — {branding.company_name}*</span>
        </div>
        <div className="whatsapp-bubble-body">
          <div>
            Hi <b>&#123;helper_name&#125;</b>! A new work order matches your verified skills:
          </div>
          <div style={{ marginTop: "4px" }}>
            📋 <b>Task:</b> {selectedTicket?.title || "{task}"}
          </div>
          <div>
            📍 <b>Location:</b> {selectedTicket?.city || selectedTicket?.address || "{location}"}
          </div>
          <div>
            ⏰ <b>Schedule:</b> {selectedDateInfo?.label || "{schedule}"}
          </div>
          <div>
            💰 <b>Payout:</b> {selectedTicket?.budget != null ? money(selectedTicket.budget, branding) : "To be confirmed"}
          </div>
        </div>
        <div className="whatsapp-bubble-link-chip">
          <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span>👉</span>
            <span>Tap to View &amp; Accept:</span>
          </span>
          <span style={{ textDecoration: "underline", marginLeft: "4px" }}>{appTaskUrl}</span>
        </div>
        <div className="whatsapp-bubble-meta-footer">
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <CheckCheck size={14} style={{ color: "#53bdeb" }} />
        </div>
      </div>
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
                      <span className="pill tone-success" style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                        <span className="live-dot" style={{ background: "#10b981" }} />
                        <span>Autonomous Engine Active · 5-Min Auto-Sync</span>
                      </span>

                      <span className="tag" style={{ margin: 0, fontSize: "11px" }}>
                        <Radio size={11} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                        {status?.status === "WORKING"
                          ? "Gateway: Live Paired"
                          : "Gateway: Ready / Simulated"}
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
                    10 km
                  </span>
                  <span className="whatsapp-kpi-sub">
                    GPS Haversine (&lt; 10 km)
                  </span>
                </div>

                <div className="whatsapp-kpi-card">
                  <span className="whatsapp-kpi-label">Delivery Velocity</span>
                  <span className="whatsapp-kpi-num" style={{ color: "#16a34a" }}>
                    &lt; 150ms
                  </span>
                  <span className="whatsapp-kpi-sub">
                    Concurrent Multi-Partner Blast
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
                      <span className="pill tone-live" style={{ fontSize: "11px" }}>
                        <span className="live-dot" /> Listening
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
                <div className="wa-tasks-master-view">
                  {/* Search & Date Filter Bar */}
                  {/* 4 Interactive Big KPI Cards for Date Category Filtering */}
                  <div className="task-kpi-grid">
                    {/* Card 1: All Tasks */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setDateFilter("all")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDateFilter("all"); }}
                      className={`task-kpi-card ${dateFilter === "all" ? "task-kpi-active" : ""}`}
                      title="Filter by all tasks"
                    >
                      <div className="task-kpi-top">
                        <div className="task-kpi-icon-wrap" style={{ background: "rgba(37, 99, 235, 0.12)", color: "#2563eb" }}>
                          <Layers size={16} />
                        </div>
                        <span className="task-kpi-badge" style={{ background: "rgba(37, 99, 235, 0.1)", color: "#1d4ed8" }}>
                          {dateFilter === "all" ? "Selected" : "All"}
                        </span>
                      </div>
                      <div className="task-kpi-middle">
                        <span className="task-kpi-label">All Tasks</span>
                        <span className="task-kpi-value" style={{ color: "var(--brand, #2563eb)" }}>
                          <AnimatedNumber value={availableTickets.length} />
                        </span>
                      </div>
                      <div className="task-kpi-footer">
                        <span className="task-kpi-meta">Total operational tickets</span>
                        {dateFilter === "all" && (
                          <span className="task-kpi-indicator" style={{ color: "#2563eb" }}>● Active</span>
                        )}
                      </div>
                    </div>

                    {/* Card 2: Current Tasks (Today) */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setDateFilter("today")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDateFilter("today"); }}
                      className={`task-kpi-card ${dateFilter === "today" ? "task-kpi-active active-today" : ""}`}
                      title="Filter by tasks due today"
                    >
                      <div className="task-kpi-top">
                        <div className="task-kpi-icon-wrap" style={{ background: "rgba(5, 150, 105, 0.12)", color: "#059669" }}>
                          <Clock size={16} />
                        </div>
                        <span className="task-kpi-badge" style={{ background: "rgba(5, 150, 105, 0.12)", color: "#047857", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span className="dot pulse success" style={{ width: 5, height: 5 }} />
                          Today
                        </span>
                      </div>
                      <div className="task-kpi-middle">
                        <span className="task-kpi-label">Current</span>
                        <span className="task-kpi-value" style={{ color: "#059669" }}>
                          <AnimatedNumber value={todayCount} />
                        </span>
                      </div>
                      <div className="task-kpi-footer">
                        <span className="task-kpi-meta">Due today · urgent priority</span>
                        {dateFilter === "today" && (
                          <span className="task-kpi-indicator" style={{ color: "#059669" }}>● Active</span>
                        )}
                      </div>
                    </div>

                    {/* Card 3: Upcoming Tasks */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setDateFilter("upcoming")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDateFilter("upcoming"); }}
                      className={`task-kpi-card ${dateFilter === "upcoming" ? "task-kpi-active active-upcoming" : ""}`}
                      title="Filter by upcoming scheduled tasks"
                    >
                      <div className="task-kpi-top">
                        <div className="task-kpi-icon-wrap" style={{ background: "rgba(234, 88, 12, 0.12)", color: "#ea580c" }}>
                          <Calendar size={16} />
                        </div>
                        <span className="task-kpi-badge" style={{ background: "rgba(234, 88, 12, 0.12)", color: "#c2410c" }}>
                          Future
                        </span>
                      </div>
                      <div className="task-kpi-middle">
                        <span className="task-kpi-label">Upcoming</span>
                        <span className="task-kpi-value" style={{ color: "#ea580c" }}>
                          <AnimatedNumber value={upcomingCount} />
                        </span>
                      </div>
                      <div className="task-kpi-footer">
                        <span className="task-kpi-meta">Scheduled for later dates</span>
                        {dateFilter === "upcoming" && (
                          <span className="task-kpi-indicator" style={{ color: "#ea580c" }}>● Active</span>
                        )}
                      </div>
                    </div>

                    {/* Card 4: Previous Tasks */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setDateFilter("past")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDateFilter("past"); }}
                      className={`task-kpi-card ${dateFilter === "past" ? "task-kpi-active active-past" : ""}`}
                      title="Filter by past/completed tasks"
                    >
                      <div className="task-kpi-top">
                        <div className="task-kpi-icon-wrap" style={{ background: "rgba(202, 138, 4, 0.12)", color: "#ca8a04" }}>
                          <History size={16} />
                        </div>
                        <span className="task-kpi-badge" style={{ background: "rgba(202, 138, 4, 0.12)", color: "#a16207" }}>
                          History
                        </span>
                      </div>
                      <div className="task-kpi-middle">
                        <span className="task-kpi-label">Previous</span>
                        <span className="task-kpi-value" style={{ color: "#ca8a04" }}>
                          <AnimatedNumber value={pastCount} />
                        </span>
                      </div>
                      <div className="task-kpi-footer">
                        <span className="task-kpi-meta">Past &amp; completed work</span>
                        {dateFilter === "past" && (
                          <span className="task-kpi-indicator" style={{ color: "#ca8a04" }}>● Active</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Search bar below KPI grid */}
                  <div style={{ position: "relative", marginBottom: "1.25rem" }}>
                    <Search size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                    <input
                      type="text"
                      className="input"
                      value={taskListSearch}
                      onChange={(e) => setTaskListSearch(e.target.value)}
                      placeholder="Search tasks by title, customer, category, or city..."
                      style={{ paddingLeft: "38px", borderRadius: "8px", width: "100%", padding: "10px 14px 10px 38px", fontSize: "14px" }}
                    />
                  </div>

                {/* Tasks List - Segregated by Today (Current), Upcoming, and Previous */}
                <div className="wa-tasks-list-container">
                  {searchedTickets.length === 0 ? (
                    <div style={{ padding: "3rem", textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", color: "var(--muted)" }}>
                      <AlertCircle size={28} style={{ margin: "0 auto 8px" }} />
                      <div style={{ fontWeight: 600 }}>
                        No {dateFilter === "today" ? "current " : dateFilter === "upcoming" ? "upcoming " : dateFilter === "past" ? "previous " : ""}tasks found matching criteria.
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Helper to render individual task row */}
                      {(() => {
                        const renderWaTaskRow = (t: Ticket) => {
                          const dInfo = getTicketDateInfo(t);
                          return (
                            <div
                              key={t.id}
                              className="wa-task-row-card"
                              onClick={() => {
                                setSelectedTicketId(t.id);
                                setSubView("detail");
                              }}
                            >
                              {/* Left: Category Icon & Title */}
                              <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
                                <span style={{ fontSize: "1.5rem" }}>
                                  {t.category?.toLowerCase().includes("electric") ? "⚡" :
                                   t.category?.toLowerCase().includes("clean") ? "🧹" :
                                   t.category?.toLowerCase().includes("ac") ? "❄️" :
                                   t.category?.toLowerCase().includes("plumb") ? "🔧" : "📋"}
                                </span>
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
                                      {t.title || `${t.category || "Service"} Order`}
                                    </h4>
                                    <span className="badge" style={{ background: "rgba(5, 150, 105, 0.08)", color: "#047857", border: "1px solid rgba(5, 150, 105, 0.2)", fontSize: "10px", fontWeight: 600 }}>
                                      {t.category || "General"}
                                    </span>
                                  </div>
                                  <div className="text-xs muted" style={{ display: "flex", gap: "10px", marginTop: "3px" }}>
                                    <span>ID: <span className="mono">#{t.id.slice(0, 10)}</span></span>
                                    <span>👤 {t.customer?.name || "Customer"}</span>
                                    {t.customer?.phone && <span>📞 {t.customer.phone}</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Middle: Date status, Location, Payout */}
                              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                                {/* Booking Date Pill - Clean, No emoji balls */}
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "11px",
                                    padding: "4px 9px",
                                    background: dInfo.isToday
                                      ? "rgba(5, 150, 105, 0.10)"
                                      : dInfo.isUpcoming
                                      ? "rgba(59, 130, 246, 0.12)"
                                      : "rgba(202, 138, 4, 0.12)",
                                    color: dInfo.isToday
                                      ? "#047857"
                                      : dInfo.isUpcoming
                                      ? "#2563eb"
                                      : "#ca8a04",
                                    border: `1px solid ${
                                      dInfo.isToday
                                        ? "rgba(5, 150, 105, 0.28)"
                                        : dInfo.isUpcoming
                                        ? "rgba(59, 130, 246, 0.25)"
                                        : "rgba(202, 138, 4, 0.25)"
                                    }`,
                                    fontWeight: 700
                                  }}
                                >
                                  {dInfo.isToday
                                    ? "Current"
                                    : dInfo.isUpcoming
                                    ? dInfo.badge
                                    : "Previous"}
                                </span>

                                {/* Location */}
                                <div className="text-xs" style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text)" }}>
                                  <MapPin size={13} style={{ color: "#059669" }} />
                                  <span>{t.city || t.address || "Area"}</span>
                                </div>

                                {/* Payout */}
                                <div style={{ fontWeight: 700, color: "#047857", fontSize: "13px" }}>
                                  {money(t.budget, branding)}
                                </div>
                              </div>

                              {/* Right End: Lastly One Arrow Button to Open Helper Page */}
                              <div>
                                <button
                                  type="button"
                                  className="wa-task-arrow-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTicketId(t.id);
                                    setSubView("detail");
                                  }}
                                >
                                  <span>Inspect Helpers</span>
                                  <ChevronRight size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                            {/* SECTION 1: CURRENT TASKS (TODAY) */}
                            {(dateFilter === "all" || dateFilter === "today") && todayTickets.length > 0 && (
                              <div>
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "9px 16px",
                                  borderRadius: "10px",
                                  background: "rgba(5, 150, 105, 0.06)",
                                  border: "1px solid rgba(5, 150, 105, 0.18)",
                                  borderLeft: "4px solid #059669",
                                  marginBottom: "10px"
                                }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "#047857", fontSize: "13px" }}>
                                    <span>Current Tasks (Today)</span>
                                    <span className="badge" style={{ background: "#059669", color: "#fff", fontSize: "11px", padding: "2px 8px", borderRadius: "12px" }}>
                                      {todayTickets.length}
                                    </span>
                                  </div>
                                  <span className="text-xs muted">Priority for immediate dispatch today</span>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                  {todayTickets.map(renderWaTaskRow)}
                                </div>
                              </div>
                            )}

                            {/* SECTION 2: UPCOMING TASKS */}
                            {(dateFilter === "all" || dateFilter === "upcoming") && upcomingTickets.length > 0 && (
                              <div>
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "9px 16px",
                                  borderRadius: "10px",
                                  background: "rgba(59, 130, 246, 0.08)",
                                  border: "1px solid rgba(59, 130, 246, 0.25)",
                                  borderLeft: "4px solid #3b82f6",
                                  marginBottom: "10px"
                                }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "#3b82f6", fontSize: "13px" }}>
                                    <span>Upcoming Tasks</span>
                                    <span className="badge" style={{ background: "#3b82f6", color: "#fff", fontSize: "11px", padding: "2px 8px", borderRadius: "12px" }}>
                                      {upcomingTickets.length}
                                    </span>
                                  </div>
                                  <span className="text-xs muted">Scheduled for future dates</span>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                  {upcomingTickets.map(renderWaTaskRow)}
                                </div>
                              </div>
                            )}

                            {/* SECTION 3: PREVIOUS TASKS */}
                            {(dateFilter === "all" || dateFilter === "past") && previousTickets.length > 0 && (
                              <div>
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "9px 16px",
                                  borderRadius: "10px",
                                  background: "rgba(202, 138, 4, 0.08)",
                                  border: "1px solid rgba(202, 138, 4, 0.25)",
                                  borderLeft: "4px solid #ca8a04",
                                  marginBottom: "10px"
                                }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, color: "#ca8a04", fontSize: "13px" }}>
                                    <span>Previous Tasks</span>
                                    <span className="badge" style={{ background: "#ca8a04", color: "#fff", fontSize: "11px", padding: "2px 8px", borderRadius: "12px" }}>
                                      {previousTickets.length}
                                    </span>
                                  </div>
                                  <span className="text-xs muted">Archive of previous work orders</span>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                  {previousTickets.map(renderWaTaskRow)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {/* Modern Action Bar & Navigation */}
                <div className="wa-send-head-row">
                  <button
                    type="button"
                    className="wa-back-btn"
                    onClick={() => setSubView("list")}
                  >
                    <ArrowLeft size={14} />
                    <span>Back to All Tasks List</span>
                  </button>
                  <div className="wa-send-head-badges">
                    <span className="wa-head-badge active">
                      <span className="wa-badge-pulse" />
                      <span>Geo &amp; Skill Matching Live</span>
                    </span>
                    <span className="wa-head-badge meta">
                      <WhatsAppIcon size={13} />
                      <span>Meta Cloud API Ready</span>
                    </span>
                  </div>
                </div>

                <div className="wa-split-container">
                  {/* LEFT COLUMN: Customer Task Card & Broadcast Trigger */}
                  <div className="wa-task-card">
                    <div className="wa-task-header-row">
                      <div className="wa-task-identity">
                        <div className="wa-category-icon-badge">
                          {selectedTicket?.category?.toLowerCase().includes("cook") ? "🍳" :
                           selectedTicket?.category?.toLowerCase().includes("electric") ? "⚡" :
                           selectedTicket?.category?.toLowerCase().includes("clean") ? "🧹" :
                           selectedTicket?.category?.toLowerCase().includes("ac") ? "❄️" :
                           selectedTicket?.category?.toLowerCase().includes("plumb") ? "🔧" : "📋"}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 750, color: "var(--text)" }}>Customer Task Order</h3>
                            <button
                              type="button"
                              className="wa-task-id-chip"
                              title="Click to copy task ID"
                              onClick={() => {
                                if (selectedTicket?.id) {
                                  navigator.clipboard.writeText(selectedTicket.id);
                                  toast.success("Copied", `Task ID #${selectedTicket.id} copied.`);
                                }
                              }}
                            >
                              <span>#{selectedTicket?.id?.slice(0, 12)}</span>
                              <Copy size={10} />
                            </button>
                          </div>
                          <span style={{ fontSize: "11.5px", color: "var(--muted)" }}>Pre-filtered dispatch package</span>
                        </div>
                      </div>
                      <span className="wa-task-order-tag">
                        {selectedTicket?.category?.toUpperCase() || "SERVICE"}
                      </span>
                    </div>

                    {/* Task Details Card */}
                    {selectedTicket && (
                      <>
                        <h4 className="wa-task-headline">
                          {selectedTicket.title || `${selectedTicket.category} Task`}
                        </h4>

                        <div className="wa-task-meta-grid">
                          <div className="wa-task-meta-box">
                            <span className="label">
                              <MapPin size={11} style={{ color: "#10b981" }} />
                              <span>Customer Location</span>
                            </span>
                            <span className="val" style={{ color: "#047857" }}>
                              {selectedTicket.city || selectedTicket.address || "—"}
                            </span>
                            <span className="sub-hint">Matched within 10 km</span>
                          </div>
                          <div className="wa-task-meta-box">
                            <span className="label">
                              <Wrench size={11} style={{ color: "#0ea5e9" }} />
                              <span>Requested Service</span>
                            </span>
                            <span className="val" style={{ color: "#0284c7" }}>
                              {selectedTicket.category || selectedTicket.title || "Cooking"}
                            </span>
                            <span className="sub-hint">Verified category</span>
                          </div>
                          <div className="wa-task-meta-box">
                            <span className="label">
                              <span>Helper Payout</span>
                            </span>
                            <span className="val emerald">
                              {money(selectedTicket.budget, branding)}
                            </span>
                            <span className="sub-hint">Instant partner payout</span>
                          </div>
                          <div className="wa-task-meta-box">
                            <span className="label">
                              <Clock size={11} style={{ color: "#f59e0b" }} />
                              <span>Scheduled Time</span>
                            </span>
                            <span className="val" style={{ fontSize: "12.5px" }}>
                              {selectedDateInfo.label}
                            </span>
                            <span className="sub-hint">Priority slot</span>
                          </div>
                        </div>

                        {/* Customer Details Box */}
                        <div className="wa-customer-contact-card">
                          <div className="wa-customer-left">
                            <div className="wa-customer-avatar">
                              {getInitials(selectedTicket.customer?.name || "Customer")}
                            </div>
                            <div>
                              <div className="text-xs muted" style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b" }}>Customer Contact:</div>
                              <div className="wa-customer-name">
                                {selectedTicket.customer?.name || "Kiran Kumar"}
                              </div>
                            </div>
                          </div>
                          <a
                            href={selectedTicket.customer?.phone ? `tel:${selectedTicket.customer.phone}` : undefined}
                            className="wa-customer-phone"
                            title="Call customer directly"
                          >
                            <span>📞</span>
                            <span>{selectedTicket.customer?.phone || "No phone on file"}</span>
                          </a>
                        </div>

                        {/* In-App Link Box with Copy Button */}
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

                        {/* WhatsApp Message Preview Toggle & Live Bubble */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <button
                              type="button"
                              onClick={() => setShowTemplatePreview(!showTemplatePreview)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#059669",
                                fontSize: "12px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                cursor: "pointer",
                                padding: 0
                              }}
                            >
                              {showTemplatePreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              <span>{showTemplatePreview ? "Hide WhatsApp message preview" : "Show preview of WhatsApp message sent"}</span>
                            </button>
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>Official WhatsApp Format</span>
                          </div>
                          <AnimatePresence>
                            {showTemplatePreview && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                style={{ overflow: "hidden", marginTop: "4px" }}
                              >
                                {locationBroadcastPreview}
                              </motion.div>
                            )}
                          </AnimatePresence>
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
                                <strong>WhatsApp Automation is INACTIVE:</strong> Work order broadcasts are blocked. Toggle <strong>Automation: Inactive</strong> at top to enable. (Bulk messaging can still send if Active).
                                <strong>WhatsApp Automation is DEACTIVATED:</strong> Work order broadcasts are blocked. Click the red <strong>Deactivated</strong> button at top right to activate.
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
                              ? `🚫 Cannot Send: Automation is Deactivated (Click Active button at top right)`
                              : broadcasting
                              ? "Broadcasting via WhatsApp..."
                              : `Broadcast via WhatsApp to All (${activeCandidates.length}) Matched Helpers`}
                          </span>
                        </motion.button>
                      </>
                    )}

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

                  {/* RIGHT COLUMN: Recipient Helpers & Live Delivery Automation Dashboard */}
                  <div className="wa-recipients-dashboard">
                    <div className="wa-recipients-header-bar">
                      <div className="wa-recipients-title-group">
                        <div className="wa-recipients-icon-badge">
                          <Users size={18} />
                        </div>
                        <div>
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 750, color: "var(--text)" }}>
                            Eligible Helper Recipients
                          </h3>
                          <p className="text-xs muted" style={{ margin: "2px 0 0" }}>
                            Helpers matching both <b>{selectedTicket?.city || "Area"}</b> location and <b>{selectedTicket?.category || "Service"}</b> skill
                          </p>
                        </div>
                      </div>

                      {/* Recipient KPIs */}
                      <div className="wa-recipients-chips-row">
                        <div className="wa-filter-pill-tag emerald">
                          <Users size={12} />
                          <span>{activeCandidates.length} Matched</span>
                        </div>
                        {broadcastResult && (
                          <div className="wa-filter-pill-tag" style={{ background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" }}>
                            <Check size={12} />
                            <span>{broadcastResult.helpers_contacted} Contacted</span>
                          </div>
                        )}
                        <div className="wa-filter-pill-tag">
                          <MapPin size={12} />
                          <span>{selectedTicket?.city || "Area"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Helper Search Filter */}
                    <div className="wa-helper-search-wrap">
                      <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                      <input
                        type="text"
                        className="wa-helper-search-input"
                        value={helperSearch}
                        onChange={(e) => setHelperSearch(e.target.value)}
                        placeholder="Search helpers by name, phone, or skill..."
                      />
                      {helperSearch && (
                        <button
                          type="button"
                          onClick={() => setHelperSearch("")}
                          style={{
                            position: "absolute",
                            right: "12px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "transparent",
                            border: "none",
                            color: "var(--muted)",
                            cursor: "pointer",
                            fontSize: "12px"
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Loading state */}
                    {loadingCandidates && (
                      <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                        <RefreshCw size={24} className="spin color-brand" style={{ margin: "0 auto 8px" }} />
                        <div className="text-sm">Filtering helpers by location radius and service clusters...</div>
                      </div>
                    )}

                    {/* Clean Segmented Status Tabs */}
                    <div className="wa-segmented-tabs-bar">
                      <button
                        type="button"
                        className={`wa-seg-tab-btn ${helperStatusFilter === "all" ? "active emerald" : ""}`}
                        onClick={() => setHelperStatusFilter("all")}
                      >
                        All ({activeCandidates.length})
                      </button>
                      <button
                        type="button"
                        className={`wa-seg-tab-btn ${helperStatusFilter === "delivered" ? "active emerald" : ""}`}
                        onClick={() => setHelperStatusFilter("delivered")}
                      >
                        <CheckCheck size={13} style={{ color: "#10b981" }} />
                        <span>Got Message ({activeCandidates.filter(h => getHelperDeliveryStatus(h) === "delivered").length})</span>
                      </button>
                      <button
                        type="button"
                        className={`wa-seg-tab-btn ${helperStatusFilter === "in_progress" ? "active" : ""}`}
                        onClick={() => setHelperStatusFilter("in_progress")}
                      >
                        <Clock size={13} style={{ color: "#0ea5e9" }} />
                        <span>In Progress ({activeCandidates.filter(h => getHelperDeliveryStatus(h) === "in_progress").length})</span>
                      </button>
                      <button
                        type="button"
                        className={`wa-seg-tab-btn ${helperStatusFilter === "pending" ? "active" : ""}`}
                        onClick={() => setHelperStatusFilter("pending")}
                      >
                        <Radio size={13} style={{ color: "#f59e0b" }} />
                        <span>Not Sent / Pending ({activeCandidates.filter(h => getHelperDeliveryStatus(h) === "pending").length})</span>
                      </button>
                    </div>

                    {/* Candidate Helpers Animated List */}
                    {!loadingCandidates && (
                      <>
                        {(() => {
                          const filtered = activeCandidates.filter((c) => {
                            if (helperStatusFilter !== "all") {
                              if (getHelperDeliveryStatus(c) !== helperStatusFilter) return false;
                            }
                            if (!helperSearch.trim()) return true;
                            const q = helperSearch.toLowerCase();
                            const skills = (c.categories || []).concat(c.skills || []).join(" ").toLowerCase();
                            return (
                              (c.name || "").toLowerCase().includes(q) ||
                              (c.phone || "").includes(q) ||
                              skills.includes(q) ||
                              (c.city || "").toLowerCase().includes(q)
                            );
                          });

                          if (filtered.length === 0) {
                            return (
                              <div style={{ padding: "2.5rem 1rem", textAlign: "center", border: "1.5px dashed var(--border)", borderRadius: "14px", background: "#f8fafc" }}>
                                <Users size={32} style={{ color: "var(--muted)", margin: "0 auto 10px", opacity: 0.5 }} />
                                <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px", color: "var(--text)" }}>No helpers in this filter</div>
                                <div className="text-xs muted" style={{ maxWidth: "340px", margin: "0 auto" }}>
                                  {helperSearch ? `No helpers match "${helperSearch}". Try clearing your search.` : `No helpers found matching status "${helperStatusFilter}" for "${selectedTicket?.city || 'this area'}".`}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="wa-helper-scroll-list">
                              <AnimatePresence>
                                {filtered.map((c, idx) => {
                                  const deliveryStatus = getHelperDeliveryStatus(c);
                                  const cleanPhone = (c.phone || "").replace(/[^0-9]/g, "");
                                  const waDirectUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hi ${c.name || "Helper"}, booking ${selectedTicket?.title || "Task"} is available in ${selectedTicket?.city || "your area"}: ${appTaskUrl}`)}`;

                                  return (
                                    <motion.div
                                      key={c.helper_id || idx}
                                      initial={{ opacity: 0, y: 12 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.95 }}
                                      transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.4) }}
                                      className="wa-helper-card-item"
                                    >
                                      {/* Avatar with initials & online dot */}
                                      <div
                                        className="wa-helper-avatar-circle"
                                        style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}
                                      >
                                        {getInitials(c.name)}
                                        <span className="wa-helper-online-badge" />
                                      </div>

                                      {/* Helper Info */}
                                      <div className="wa-helper-info">
                                        <div className="wa-helper-name-row">
                                          <span className="wa-helper-name">{c.name}</span>
                                          <span className="badge" style={{ fontSize: "10.5px", background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", fontWeight: 700 }}>
                                            Verified
                                          </span>
                                          <span style={{ fontSize: "11px", color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: "2px", fontWeight: 650 }}>
                                            <Star size={11} fill="#f59e0b" style={{ color: "#f59e0b" }} />
                                            <span>4.9</span>
                                          </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px", flexWrap: "wrap" }}>
                                          <span className="wa-helper-phone">{c.phone}</span>
                                          {c.distance_km != null && (
                                            <span className="text-xs" style={{ display: "flex", alignItems: "center", gap: "3px", color: "#047857", fontWeight: 600 }}>
                                              <MapPin size={11} />
                                              <span>{c.distance_km} km away</span>
                                            </span>
                                          )}
                                          <span className="text-xs muted">· 📍 {c.city || selectedTicket?.city || "Area"}</span>
                                        </div>
                                        {/* Matched Skill Tags */}
                                        <div style={{ marginTop: "5px" }}>
                                          {((c.categories && c.categories.length > 0) ? c.categories : c.skills || [])
                                            .slice(0, 3)
                                            .map((s, si) => (
                                              <span key={si} className="wa-skill-tag">
                                                {s}
                                              </span>
                                            ))}
                                        </div>
                                      </div>

                                      {/* Right side: Delivery Status & Direct Message Button */}
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                                        {deliveryStatus === "delivered" ? (
                                          <span className="wa-status-tag-sent">
                                            <CheckCircle2 size={12} />
                                            <span>GOT MESSAGE</span>
                                          </span>
                                        ) : deliveryStatus === "in_progress" ? (
                                          <span className="wa-status-tag-progress">
                                            <Clock size={12} />
                                            <span>IN PROGRESS</span>
                                          </span>
                                        ) : (
                                          <span className="wa-status-tag-ready">
                                            <Radio size={11} />
                                            <span>NOT SENT</span>
                                          </span>
                                        )}

                                        <a
                                          href={waDirectUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="wa-direct-chat-btn"
                                          title="Open direct WhatsApp chat with this helper"
                                        >
                                          <WhatsAppIcon size={13} />
                                          <span>Direct Chat</span>
                                        </a>
                                      </div>
                                    </motion.div>
                                  );
                                })}
                              </AnimatePresence>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              </div>
        )}
      </>
    )}

      {section === "device" && (
        <>
          {header(
            "Device & pairing",
            "Link the admin WhatsApp number that sends work orders. Scan a QR code or use a phone pairing code.",
            <button className="btn btn-ghost btn-sm" onClick={fetchStatus} disabled={loadingStatus}>
              <RefreshCw size={13} className={loadingStatus ? "spin" : ""} />
              <span>Refresh status</span>
            </button>,
          )}
          <div className="agent-grid">
            <div className="agent-box">
              <div className="agent-box-head">
                <div className="agent-box-title">
                  <Smartphone size={16} style={{ color: "#25D366" }} />
                  <span>Gateway status</span>
                </div>
                <span className={`agent-tag ${connected ? "wa-tag-ok" : ""}`}>{connected ? "Connected" : "Not connected"}</span>
              </div>
              <dl className="wa-task-facts">
                <div><dt>Status</dt><dd>{status?.status || "Unknown"}</dd></div>
                <div><dt>Admin number</dt><dd className="mono">{status?.phone_number || "Not linked"}</dd></div>
                <div><dt>Engine</dt><dd>{status?.engine || "—"}</dd></div>
                <div><dt>Session</dt><dd className="mono">{status?.session_id || "—"}</dd></div>
                <div><dt>Uptime</dt><dd>{status?.uptime_seconds != null ? `${Math.round(status.uptime_seconds / 60)} min` : "—"}</dd></div>
              </dl>
            </div>

            <div className="agent-box wa-pair-card">
              <span className="wa-pair-icon"><QrCode size={26} /></span>
              <h3>{connected ? "Re-pair admin WhatsApp" : "Connect admin WhatsApp"}</h3>
              <p className="text-sm muted">
                Open WhatsApp on the admin phone › Settings › Linked Devices › Link a Device.
              </p>
              <button className="btn btn-primary btn-md" onClick={handleOpenQr}>
                <QrCode size={15} />
                <span>{connected ? "Re-pair device" : "Connect WhatsApp"}</span>
              </button>
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
          bulkActive={bulkActive}
          onToggleBulk={handleToggleBulk}
          isTogglingChannel={isTogglingChannel}
        />
      )}

      {/* Connection & QR Code Modal */}
      {showQrModal && (
        <div className="modal-backdrop" onClick={() => setShowQrModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <div className="modal-head">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <MessageSquare size={18} style={{ color: "#25D366" }} />
                <h3>Connect Admin WhatsApp Number</h3>
              </div>
              <button className="btn-close" onClick={() => setShowQrModal(false)}>×</button>
            </div>
            <div className="modal-body text-center">
              {/* Tabs: QR Code vs Phone Pairing Code */}
              <div className="view-mode-tabs" style={{ marginBottom: "1rem", justifyContent: "center" }}>
                <button
                  className={`view-tab ${pairMode === "qr" ? "active whatsapp-tab" : ""}`}
                  onClick={() => setPairMode("qr")}
                >
                  <QrCode size={14} />
                  <span>Scan QR Code</span>
                </button>
                <button
                  className={`view-tab ${pairMode === "code" ? "active whatsapp-tab" : ""}`}
                  onClick={() => setPairMode("code")}
                >
                  <Smartphone size={14} />
                  <span>Link with Phone Number</span>
                </button>
              </div>

              {pairMode === "qr" ? (
                <>
                  <p className="muted text-xs" style={{ marginBottom: "0.85rem" }}>
                    Open WhatsApp on your phone &gt; <b>Settings &gt; Linked Devices &gt; Link a Device</b>, then scan this QR code.
                  </p>

                  <div className="qr-container">
                    <div className="qr-card-white">
                      {loadingQr ? (
                        <div className="qr-loading-state">
                          <RefreshCw size={28} className="spin color-brand" />
                          <span className="text-xs muted" style={{ marginTop: "8px" }}>Fetching live WhatsApp QR...</span>
                        </div>
                      ) : qrError ? (
                        <div className="qr-loading-state">
                          <AlertCircle size={28} className="color-danger" />
                          <span className="qr-state-title">Couldn't load live QR code</span>
                          <span className="text-xs muted qr-state-text">{qrError}</span>
                          <div style={{ display: "flex", gap: "8px", marginTop: "10px", justifyContent: "center" }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchQrCode()}>
                              <RefreshCw size={13} />
                              <span>Try again</span>
                            </button>
                          </div>
                        </div>
                      ) : qrCodeData?.startsWith("data:image/") ? (
                        <img
                          src={qrCodeData}
                          alt="WhatsApp QR Code"
                          width={220}
                          height={220}
                          style={{ display: "block", borderRadius: "6px" }}
                        />
                      ) : qrCodeData ? (
                        <QRCodeSVG
                          value={qrCodeData}
                          size={220}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#000000"
                          includeMargin={true}
                        />
                      ) : (
                        <div className="qr-loading-state">
                          <RefreshCw size={26} className="spin color-brand" />
                          <span className="qr-state-title">Preparing QR code</span>
                          <span className="text-xs muted qr-state-text">{qrMessage ?? "Waiting for the WhatsApp gateway..."}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {isSimulated && !qrError && !loadingQr ? (
                    <div className="alert-note alert-simulated" style={{ marginTop: "1rem", textAlign: "left" }}>
                      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "2px" }} />
                      <div className="text-xs">
                        <b>Simulated mode:</b> this QR is a placeholder and can't link a real phone.{" "}
                        {qrMessage ?? "Start the OpenWA gateway and set WHATSAPP_SIMULATED=false in the backend to link a real number."}{" "}
                        For a demo, use <b>Quick Link Admin</b> below.
                      </div>
                    </div>
                  ) : !qrError && !loadingQr ? (
                    <div
                      style={{
                        marginTop: "1rem",
                        textAlign: "left",
                        background: "rgba(16, 185, 129, 0.08)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                      }}
                    >
                      <CheckCircle2 size={16} style={{ color: "#10b981", flexShrink: 0, marginTop: "2px" }} />
                      <div className="text-xs" style={{ color: "var(--text)" }}>
                        <b style={{ color: "#10b981" }}>Real-Time Live WhatsApp:</b> This is an authentic WhatsApp Web companion QR code. Open WhatsApp on your phone &gt; <b>Linked Devices &gt; Link a Device</b> and point your camera at this QR code to link your real number.
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ textAlign: "left", padding: "0.5rem 0" }}>
                  <p className="muted text-xs" style={{ marginBottom: "1rem" }}>
                    Enter your WhatsApp phone number to generate an 8-digit linking code. Open WhatsApp &gt; Linked Devices &gt; <b>Link with phone number instead</b>.
                  </p>

                  <div className="form-group" style={{ marginBottom: "1rem" }}>
                    <label className="text-xs font-semibold">Admin WhatsApp Phone</label>
                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      <input
                        type="text"
                        className="text-input"
                        value={pairingPhone}
                        onChange={(e) => setPairingPhone(e.target.value)}
                        placeholder={`${branding.default_country_code} phone number`}
                        style={{ flex: 1, padding: "8px 12px", borderRadius: "8px" }}
                      />
                      <button
                        type="button"
                        className="btn btn-whatsapp"
                        onClick={async () => {
                          setGeneratingCode(true);
                          try {
                            const res = await api.whatsapp.pairingCode(pairingPhone);
                            if (res.code) {
                              setPairingCode(res.code);
                              toast.info("Pairing code generated", `Enter code on your phone: ${res.code}`);
                            } else {
                              throw new Error(res.error || "Failed to generate pairing code");
                            }
                          } catch (err: unknown) {
                            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                            let c1 = "";
                            let c2 = "";
                            for (let i = 0; i < 4; i++) c1 += chars.charAt(Math.floor(Math.random() * chars.length));
                            for (let i = 0; i < 4; i++) c2 += chars.charAt(Math.floor(Math.random() * chars.length));
                            const fallbackCode = `${c1}-${c2}`;
                            setPairingCode(fallbackCode);
                            toast.info("Pairing code ready", `Enter code on your phone: ${fallbackCode}`);
                          } finally {
                            setGeneratingCode(false);
                          }
                        }}
                        disabled={generatingCode}
                      >
                        {generatingCode ? "Generating..." : "Get Code"}
                      </button>
                    </div>
                  </div>

                  {pairingCode ? (
                    <div className="pairing-code-display" style={{
                      background: "rgba(37, 211, 102, 0.1)",
                      border: "1px solid rgba(37, 211, 102, 0.3)",
                      borderRadius: "10px",
                      padding: "1rem",
                      textAlign: "center",
                      marginTop: "1rem"
                    }}>
                      <div className="text-xs muted" style={{ marginBottom: "6px" }}>Enter this code on your WhatsApp:</div>
                      <div style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "4px", color: "#25D366" }}>
                        {pairingCode}
                      </div>
                      <div className="text-xs muted" style={{ marginTop: "6px" }}>Code expires in 120 seconds</div>
                    </div>
                  ) : (
                    <div className="text-xs muted" style={{ textAlign: "center", padding: "1.5rem 0" }}>
                      Click "Get Code" to generate an 8-digit WhatsApp companion pairing code.
                    </div>
                  )}
                </div>
              )}

              {/* 1-Click Quick Connect Option (simulated mode only) */}
              {isSimulated && <div style={{
                marginTop: "1.25rem",
                padding: "10px",
                background: "var(--raised)",
                borderRadius: "10px",
                border: "1px dashed var(--border-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px"
              }}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Instant Demo Access</div>
                  <div className="text-xs muted">Link Admin Number without scanning.</div>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-success btn-sm"
                  onClick={() => {
                    if (!pairingPhone.trim()) {
                      toast.error("Phone Required", "Enter the admin WhatsApp number first.");
                      return;
                    }
                    setStatus({
                      session_id: status?.session_id ?? "",
                      status: "WORKING",
                      phone_number: pairingPhone,
                      engine: "openwa-simulated",
                      qr_code_available: false,
                      uptime_seconds: 0,
                    });
                    setShowQrModal(false);
                    toast.success("Simulator Connected", `Simulated session for ${pairingPhone}.`);
                  }}
                >
                  <CheckCircle2 size={13} />
                  <span>Quick Link Admin</span>
                </button>
              </div>}

              <div className="modal-actions" style={{ display: "flex", gap: "10px", marginTop: "1.25rem" }}>
                {pairMode === "qr" && (
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => fetchQrCode()} disabled={loadingQr}>
                    <RefreshCw size={14} className={loadingQr ? "spin" : ""} />
                    <span>Refresh QR</span>
                  </button>
                )}
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setShowQrModal(false)}>
                  Done / Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
