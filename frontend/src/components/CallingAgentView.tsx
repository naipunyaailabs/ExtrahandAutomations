import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Layers,
  LifeBuoy,
  MapPin,
  PhoneCall,
  PhoneOff,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  User,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { LiveCalls } from "./LiveCalls";
import { Card, Empty, SkeletonRows, Tabs, Phone as PhoneText } from "./ui";
import { AnimatedNumber } from "./motion";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import {
  CANONICAL_SERVICES,
  getCanonicalServices,
  getCanonicalLocations,
  formatHelperDisplayLocation,
} from "../helperTaxonomy";
import { EscalationCard } from "../pages/CustomerCare";
import { CallingDispatchFlow } from "./CallingDispatchFlow";
import type { Call, Escalation, EventItem, FollowUp, Helper, Stats, Ticket as TicketType } from "../types";

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

  const switchSection = (sec: "tasks" | "helpers" | "care") => {
    setActiveSection(sec);
    const targetUrl =
      sec === "tasks" ? "/calling/tasks" : sec === "helpers" ? "/calling/helpers" : "/calling/care";
    window.history.replaceState(null, "", targetUrl);
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
  const [careSearch, setCareSearch] = useState("");
  const [careFilter, setCareFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");

  const escalationCounts = useMemo(() => {
    const counts = { all: escalationsList.length, open: 0, in_progress: 0, resolved: 0 };
    for (const e of escalationsList) {
      if (e.status === "open") counts.open++;
      else if (e.status === "in_progress") counts.in_progress++;
      else if (e.status === "resolved") counts.resolved++;
    }
    return counts;
  }, [escalationsList]);

  const filteredEscalations = useMemo(() => {
    return escalationsList.filter((e) => {
      if (careFilter === "open" && e.status !== "open") return false;
      if (careFilter === "in_progress" && e.status !== "in_progress") return false;
      if (careFilter === "resolved" && e.status !== "resolved") return false;

      if (careSearch.trim()) {
        const q = careSearch.toLowerCase();
        const matchesTicket =
          e.ticket?.id?.toLowerCase().includes(q) ||
          e.ticket?.title?.toLowerCase().includes(q) ||
          e.ticket?.customer?.name?.toLowerCase().includes(q) ||
          e.ticket?.customer?.phone?.includes(q) ||
          e.ticket?.category?.toLowerCase().includes(q) ||
          e.ticket?.city?.toLowerCase().includes(q) ||
          e.ticket?.address?.toLowerCase().includes(q);
        const matchesReason = e.reason?.toLowerCase().includes(q);
        const matchesNotes = e.notes?.toLowerCase().includes(q);
        const matchesDetails = e.details?.toLowerCase().includes(q);
        const matchesAssignee = e.assigned_to?.toLowerCase().includes(q);
        if (!matchesTicket && !matchesReason && !matchesNotes && !matchesDetails && !matchesAssignee) return false;
      }
      return true;
    });
  }, [escalationsList, careFilter, careSearch]);

  const handleEscalationChange = () => {
    onRefreshEscalations?.();
    refreshPolledEscalations();
    onRefreshAll();
  };

  // Tasks state
  const [ticketSearch, setTicketSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "upcoming" | "past">("all");
  const [ticketStatusFilter, setTicketStatusFilter] = useState("");
  const [ticketSortOrder] = useState<"desc" | "asc">("desc");

  // Helpers state
  const [helperSearch, setHelperSearch] = useState("");
  const [helperFilter, setHelperFilter] = useState<"all" | "available" | "assigned" | "verified">("all");
  const [helperServiceFilter, setHelperServiceFilter] = useState("");
  const [helperLocationFilter, setHelperLocationFilter] = useState("");

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

  const [callFilter, setCallFilter] = useState<"all" | "accepted" | "rejected" | "other">("all");
  const [callSearch, setCallSearch] = useState("");

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
    if (type === "all") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
      setTicketStatusFilter("");
    } else if (type === "assigned") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
      setTicketStatusFilter("assigned");
    } else if (type === "unassigned") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
      setTicketStatusFilter("new");
    } else if (type === "calls") {
      setActiveTab("console");
      setCallFilter("all");
      const el = document.getElementById("call-log-section");
      el?.scrollIntoView({ behavior: "smooth" });
    } else if (type === "accepted") {
      setActiveTab("console");
      setCallFilter("accepted");
      const el = document.getElementById("call-log-section");
      el?.scrollIntoView({ behavior: "smooth" });
    } else if (type === "care") {
      setActiveTab("tickets");
      setActiveSection("care");
    } else if (type === "direct_followup") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
      setTicketStatusFilter("assigned");
    } else if (type === "calling_followup") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
    } else if (type === "followup") {
      setActiveTab("tickets");
      setActiveSection("tasks");
      setDateFilter("today");
    }
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

  // Determine date category dynamically relative to current live calendar day:
  // - today: scheduled/created today (Current Tasks)
  // - upcoming: scheduled in future (Upcoming Tasks)
  // - past: scheduled before today (Previous Tasks)
  const getDateCategory = (t: TicketType): "today" | "upcoming" | "past" => {
    // The backend decides (same rule as the dashboards: booked today or scheduled for today, India time)
    if (t.date_status === "today" || t.date_status === "upcoming" || t.date_status === "past") return t.date_status;
    const dateStr = t.scheduled_at || t.created_at;
    if (!dateStr) return "past";
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return "past";

    const now = new Date();
    const dTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const dNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diffDays = Math.round((dTarget - dNow) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays > 0) return "upcoming";
    return "past";
  };

  // Live date counts recomputed dynamically whenever tickets or calendar day changes
  const dateCounts = useMemo(() => {
    const counts = { all: tickets?.length ?? 0, today: 0, upcoming: 0, past: 0 };
    for (const t of tickets ?? []) {
      const cat = getDateCategory(t);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [tickets, currentDayKey]);

  // Status counts
  const ticketCounts: Record<string, number> = {};
  for (const t of tickets ?? []) {
    ticketCounts[t.dispatch_status] = (ticketCounts[t.dispatch_status] ?? 0) + 1;
    if (t.status === "completed") ticketCounts["completed"] = (ticketCounts["completed"] ?? 0) + 1;
    if (t.status === "cancelled") ticketCounts["cancelled"] = (ticketCounts["cancelled"] ?? 0) + 1;
  }

  const STATUS_TABS = [
    { key: "", label: "All Status", count: tickets?.length ?? 0 },
    { key: "new", label: "Unassigned", count: ticketCounts["new"] ?? 0 },
    { key: "dispatching", label: "Calling", count: ticketCounts["dispatching"] ?? 0 },
    { key: "assigned", label: "Assigned", count: ticketCounts["assigned"] ?? 0 },
    { key: "completed", label: "Completed", count: ticketCounts["completed"] ?? 0 },
  ];

  const filteredTickets = useMemo(() => {
    const list = (tickets ?? []).filter((t) => {
      const cat = getDateCategory(t);
      if (dateFilter !== "all" && cat !== dateFilter) return false;

      if (ticketStatusFilter) {
        if (ticketStatusFilter === "completed" && t.status !== "completed") return false;
        if (ticketStatusFilter === "cancelled" && t.status !== "cancelled") return false;
        if (
          ticketStatusFilter !== "completed" &&
          ticketStatusFilter !== "cancelled" &&
          t.dispatch_status !== ticketStatusFilter
        ) {
          return false;
        }
      }
      if (!ticketSearch.trim()) return true;
      const q = ticketSearch.toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q)) ||
        (t.customer?.name && t.customer.name.toLowerCase().includes(q)) ||
        (t.customer?.phone && t.customer.phone.includes(q)) ||
        (t.address && t.address.toLowerCase().includes(q)) ||
        (t.city && t.city.toLowerCase().includes(q))
      );
    });

    return [...list].sort((a, b) => {
      const timeA = a.scheduled_at
        ? new Date(a.scheduled_at).getTime()
        : a.created_at
        ? new Date(a.created_at).getTime()
        : 0;
      const timeB = b.scheduled_at
        ? new Date(b.scheduled_at).getTime()
        : b.created_at
        ? new Date(b.created_at).getTime()
        : 0;
      return ticketSortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [tickets, dateFilter, ticketStatusFilter, ticketSearch, ticketSortOrder, currentDayKey]);

  // Group filtered tasks by Date: Current (Today), Upcoming (Future), Previous (Past)
  const todayList = useMemo(() => filteredTickets.filter((t) => getDateCategory(t) === "today"), [filteredTickets, currentDayKey]);
  const futureList = useMemo(() => filteredTickets.filter((t) => getDateCategory(t) === "upcoming"), [filteredTickets, currentDayKey]);
  const pastList = useMemo(() => filteredTickets.filter((t) => getDateCategory(t) === "past"), [filteredTickets, currentDayKey]);

  // Helpers filtering logic with Status, Service, Location/Place, and Text search
  const filteredHelpers = useMemo(() => {
    return (helpers ?? []).filter((h) => {
      // 1. Status Filter
      if (helperFilter === "available" && (!h.can_accept_tasks || !h.is_active || (h.active_tickets_count ?? 0) > 0)) {
        return false;
      }
      if (helperFilter === "assigned" && (h.active_tickets_count ?? 0) === 0) {
        return false;
      }
      if (helperFilter === "verified" && !h.is_verified) {
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
    const all = helpers?.length ?? 0;
    const available = (helpers ?? []).filter(
      (h) => h.can_accept_tasks && h.is_active && (h.active_tickets_count ?? 0) === 0
    ).length;
    const assigned = (helpers ?? []).filter((h) => (h.active_tickets_count ?? 0) > 0).length;
    const verified = (helpers ?? []).filter((h) => h.is_verified).length;
    return { all, available, assigned, verified };
  }, [helpers]);

  const renderSingleLineHelper = (h: Helper) => {
    const isAvailable = h.can_accept_tasks && h.is_active && (h.active_tickets_count ?? 0) === 0;
    const isAssigned = (h.active_tickets_count ?? 0) > 0;
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
          <span className="tag" style={{ margin: 0, fontSize: "11px" }}>
            {h.work_shift_type === "part_time" ? "Part-time" : "Full-time"}
          </span>
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
            <span className="muted" style={{ fontSize: "12px" }}>
              Inactive
            </span>
          )}
        </div>
      </div>
    );
  };

  // Render ExtraHand Work Status Badge (Open, In Progress, Completed, Cancelled, Assigned)
  const renderWorkStatusBadge = (status: string | null) => {
    const s = (status || "open").toLowerCase().trim();
    if (s.includes("complete") || s.includes("done")) {
      return (
        <span className="task-status-pill status-completed" title="ExtraHand Work Status: Completed">
          <span className="status-dot green" />
          <span>Completed</span>
        </span>
      );
    }
    if (s.includes("progress") || s.includes("started") || s.includes("working")) {
      return (
        <span className="task-status-pill status-in-progress" title="ExtraHand Work Status: In Progress">
          <span className="status-dot blue" />
          <span>In Progress</span>
        </span>
      );
    }
    if (s.includes("cancel")) {
      return (
        <span className="task-status-pill status-cancelled" title="ExtraHand Work Status: Cancelled">
          <span className="status-dot red" />
          <span>Cancelled</span>
        </span>
      );
    }
    if (s.includes("assign")) {
      return (
        <span className="task-status-pill status-assigned" title="ExtraHand Work Status: Assigned">
          <span className="status-dot purple" />
          <span>Assigned</span>
        </span>
      );
    }
    return (
      <span className="task-status-pill status-open" title="ExtraHand Work Status: Open">
        <span className="status-dot amber" />
        <span>Open</span>
      </span>
    );
  };

  // Render Automated Voice Follow-Up Reminder Badge (from system)
  const renderFollowupBadge = (fu?: FollowUp | null) => {
    if (!fu) {
      return (
        <span className="task-followup-pill followup-none" title="No automated voice follow-up reminder scheduled">
          <span className="muted mono" style={{ fontSize: "11px" }}>— No Follow-up</span>
        </span>
      );
    }
    const status = (fu.status || "").toLowerCase().trim();
    if (status === "calling" || status === "active") {
      return (
        <span className="task-followup-pill followup-calling" title="Calling helper for follow-up confirmation">
          <span className="live-dot" />
          <span>Calling…</span>
        </span>
      );
    }
    if (status === "completed" || status === "done" || status === "confirmed") {
      return (
        <span className="task-followup-pill followup-confirmed" title="Follow-up call completed & verified">
          <CheckCircle2 size={11} style={{ flexShrink: 0 }} />
          <span>Confirmed</span>
        </span>
      );
    }
    return (
      <span className="task-followup-pill followup-scheduled" title={`Follow-up reminder due at ${fmtDateTime(fu.due_at)}`}>
        <Clock size={11} style={{ flexShrink: 0 }} />
        <span className="nowrap">Due {fmtRelative(fu.due_at)}</span>
      </span>
    );
  };

  // Helper to render table column header row
  const renderTaskListHeader = () => (
    <div className="task-line-header-row">
      <div className="task-line-main header-label">Task &amp; Service</div>
      <div className="task-line-customer header-label">Customer</div>
      <div className="task-line-location header-label">Location</div>
      <div className="task-line-schedule header-label">Schedule</div>
      <div className="task-line-status header-label">Work Status</div>
      <div className="task-line-followup header-label">Follow-up</div>
      <div className="task-line-budget header-label" style={{ textAlign: "right", justifyContent: "flex-end" }}>Budget</div>
      <div className="task-line-assignment header-label" style={{ justifyContent: "flex-end" }}>Dispatch</div>
    </div>
  );

  // Helper to render each task cleanly in a single line
  const renderSingleLineTask = (t: TicketType, cat: "today" | "upcoming" | "past") => {
    return (
      <div key={t.id} className={`task-line-item line-${cat}`}>
        {/* Task Title, Category Tag, ID */}
        <div className="task-line-main">
          <span style={{ fontWeight: 650, color: "var(--text)" }}>{t.title || "Customer Task"}</span>
          <span className="task-category-tag">{t.category || "Service"}</span>
          <span className="small muted mono">#{String(t.id || "").slice(-6)}</span>
        </div>

        {/* Customer & Phone */}
        <div className="task-line-customer">
          <User size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <div>
            <span style={{ fontWeight: 600 }}>{t.customer?.name || "Customer"}</span>
            {t.customer?.phone && (
              <span className="small muted">
                {" "}· <PhoneText value={t.customer?.phone} />
              </span>
            )}
          </div>
        </div>

        {/* Location */}
        <div className="task-line-location">
          <MapPin size={13} style={{ flexShrink: 0 }} />
          <span className="truncate" title={t.address || t.city || ""}>
            {t.city || t.address || "Bangalore"}
          </span>
        </div>

        {/* Scheduled Timing */}
        <div className="task-line-schedule">
          <Calendar size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span className="nowrap">
            {t.scheduled_at ? fmtDateTime(t.scheduled_at) : "Flexible"}
          </span>
        </div>

        {/* Work Status (ExtraHand) */}
        <div className="task-line-status">
          {renderWorkStatusBadge(t.status)}
        </div>

        {/* Voice Follow-Up Reminder */}
        <div className="task-line-followup">
          {renderFollowupBadge(t.next_followup)}
        </div>

        {/* Budget Amount */}
        <div className="task-line-budget">
          {t.budget && t.budget > 0 ? fmtMoney(t.budget) : "Negotiable"}
        </div>

        {/* Assignment Status:
            - For PAST: Yellow badge, DO NOT show assigned / unassigned!
            - For TODAY & FUTURE: Prominently show assigned or unassigned! */}
        <div className="task-line-assignment">
          {cat === "past" ? (
            <span className="badge-past-yellow">Closed</span>
          ) : t.assignee ? (
            <span
              className="task-status-assigned-badge clickable"
              style={{ cursor: "pointer" }}
              title="Click to view helper details without leaving page"
              onClick={() => {
                switchSection("helpers");
                setHelperSearch(t.assignee?.name || "");
              }}
            >
              <CheckCircle2 size={13} />
              <span>
                Assigned: <b>{t.assignee?.name || "Assigned"}</b>
              </span>
            </span>
          ) : t.dispatch_status === "escalated" ? (
            <span
              className="badge clickable"
              style={{
                cursor: "pointer",
                background: "rgba(239, 68, 68, 0.12)",
                color: "var(--danger)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: 600,
              }}
              title="Click to view Customer Care escalation in-page"
              onClick={() => {
                switchSection("care");
                setCareSearch(t.id);
              }}
            >
              <LifeBuoy size={13} />
              <span>Customer Care</span>
            </span>
          ) : t.active_call ? (
            <span className="task-status-calling-badge">
              <span className="live-dot" />
              <span>Calling: {t.active_call?.helper_name || "Helper"}…</span>
            </span>
          ) : (
            <span className="task-status-unassigned-badge">
              <AlertCircle size={13} />
              <span>Unassigned</span>
            </span>
          )}
        </div>
      </div>
    );
  };

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
                  ? `${filteredTickets.length} tasks`
                  : activeSection === "helpers"
                  ? `${filteredHelpers.length} helpers`
                  : `${filteredEscalations.length} cases`}
              </span>
            </div>
            <p className="muted" style={{ margin: "4px 0 0 0", fontSize: "0.875rem" }}>
              {activeSection === "tasks"
                ? "Separated list view: Tasks grouped by Current, Upcoming, and Previous schedule dates. All details in one clean line."
                : activeSection === "helpers"
                ? "Directory of ExtraHand service partners & dispatch helpers with skill profiles, locations, and dispatch availability in list format."
                : "Escalated customer tasks requiring manual resolution, helper redispatch, or customer callbacks."}
            </p>
          </div>
        </div>

        {/* SECTION A: HELPER DETAILS LIST VIEW */}
        {activeSection === "helpers" && (
          <div>
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

            {/* Helper Status Filter Buttons */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`btn btn-sm ${helperFilter === "all" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHelperFilter("all")}
              >
                All Helpers ({helperCounts.all})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${helperFilter === "available" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHelperFilter("available")}
                style={helperFilter === "available" ? { background: "#16a34a", borderColor: "#16a34a", color: "#fff" } : {}}
              >
                Available / Ready ({helperCounts.available})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${helperFilter === "assigned" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHelperFilter("assigned")}
                style={helperFilter === "assigned" ? { background: "#2563eb", borderColor: "#2563eb", color: "#fff" } : {}}
              >
                Currently Assigned ({helperCounts.assigned})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${helperFilter === "verified" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHelperFilter("verified")}
                style={helperFilter === "verified" ? { background: "#7c3aed", borderColor: "#7c3aed", color: "#fff" } : {}}
              >
                Verified Partners ({helperCounts.verified})
              </button>
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

        {/* SECTION B: TICKETS & TASKS LIST VIEW */}
        {activeSection === "tasks" && (
          <div>
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
                    <AnimatedNumber value={dateCounts.all} />
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
                    <AnimatedNumber value={dateCounts.today} />
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
                    <AnimatedNumber value={dateCounts.upcoming} />
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
                    <AnimatedNumber value={dateCounts.past} />
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

            {/* Search Bar */}
            <div style={{ marginBottom: "1rem" }}>
              <label className="search" style={{ margin: 0, width: "100%", display: "flex", alignItems: "center" }}>
                <Search size={16} className="search-icon" />
                <input
                  placeholder="Search task, customer name, phone, location, service…"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: "14px", borderRadius: "8px" }}
                />
              </label>
            </div>

            {/* Status Filter Tabs */}
            <div style={{ marginBottom: "1.25rem" }}>
              <Tabs
                value={ticketStatusFilter}
                onChange={(val) => setTicketStatusFilter(val)}
                items={STATUS_TABS}
              />
            </div>

            {/* List Content */}
            {!tickets ? (
              <div className="card-body">
                <SkeletonRows rows={4} />
              </div>
            ) : filteredTickets.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: "12px", background: "var(--surface)" }}>
                <Empty icon={Ticket}>No tickets match the selected date or search filter.</Empty>
              </div>
            ) : (
              <div>
                {/* SECTION 1: CURRENT TASKS (GREEN) */}
                {(dateFilter === "all" || dateFilter === "today") && todayList.length > 0 && (
                  <div className="task-group-section">
                    <div className="task-group-header">
                      <div className="task-group-title" style={{ color: "#047857" }}>
                        <span>Current Tasks</span>
                        <span className="badge-today-green">{todayList.length}</span>
                      </div>
                    </div>
                    {renderTaskListHeader()}
                    <div className="task-line-list">
                      {todayList.map((t) => renderSingleLineTask(t, "today"))}
                    </div>
                  </div>
                )}

                {/* SECTION 2: UPCOMING TASKS (ORANGE) */}
                {(dateFilter === "all" || dateFilter === "upcoming") && futureList.length > 0 && (
                  <div className="task-group-section">
                    <div className="task-group-header">
                      <div className="task-group-title" style={{ color: "#c2410c" }}>
                        <span>Upcoming Tasks</span>
                        <span className="badge-future-orange">{futureList.length}</span>
                      </div>
                    </div>
                    {renderTaskListHeader()}
                    <div className="task-line-list">
                      {futureList.map((t) => renderSingleLineTask(t, "upcoming"))}
                    </div>
                  </div>
                )}

                {/* SECTION 3: PREVIOUS TASKS (YELLOW) */}
                {(dateFilter === "all" || dateFilter === "past") && pastList.length > 0 && (
                  <div className="task-group-section">
                    <div className="task-group-header">
                      <div className="task-group-title" style={{ color: "#854d0e" }}>
                        <span>Previous Tasks</span>
                        <span className="badge-past-yellow">{pastList.length}</span>
                      </div>
                    </div>
                    {renderTaskListHeader()}
                    <div className="task-line-list">
                      {pastList.map((t) => renderSingleLineTask(t, "past"))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SECTION C: CUSTOMER CARE & ESCALATIONS VIEW */}
        {activeSection === "care" && (
          <div>
            {/* Search Bar & Status Filter Row */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginBottom: "1rem",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {/* Search Bar for Customer Care */}
              <div style={{ flex: "1 1 280px", maxWidth: "480px" }}>
                <label className="search" style={{ margin: 0, width: "100%", display: "flex", alignItems: "center" }}>
                  <Search size={16} className="search-icon" />
                  <input
                    placeholder="Search by ticket ID, customer name, phone, reason, or notes…"
                    value={careSearch}
                    onChange={(e) => setCareSearch(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: "14px", borderRadius: "8px" }}
                  />
                </label>
              </div>

              {/* Status Filter Buttons */}
              <div
                style={{
                  display: "inline-flex",
                  gap: "6px",
                  background: "var(--surface-2)",
                  padding: "4px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className={`btn btn-sm ${careFilter === "all" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCareFilter("all")}
                  style={{ fontSize: "12px", fontWeight: 600 }}
                >
                  All ({escalationsList.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${careFilter === "open" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCareFilter("open")}
                  style={{ fontSize: "12px", fontWeight: 600 }}
                >
                  Open ({escalationCounts.open})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${careFilter === "in_progress" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCareFilter("in_progress")}
                  style={{ fontSize: "12px", fontWeight: 600 }}
                >
                  In Progress ({escalationCounts.in_progress})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${careFilter === "resolved" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setCareFilter("resolved")}
                  style={{ fontSize: "12px", fontWeight: 600 }}
                >
                  Resolved ({escalationCounts.resolved})
                </button>
              </div>
            </div>

            {/* List of Escalation Cards */}
            {filteredEscalations.length === 0 ? (
              <div
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  color: "var(--muted)",
                }}
              >
                <LifeBuoy size={42} style={{ margin: "0 auto 12px auto", opacity: 0.5, color: "var(--brand)" }} />
                <h3 style={{ margin: "0 0 6px 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--text)" }}>
                  No Customer Care Cases Found
                </h3>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>
                  {careSearch || careFilter !== "all"
                    ? "Try adjusting your search query or status filter."
                    : "All customer tickets are currently placed or resolved."}
                </p>
              </div>
            ) : (
              <div className="esc-list" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {filteredEscalations.map((esc) => (
                  <EscalationCard
                    key={esc.id}
                    esc={esc}
                    onChange={handleEscalationChange}
                  />
                ))}
              </div>
            )}
          </div>
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
                    onClick={() => {
                      setActiveTab("tickets");
                      setActiveSection("tasks");
                    }}
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
