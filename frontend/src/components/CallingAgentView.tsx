import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  History,
  LifeBuoy,
  MapPin,
  PhoneCall,
  PhoneOff,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usePoll, useUrlState } from "../hooks";
import { LiveCalls } from "./LiveCalls";
import { Card, Empty, SkeletonRows, Phone as PhoneText } from "./ui";
import { AnimatedNumber } from "./motion";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import {
  CANONICAL_SERVICES,
  getCanonicalServices,
  getCanonicalLocations,
  formatHelperDisplayLocation,
} from "../helperTaxonomy";
import { CustomerCareView } from "../pages/CustomerCare";
import { CallingDispatchFlow } from "./CallingDispatchFlow";
import { CallingAgentToggle } from "./CallingAgentToggle";
import type { Call, Escalation, EventItem, Helper, Stats, Ticket as TicketType } from "../types";
import { TaskBoard } from "./TaskBoard";

interface CallingAgentViewProps {
  stats?: Stats;
  calls?: Call[];
  tickets?: TicketType[];
  events?: EventItem[];
  helpers?: Helper[];
  escalations?: Escalation[];
  onRefreshEscalations?: () => void;
  ivrMaxPrompts: number;
  telephonyProvider: string;
  onRefreshAll: () => void;
  initialView?: "console" | "tickets" | "helpers" | "care" | "dispatch";
}

/** ExtraHand profile states that mean the helper cannot take work yet. */
const BLOCKED_HELPER_STATUS: Record<string, string> = {
  rejected: "Application rejected",
  pending_review: "Pending review",
  not_applied: "Not applied",
  suspended: "Suspended",
  blocked: "Blocked",
};

/** Why a helper cannot be dispatched right now, or null when they can. */
const helperBlockReason = (h: Helper): string | null => {
  const st = (h.status || "").toLowerCase().replace(/\s+/g, "_");
  if (BLOCKED_HELPER_STATUS[st]) return BLOCKED_HELPER_STATUS[st];
  if (!h.is_active) return "Inactive";
  if (!h.can_accept_tasks) return "Not accepting tasks";
  if (!h.phone) return "No phone number";
  return null;
};

/** Each helper is in exactly one bucket: assigned (has open work), available, or not available. */
const helperAvailability = (h: Helper): "assigned" | "available" | "not_available" => {
  if ((h.active_tickets_count ?? 0) > 0) return "assigned";
  return helperBlockReason(h) ? "not_available" : "available";
};

const helperShift = (h: Helper): "full_time" | "part_time" | "unset" => {
  const v = (h.work_shift_type || "").toLowerCase().replace(/[\s-]+/g, "_");
  return v === "full_time" ? "full_time" : v === "part_time" ? "part_time" : "unset";
};

export function CallingAgentView({
  stats: _stats,
  calls,
  tickets,
  events: _events,
  helpers,
  escalations,
  onRefreshEscalations,
  ivrMaxPrompts,
  telephonyProvider,
  onRefreshAll,
  initialView = "dispatch",
}: CallingAgentViewProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const isConsoleInitial =
    initialView === "console" ||
    location.pathname === "/calling/console" ||
    searchParams.get("view") === "console" ||
    searchParams.get("tab") === "console";

  const isCareInitial =
    !isConsoleInitial &&
    (initialView === "care" ||
      location.pathname === "/calling/care" ||
      location.pathname === "/customer-care" ||
      searchParams.get("tab") === "care");

  const isHelpersInitial =
    !isConsoleInitial &&
    !isCareInitial &&
    (initialView === "helpers" ||
      location.pathname === "/calling/helpers" ||
      location.pathname === "/helpers" ||
      searchParams.get("tab") === "helpers");

  const isTicketsInitial =
    !isConsoleInitial &&
    (isCareInitial ||
      isHelpersInitial ||
      initialView === "tickets" ||
      location.pathname === "/calling/tasks" ||
      location.pathname === "/tickets" ||
      searchParams.get("view") === "tickets");

  const [activeTab, setActiveTab] = useState<"console" | "tickets" | "dispatch">(
    isConsoleInitial ? "console" : isTicketsInitial ? "tickets" : "dispatch"
  );
  const [activeSection, setActiveSection] = useState<"tasks" | "helpers" | "care">(
    isCareInitial ? "care" : isHelpersInitial ? "helpers" : "tasks"
  );

  const navigate = useNavigate();
  // A real route change (not window.history), so the sidebar, reload and Back all follow the section
  const switchSection = (sec: "tasks" | "helpers" | "care") => {
    setActiveSection(sec);
    const targetUrl =
      sec === "tasks" ? "/calling/tasks" : sec === "helpers" ? "/calling/helpers" : "/calling/care";
    if (location.pathname !== targetUrl) navigate(targetUrl);
  };

  useEffect(() => {
    if (
      location.pathname === "/calling/console" ||
      searchParams.get("view") === "console" ||
      searchParams.get("tab") === "console"
    ) {
      setActiveTab("console");
    } else if (
      location.pathname === "/calling" ||
      location.pathname === "/calling/dispatch" ||
      searchParams.get("tab") === "dispatch" ||
      searchParams.get("view") === "dispatch"
    ) {
      setActiveTab("dispatch");
    } else if (
      location.pathname === "/calling/care" ||
      location.pathname === "/customer-care" ||
      searchParams.get("tab") === "care"
    ) {
      setActiveTab("tickets");
      setActiveSection("care");
    } else if (
      location.pathname === "/calling/helpers" ||
      location.pathname === "/helpers" ||
      searchParams.get("tab") === "helpers"
    ) {
      setActiveTab("tickets");
      setActiveSection("helpers");
    } else if (
      location.pathname === "/calling/tasks" ||
      location.pathname === "/tickets" ||
      searchParams.get("view") === "tickets"
    ) {
      setActiveTab("tickets");
      setActiveSection("tasks");
    }
  }, [location.pathname, searchParams]);

  // Customer Care state
  const { data: polledEscalations, refresh: refreshPolledEscalations } = usePoll(
    () => api.escalations(),
    4000
  );
  const escalationsList = escalations ?? polledEscalations ?? [];
  const handleEscalationChange = () => {
    onRefreshEscalations?.();
    refreshPolledEscalations();
    onRefreshAll();
  };

  // Tasks state
  // Filters live in the URL so a reload keeps them

  // Helpers state
  const [helperSearch, setHelperSearch] = useUrlState<string>("hq", "");
  const [helperFilter, setHelperFilter] = useUrlState<
    "all" | "available" | "assigned" | "not_available" | "verified" | "full_time" | "part_time"
  >("show", "all");
  const [helperServiceFilter, setHelperServiceFilter] = useUrlState<string>("service", "");
  const [helperLocationFilter, setHelperLocationFilter] = useUrlState<string>("place", "");

  // Canonical grouped services with helper counts for the dropdown
  const availableServices = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of CANONICAL_SERVICES) {
      counts[group.name] = 0;
    }
    counts["General Helper"] = 0;

    for (const h of helpers ?? []) {
      const canonicals = getCanonicalServices(h);
      for (const c of canonicals) {
        counts[c] = (counts[c] || 0) + 1;
      }
    }

    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [helpers]);

  // Canonical grouped locations with helper counts for the dropdown
  const availableLocations = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of helpers ?? []) {
      const locs = getCanonicalLocations(h);
      for (const loc of locs) {
        counts[loc] = (counts[loc] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count }));
  }, [helpers]);

  const callingTickets = (tickets ?? []).filter((t) => t.dispatch_status === "dispatching");

  // Calls state & calculations for Voice Dialing Console
  const activeCalls = useMemo(() => (calls ?? []).filter((c) => c.status !== "ended"), [calls]);
  const completedCalls = useMemo(() => (calls ?? []).filter((c) => c.status === "ended"), [calls]);
  const completedCount = completedCalls.length;
  const acceptedCount = useMemo(
    () => completedCalls.filter((c) => c.outcome === "accepted" || c.outcome === "confirmed").length,
    [completedCalls]
  );
  const rejectedCount = useMemo(
    () => completedCalls.filter((c) => c.outcome === "rejected" || c.outcome === "declined").length,
    [completedCalls]
  );
  const otherCount = useMemo(
    () => Math.max(0, completedCalls.length - acceptedCount - rejectedCount),
    [completedCalls, acceptedCount, rejectedCount]
  );

  const [callFilter, setCallFilter] = useUrlState<"all" | "accepted" | "rejected" | "other">("calls", "all");
  const [callSearch, setCallSearch] = useUrlState<string>("callq", "");

  const filteredCompletedCalls = useMemo(() => {
    return completedCalls.filter((c) => {
      if (callFilter === "accepted" && c.outcome !== "accepted" && c.outcome !== "confirmed") return false;
      if (callFilter === "rejected" && c.outcome !== "rejected" && c.outcome !== "declined") return false;
      if (
        callFilter === "other" &&
        (c.outcome === "accepted" || c.outcome === "confirmed" || c.outcome === "rejected" || c.outcome === "declined")
      ) {
        return false;
      }

      if (!callSearch.trim()) return true;
      const q = callSearch.toLowerCase();
      return (
        (c.helper_name && c.helper_name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.ticket_title && c.ticket_title.toLowerCase().includes(q)) ||
        (c.ticket_id && c.ticket_id.toLowerCase().includes(q)) ||
        (c.outcome && c.outcome.toLowerCase().includes(q))
      );
    });
  }, [completedCalls, callFilter, callSearch]);

  const handleFlowFilter = (
    type:
      | "all"
      | "assigned"
      | "unassigned"
      | "calls"
      | "accepted"
      | "care"
      | "followup"
      | "direct_followup"
      | "calling_followup"
  ) => {
    // Real URLs (with filters in the query), so reload and Back return to exactly this view
    const go = (path: string) => navigate(path);
    const scrollToCalls = () =>
      setTimeout(() => document.getElementById("call-log-section")?.scrollIntoView({ behavior: "smooth" }), 350);
    if (type === "all" || type === "calling_followup" || type === "followup") go("/calling/tasks?date=today");
    else if (type === "assigned" || type === "direct_followup") go("/calling/tasks?date=today&status=assigned");
    else if (type === "unassigned") go("/calling/tasks?date=today&status=new");
    else if (type === "calls") {
      go("/calling/console");
      scrollToCalls();
    } else if (type === "accepted") {
      go("/calling/console?calls=accepted");
      scrollToCalls();
    } else if (type === "care") go("/calling/care");
  };

  const formatCallDuration = (c: Call) => {
    if (c.duration_seconds && c.duration_seconds > 0) {
      const s = Math.round(c.duration_seconds);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    if (!c.answered_at || !c.ended_at) return "—";
    const s = Math.round((new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000);
    if (s <= 0) return "—";
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Live reactive day tracker: updates dynamically whenever the calendar day changes
  const [currentDayKey, setCurrentDayKey] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (key !== currentDayKey) {
        setCurrentDayKey(key);
        onRefreshAll();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [currentDayKey, onRefreshAll]);

  // Helpers filtering logic with Status, Service, Location/Place, and Text search
  const filteredHelpers = useMemo(() => {
    return (helpers ?? []).filter((h) => {
      // 1. Status Filter
      if ((helperFilter === "available" || helperFilter === "assigned" || helperFilter === "not_available")
        && helperAvailability(h) !== helperFilter) {
        return false;
      }
      if (helperFilter === "verified" && !h.is_verified) {
        return false;
      }
      if ((helperFilter === "full_time" || helperFilter === "part_time") && helperShift(h) !== helperFilter) {
        return false;
      }

      // 2. Canonical Unified Service Filter
      if (helperServiceFilter) {
        const canonicals = getCanonicalServices(h);
        if (!canonicals.includes(helperServiceFilter)) {
          return false;
        }
      }

      // 3. Canonical Location / Place Filter
      if (helperLocationFilter) {
        const canonicalLocs = getCanonicalLocations(h);
        if (!canonicalLocs.includes(helperLocationFilter)) {
          return false;
        }
      }

      // 4. Free text search
      if (!helperSearch.trim()) return true;
      const q = helperSearch.toLowerCase();
      const skills = (h.categories || []).concat(h.skills || []).join(" ").toLowerCase();
      return (
        (h.name && h.name.toLowerCase().includes(q)) ||
        (h.phone && h.phone.includes(q)) ||
        (h.id && h.id.toLowerCase().includes(q)) ||
        (h.city && h.city.toLowerCase().includes(q)) ||
        (h.address && h.address.toLowerCase().includes(q)) ||
        skills.includes(q)
      );
    });
  }, [helpers, helperFilter, helperServiceFilter, helperLocationFilter, helperSearch]);

  const helperCounts = useMemo(() => {
    const c = { all: 0, available: 0, assigned: 0, not_available: 0, verified: 0, full_time: 0, part_time: 0, shift_unset: 0,
      rejected: 0, no_phone: 0 };
    for (const h of helpers ?? []) {
      c.all += 1;
      c[helperAvailability(h)] += 1;
      if (h.is_verified) c.verified += 1;
      const sh = helperShift(h);
      if (sh === "unset") c.shift_unset += 1;
      else c[sh] += 1;
      if ((h.status || "").toLowerCase() === "rejected") c.rejected += 1;
      if (!h.phone) c.no_phone += 1;
    }
    return c;
  }, [helpers]);

  const renderSingleLineHelper = (h: Helper) => {
    const availability = helperAvailability(h);
    const isAvailable = availability === "available";
    const isAssigned = availability === "assigned";
    const shift = helperShift(h);
    const canonicalServices = getCanonicalServices(h);

    return (
      <div key={h.id} className="task-line-item helper-line-item">
        {/* Helper Name, Initial Avatar, Verified Shield, ID */}
        <div className="task-line-main" style={{ minWidth: "220px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "var(--brand-surface, #e0e7ff)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "13px",
                flexShrink: 0,
              }}
            >
              {h.name ? h.name[0].toUpperCase() : "H"}
            </div>
            <div>
              <div style={{ fontWeight: 650, color: "var(--text)", display: "flex", alignItems: "center", gap: "5px" }}>
                <span>{h.name || "Helper Partner"}</span>
                {h.is_verified && (
                  <span title="Aadhaar Verified" style={{ display: "inline-flex" }}>
                    <ShieldCheck size={14} style={{ color: "#16a34a" }} />
                  </span>
                )}
              </div>
              <span className="small muted mono">#{String(h.id || "").slice(-6)}</span>
            </div>
          </div>
        </div>

        {/* Contact Phone */}
        <div className="task-line-customer" style={{ minWidth: "140px" }}>
          <PhoneCall size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>
            {h.phone ? <PhoneText value={h.phone} /> : "—"}
          </span>
        </div>

        {/* Location & Coverage: Clean Canonical Formatting */}
        <div className="task-line-location" style={{ minWidth: "160px" }}>
          <MapPin size={13} style={{ flexShrink: 0, color: "#ea580c" }} />
          <span className="truncate" title={getCanonicalLocations(h).join(", ") || formatHelperDisplayLocation(h)}>
            {formatHelperDisplayLocation(h)}
          </span>
        </div>

        {/* Skills & Services: Clean Canonical Unified Names */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", flex: 1, minWidth: "180px" }}>
          <Wrench size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          {canonicalServices.slice(0, 2).map((s) => (
            <span
              key={s}
              className="task-category-tag clickable"
              style={{
                margin: 0,
                cursor: "pointer",
                background: helperServiceFilter === s ? "var(--brand)" : undefined,
                color: helperServiceFilter === s ? "#fff" : undefined,
              }}
              title={`Click to filter by ${s}`}
              onClick={(e) => {
                e.stopPropagation();
                setHelperServiceFilter(helperServiceFilter === s ? "" : s);
              }}
            >
              {s}
            </span>
          ))}
          {canonicalServices.length > 2 && (
            <span className="small muted">+{canonicalServices.length - 2}</span>
          )}
        </div>

        {/* Work Shift */}
        <div style={{ minWidth: "90px", textAlign: "center" }}>
          {shift === "unset" ? (
            <span className="small muted" title="Shift type is not set on ExtraHand">Shift not set</span>
          ) : (
            <span className="tag" style={{ margin: 0, fontSize: "11px" }}>
              {shift === "part_time" ? "Part-time" : "Full-time"}
            </span>
          )}
        </div>

        {/* Status / Availability Badge */}
        <div className="task-line-assignment" style={{ minWidth: "120px", justifyContent: "flex-end" }}>
          {isAssigned ? (
            <span className="task-status-assigned-badge">
              <CheckCircle2 size={13} />
              <span>Assigned ({h.active_tickets_count})</span>
            </span>
          ) : isAvailable ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#16a34a", fontWeight: 650, fontSize: "12px", background: "rgba(22, 163, 74, 0.1)", padding: "3px 9px", borderRadius: "12px" }}>
              <CheckCircle2 size={13} />
              <span>Available</span>
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#b91c1c", fontWeight: 600, fontSize: "12px", background: "rgba(220, 38, 38, 0.08)", padding: "3px 9px", borderRadius: "12px", whiteSpace: "nowrap" }}>
              <XCircle size={13} />
              <span>{helperBlockReason(h) || "Not available"}</span>
            </span>
          )}
        </div>
      </div>
    );
  };

  // Render ExtraHand Work Status Badge (Open, In Progress, Completed, Cancelled, Assigned)
  /* =========================================================================
     VIEW 0: CALLING AGENT DISPATCH PIPELINE (DEDICATED SIDEBAR MODULE)
     ========================================================================= */
  if (activeTab === "dispatch") {
    return (
      <div className="page-wrap calling-dispatch-page-view" style={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
        <CallingDispatchFlow
          tickets={tickets}
          calls={calls}
          stats={_stats}
          escalations={escalationsList}
          onSelectFilter={handleFlowFilter}
        />
      </div>
    );
  }

  /* =========================================================================
     VIEW 2: TICKETS & TASKS / HELPER DETAILS LIST VIEW
     - TOGGLE BETWEEN TASKS & HELPERS IN THE SAME PAGE
     - BOTH IN SINGLE-LINE LIST FORMAT (NO SIDE-SCROLLING, NO EXTRA REDIRECTION)
     ========================================================================= */
  if (activeTab === "tickets") {
    return (
      <div className="page-wrap tickets-details-only-view" style={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
        {/* Header with Sub-tabs: Tickets & Tasks vs Helper Details vs Customer Care */}
        <div className="page-head row" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "14px", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                {activeSection === "tasks" ? (
                  <>
                    <Ticket size={24} style={{ color: "var(--brand)" }} />
                    <span>Tickets &amp; Task Details</span>
                  </>
                ) : activeSection === "helpers" ? (
                  <>
                    <Users size={24} style={{ color: "var(--brand)" }} />
                    <span>Helper Details</span>
                  </>
                ) : (
                  <>
                    <LifeBuoy size={24} style={{ color: "var(--brand)" }} />
                    <span>Customer Care</span>
                  </>
                )}
              </h1>
              <span className="badge" style={{ fontSize: "12px", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 8px", borderRadius: "12px" }}>
                {activeSection === "tasks"
                  ? `${tickets?.length ?? 0} tasks`
                  : activeSection === "helpers"
                  ? `${filteredHelpers.length} helpers`
                  : `${escalationsList.filter((e) => e.status !== "resolved").length} to do`}
              </span>
            </div>
            <p className="muted" style={{ margin: "4px 0 0 0", fontSize: "0.875rem" }}>
              {activeSection === "tasks"
                ? "Every customer task with its WhatsApp alerts, helper calls, follow-ups and assigned helper. Same list as WhatsApp → Send Work Order."
                : activeSection === "helpers"
                ? "Directory of ExtraHand service partners & dispatch helpers with skill profiles, locations, and dispatch availability in list format."
                : "Cases the calling agent could not finish on its own: pick one, call the customer or helper, and resolve it."}
            </p>
          </div>
        </div>

        {/* SECTION A: HELPER DETAILS LIST VIEW */}
        {activeSection === "helpers" && (
          <div>
            {/* Helper KPI cards: click one to filter the directory */}
            {(() => {
              const pct = (n: number) => (helperCounts.all ? `${Math.round((n / helperCounts.all) * 100)}%` : "0%");
              const items: {
                key: typeof helperFilter; label: string; value: number; meta: string; color: string; icon: JSX.Element;
              }[] = [
                { key: "all", label: "Total Helpers", value: helperCounts.all, meta: "Synced from ExtraHand", color: "#2563eb", icon: <Users size={16} /> },
                { key: "available", label: "Available", value: helperCounts.available, meta: `${pct(helperCounts.available)} · ready to dispatch`, color: "#16a34a", icon: <CheckCircle2 size={16} /> },
                { key: "assigned", label: "Assigned", value: helperCounts.assigned, meta: "Working on open tasks", color: "#0891b2", icon: <Activity size={16} /> },
                { key: "not_available", label: "Not Available", value: helperCounts.not_available, meta: `${helperCounts.rejected} rejected · ${helperCounts.no_phone} no phone`, color: "#dc2626", icon: <XCircle size={16} /> },
                { key: "verified", label: "Verified", value: helperCounts.verified, meta: `${pct(helperCounts.verified)} Aadhaar verified`, color: "#7c3aed", icon: <ShieldCheck size={16} /> },
                { key: "full_time", label: "Full-time", value: helperCounts.full_time, meta: `${helperCounts.shift_unset} with shift not set`, color: "#ea580c", icon: <Clock size={16} /> },
                { key: "part_time", label: "Part-time", value: helperCounts.part_time, meta: "Limited hours", color: "#ca8a04", icon: <Clock size={16} /> },
              ];
              return (
                <div className="helper-kpi-grid">
                  {items.map((it) => {
                    const active = helperFilter === it.key;
                    return (
                      <div
                        key={it.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setHelperFilter(active && it.key !== "all" ? "all" : it.key)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setHelperFilter(it.key); }}
                        className={`task-kpi-card ${active ? "task-kpi-active" : ""}`}
                        style={active ? { borderColor: it.color, boxShadow: `0 0 0 1px ${it.color}` } : undefined}
                        title={`Show ${it.label.toLowerCase()} helpers`}
                      >
                        <div className="task-kpi-top">
                          <div className="task-kpi-icon-wrap" style={{ background: `${it.color}1f`, color: it.color }}>{it.icon}</div>
                          {active && <span className="task-kpi-indicator" style={{ color: it.color }}>● Active</span>}
                        </div>
                        <div className="task-kpi-middle">
                          <span className="task-kpi-label">{it.label}</span>
                          <span className="task-kpi-value" style={{ color: it.color }}>
                            <AnimatedNumber value={it.value} />
                          </span>
                        </div>
                        <div className="task-kpi-footer">
                          <span className="task-kpi-meta">{it.meta}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Search Bar for Helpers */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="search" style={{ margin: 0, width: "100%", display: "flex", alignItems: "center" }}>
                <Search size={16} className="search-icon" />
                <input
                  placeholder="Search helper by name, phone, skill, service, location…"
                  value={helperSearch}
                  onChange={(e) => setHelperSearch(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: "14px", borderRadius: "8px" }}
                />
              </label>
            </div>

            {/* Filter Dropdowns Row: Service Filter + Location / Place Filter */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              {/* Service Filter */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: "8px", flex: "1 1 200px" }}>
                <Wrench size={14} style={{ color: "var(--brand)", flexShrink: 0 }} />
                <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Service:</span>
                <select
                  value={helperServiceFilter}
                  onChange={(e) => setHelperServiceFilter(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    fontSize: "13px",
                    fontWeight: helperServiceFilter ? 600 : 400,
                    width: "100%",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All Services ({availableServices.length} categories)</option>
                  {availableServices.map(({ name, count }) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Location / Place Filter */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: "8px", flex: "1 1 200px" }}>
                <MapPin size={14} style={{ color: "#ea580c", flexShrink: 0 }} />
                <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Location / Place:</span>
                <select
                  value={helperLocationFilter}
                  onChange={(e) => setHelperLocationFilter(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    fontSize: "13px",
                    fontWeight: helperLocationFilter ? 600 : 400,
                    width: "100%",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All Locations &amp; Places ({availableLocations.length} areas)</option>
                  {availableLocations.map(({ name, count }) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Clear Filters button if any filter is active */}
              {(helperServiceFilter || helperLocationFilter || helperFilter !== "all" || helperSearch) && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setHelperServiceFilter("");
                    setHelperLocationFilter("");
                    setHelperFilter("all");
                    setHelperSearch("");
                  }}
                  style={{ fontSize: "12px", color: "var(--brand)", padding: "6px 10px", fontWeight: 600 }}
                >
                  ✕ Clear filters
                </button>
              )}
            </div>

            {/* Helper Single-Line List Content */}
            {!helpers ? (
              <div className="card-body">
                <SkeletonRows rows={4} />
              </div>
            ) : filteredHelpers.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: "12px", background: "var(--surface)" }}>
                <Empty icon={Users}>No helpers match the selected filter or search query.</Empty>
              </div>
            ) : (
              <div className="task-group-section">
                <div className="task-group-header">
                  <div className="task-group-title" style={{ color: "var(--brand)" }}>
                    <span>Helper Directory</span>
                    <span className="badge" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                      {filteredHelpers.length}
                    </span>
                  </div>
                </div>
                <div className="task-line-list">
                  {filteredHelpers.map((h) => renderSingleLineHelper(h))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION B: TICKETS & TASKS - the same TaskBoard as WhatsApp > Send Work Order */}
        {activeSection === "tasks" && (
          <TaskBoard
            tickets={tickets}
            onChanged={onRefreshAll}
            onOpenHelper={(name) => {
              switchSection("helpers");
              setHelperSearch(name);
            }}
            onOpenCare={(id) => {
              setActiveSection("care");
              navigate(`/calling/care?care=all&cq=${encodeURIComponent(id)}`);
            }}
          />
        )}

        {/* SECTION C: CUSTOMER CARE (inbox: case list + case panel) */}
        {activeSection === "care" && (
          <CustomerCareView
            escalations={escalationsList}
            loading={!escalations && !polledEscalations}
            onChange={handleEscalationChange}
          />
        )}
      </div>
    );
  }

  /* =========================================================================
     VIEW 1: VOICE DIALING CONSOLE & CALL LOG (CALLING AGENT ANIMATION + LOGS)
     ========================================================================= */
  const renderCallOutcomeBadge = (c: Call) => {
    const isAccepted = c.outcome === "accepted" || c.outcome === "confirmed";
    const isRejected = c.outcome === "rejected" || c.outcome === "declined";
    const isRating = c.outcome && (c.outcome.startsWith("rating") || c.outcome.includes("rating"));

    let outcomeBadge = null;
    if (isAccepted) {
      outcomeBadge = (
        <span className="badge-outcome-accepted">
          <CheckCircle2 size={13} />
          <span>Accepted</span>
        </span>
      );
    } else if (isRejected) {
      outcomeBadge = (
        <span className="badge-outcome-rejected">
          <XCircle size={13} />
          <span>Rejected</span>
        </span>
      );
    } else if (isRating) {
      const rateNum = c.outcome?.replace(/\D/g, "") || "?";
      outcomeBadge = (
        <span className="badge-outcome-rating">
          <Sparkles size={12} />
          <span>Rating: {rateNum}/5</span>
        </span>
      );
    } else if (c.outcome === "failed") {
      outcomeBadge = (
        <span className="badge-outcome-failed">
          <AlertCircle size={12} />
          <span>Failed</span>
        </span>
      );
    } else if (c.outcome === "no_answer") {
      outcomeBadge = (
        <span className="badge-outcome-failed">
          <PhoneOff size={12} />
          <span>No answer</span>
        </span>
      );
    } else if (c.outcome === "busy") {
      outcomeBadge = (
        <span className="badge-outcome-failed">
          <PhoneOff size={12} />
          <span>Busy</span>
        </span>
      );
    } else {
      outcomeBadge = (
        <span className="badge-outcome-neutral">
          <span>{c.outcome ? c.outcome.replace(/_/g, " ") : "Ended"}</span>
        </span>
      );
    }

    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {outcomeBadge}
        {c.digits && (
          <span className="badge-dtmf-key" title={`DTMF key pressed: ${c.digits}`}>
            Key: {c.digits}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="agent-features-container calling-theme" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* MASTER CALLING AGENT ACTIVATION / DEACTIVATION BANNER */}
      <CallingAgentToggle variant="banner" onStatusChange={onRefreshAll} />

      {/* 1. CALLING AGENT CONSOLE HERO BANNER */}
      <div className="calling-console-hero">
        {/* Top Row: Identity & Status + Navigation Action Buttons */}
        <div className="calling-hero-top-row">
          <div className="calling-agent-identity">
            <div className="calling-avatar-beacon">
              <span className="beacon-ring" />
              <span className="beacon-ring r2" />
              <PhoneCall size={22} className={activeCalls.length > 0 ? "phone-ringing" : ""} />
            </div>

            <div className="calling-agent-meta">
              <h2>
                <span>AI Voice Calling Agent</span>
                <div className="calling-equalizer" title="Live audio engine active">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </h2>

              <div className="calling-status-row">
                {activeCalls.length > 0 ? (
                  <span className="pill tone-live" style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <span className="live-dot" />
                    <span><b>{activeCalls.length}</b> Live Call{activeCalls.length > 1 ? "s" : ""} in Progress</span>
                  </span>
                ) : (
                  <span className="pill tone-success" style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <span className="live-dot" style={{ background: "#10b981" }} />
                    <span>Telephony Ready · Outbound Outreach</span>
                  </span>
                )}

                <span className="tag" style={{ margin: 0, fontSize: "11px" }}>
                  <Radio size={11} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  {telephonyProvider === "twilio" ? "Twilio Voice" : "Dashboard Simulator"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row: 4-in-a-row KPI Metrics Strip */}
        <div className="calling-kpi-bar">
          <div className="calling-kpi-card">
            <span className="calling-kpi-label">Completed Calls</span>
            <span className="calling-kpi-num" style={{ color: "var(--brand)" }}>
              <AnimatedNumber value={completedCount} />
            </span>
            <span className="calling-kpi-sub">{acceptedCount} accepted on call</span>
          </div>

          <div className="calling-kpi-card">
            <span className="calling-kpi-label">Active Calls</span>
            <span className="calling-kpi-num" style={{ color: activeCalls.length > 0 ? "#0284c7" : "var(--text)" }}>
              <AnimatedNumber value={activeCalls.length} />
            </span>
            <span className="calling-kpi-sub">{activeCalls.length > 0 ? "Ringing / Connected" : "Standby"}</span>
          </div>

          <div className="calling-kpi-card">
            <span className="calling-kpi-label">Calling Tasks</span>
            <span className="calling-kpi-num" style={{ color: callingTickets.length > 0 ? "#ea580c" : "var(--text)" }}>
              <AnimatedNumber value={callingTickets.length} />
            </span>
            <span className="calling-kpi-sub">In dispatch queue</span>
          </div>

          <div className="calling-kpi-card">
            <span className="calling-kpi-label">Acceptance Rate</span>
            <span className="calling-kpi-num" style={{ color: "#16a34a" }}>
              {completedCount > 0 ? `${Math.round((acceptedCount / completedCount) * 100)}%` : "0%"}
            </span>
            <span className="calling-kpi-sub">Conversion rate</span>
          </div>
        </div>
      </div>

      {/* 3. ACTIVE LIVE CALLS & SIMULATOR (SHOWN IF CALLS ARE ACTIVE) */}
      {activeCalls.length > 0 && (
        <Card
          title={
            <>
              Live Calls &amp; Telephone Handset ({activeCalls.length}){" "}
              {telephonyProvider === "simulator" && <span className="tag">Interactive Simulator</span>}
            </>
          }
          icon={PhoneCall}
        >
          <LiveCalls
            calls={activeCalls}
            maxPrompts={ivrMaxPrompts}
            onChange={onRefreshAll}
            empty="No calls in progress right now."
          />
        </Card>
      )}

      {/* 3. TASKS CURRENTLY IN CALLING QUEUE (SHOWN IF DISPATCHING) */}
      {callingTickets.length > 0 && (
        <Card title={`Tasks Currently Calling Helpers (${callingTickets.length})`} icon={Radio}>
          <ul className="list">
            {callingTickets.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <b
                    style={{ cursor: "pointer", color: "var(--brand)" }}
                    onClick={() => navigate("/calling/tasks")}
                  >
                    {t.title || t.id}
                  </b>
                  <div className="small muted">
                    {t.address || t.city || "Location"} · {fmtMoney(t.budget)}
                  </div>
                </div>
                <span className="chip live" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <span className="live-dot" />
                  <span>Calling helpers...</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 4. CORE SECTION: COMPLETED CALLS COUNT & LIST OF CALLS */}
      <div id="call-log-section" className="call-log-section">
        {/* Section Header */}
        <div className="call-log-head">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <History size={20} style={{ color: "var(--brand)" }} />
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>List of Completed Calls</h3>
              <span className="badge" style={{ fontSize: "12px", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: "12px" }}>
                {completedCount} total calls
              </span>
            </div>
            <p className="small muted" style={{ margin: "4px 0 0 0" }}>
              Log of helper outreach calls, telephony outcomes, DTMF keypresses, and conversation talk times.
            </p>
          </div>

          {/* Quick Refresh Button */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRefreshAll}
            style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px" }}
          >
            <Activity size={13} />
            <span>Refresh Calls</span>
          </button>
        </div>

        {/* Filter Controls: Search Bar + Outcome Filter Buttons */}
        <div className="call-log-filters">
          {/* Search completed calls */}
          <div style={{ flex: "1 1 240px", maxWidth: "420px" }}>
            <label className="search" style={{ margin: 0, width: "100%", display: "flex", alignItems: "center" }}>
              <Search size={15} className="search-icon" />
              <input
                placeholder="Search by helper name, phone, task title, ID…"
                value={callSearch}
                onChange={(e) => setCallSearch(e.target.value)}
                style={{ width: "100%", padding: "8px 12px 8px 34px", fontSize: "13px", borderRadius: "8px" }}
              />
            </label>
          </div>

          {/* Outcome Filter Buttons */}
          <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              className={`btn btn-sm ${callFilter === "all" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCallFilter("all")}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              All Calls ({completedCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${callFilter === "accepted" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCallFilter("accepted")}
              style={
                callFilter === "accepted"
                  ? { background: "#16a34a", borderColor: "#16a34a", color: "#fff", fontSize: "12px", padding: "6px 12px" }
                  : { fontSize: "12px", padding: "6px 12px" }
              }
            >
              Accepted ({acceptedCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${callFilter === "rejected" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCallFilter("rejected")}
              style={
                callFilter === "rejected"
                  ? { background: "#ea580c", borderColor: "#ea580c", color: "#fff", fontSize: "12px", padding: "6px 12px" }
                  : { fontSize: "12px", padding: "6px 12px" }
              }
            >
              Rejected ({rejectedCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${callFilter === "other" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCallFilter("other")}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              Other / Failed ({otherCount})
            </button>
          </div>
        </div>

        {/* Table Column Header */}
        <div className="call-table-header">
          <div>Time &amp; Purpose</div>
          <div>Helper Partner</div>
          <div>Work Order / Task</div>
          <div>Talk Time</div>
          <div style={{ textAlign: "right" }}>Outcome &amp; Key</div>
        </div>

        {/* List of Completed Calls Content */}
        {!calls ? (
          <div style={{ padding: "1.5rem" }}>
            <SkeletonRows rows={4} />
          </div>
        ) : filteredCompletedCalls.length === 0 ? (
          <div style={{ padding: "3rem 1rem", textAlign: "center", background: "var(--surface)" }}>
            <Empty icon={PhoneOff}>
              {completedCount === 0
                ? "No completed calls yet. Trigger calls from Tickets & Tasks to view helper call logs here."
                : "No calls match the search or filter query."}
            </Empty>
          </div>
        ) : (
          <div>
            {filteredCompletedCalls.map((c) => {
              const durationStr = formatCallDuration(c);

              return (
                <div key={c.id} className="call-table-row">
                  {/* Column 1: Timestamp & Purpose */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: "5px" }}>
                      <Calendar size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                      <span>{c.created_at ? fmtDateTime(c.created_at) : "—"}</span>
                    </div>
                    <span className="small muted">
                      {c.created_at ? fmtRelative(c.created_at) : ""} · {c.purpose === "dispatch" ? "Task Offer" : "Reminder"}
                    </span>
                  </div>

                  {/* Column 2: Helper Name & Phone */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "var(--brand-surface, #e0e7ff)",
                        color: "var(--brand)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "13px",
                        flexShrink: 0,
                      }}
                    >
                      {c.helper_name ? c.helper_name[0].toUpperCase() : "H"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 650, color: "var(--text)" }} className="truncate">
                        {c.helper_name || "Helper Partner"}
                      </div>
                      <div className="small muted mono" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <PhoneCall size={11} style={{ flexShrink: 0 }} />
                        <span>{c.phone ? <PhoneText value={c.phone} /> : "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Column 3: Task / Ticket */}
                  <div style={{ minWidth: 0 }}>
                    <Link
                      to={`/tickets/${encodeURIComponent(c.ticket_id)}`}
                      className="truncate"
                      title={c.ticket_title || c.ticket_id}
                      style={{ fontWeight: 600, color: "var(--brand)", display: "block", textDecoration: "none" }}
                    >
                      {c.ticket_title || "Work Order"}
                    </Link>
                    <span className="small muted mono">#{c.ticket_id}</span>
                  </div>

                  {/* Column 4: Talk Time */}
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <Clock size={13} style={{ color: "var(--muted)" }} />
                    <span className="tabular mono" style={{ fontWeight: 600, fontSize: "13px" }}>
                      {durationStr}
                    </span>
                  </div>

                  {/* Column 5: Outcome & Response */}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {renderCallOutcomeBadge(c)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
