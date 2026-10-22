import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Grid,
  Layers,
  List,
  MapPin,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Avatar, Empty, Phone, Pill, SkeletonRows, useToast } from "../components/ui";
import { fmtRelative } from "../format";
import { usePoll } from "../hooks";
import type { HelperDetail } from "../types";

export default function Helpers() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: rawHelpers, refresh: refreshHelpers } = usePoll(() => api.helpers(), 12000);
  const { data: filterOpts } = usePoll(api.helperFilters, 30000);

  const [q, setQ] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  // Keep statusFilter in sync if URL query parameter changes
  useEffect(() => {
    const urlStatus = searchParams.get("status");
    if (urlStatus && urlStatus !== statusFilter) {
      setStatusFilter(urlStatus);
    }
  }, [searchParams]);

  const [syncing, setSyncing] = useState(false);
  const [activeHelperId, setActiveHelperId] = useState<string | null>(null);

  // Sync helpers explicitly
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncHelpers();
      toast.success(
        "Helpers Synced",
        `Retrieved ${res.stats?.fetched ?? 0} helpers from ExtraHand (${res.total ?? 0} total).`
      );
      refreshHelpers();
    } catch (e) {
      toast.error("Sync Failed", (e as Error).message);
    } finally {
      setTimeout(() => setSyncing(false), 800);
    }
  };

  const helpers = useMemo(() => rawHelpers ?? [], [rawHelpers]);

  // Dynamic filter options extracted from live helpers
  const availableServices = useMemo(() => {
    const isCleanService = (s?: string) => {
      if (!s || s.length < 2) return false;
      if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) return false;
      if (/^[0-9a-fA-F]{24}$/.test(s)) return false;
      if (/^[\d\s.,+-]+$/.test(s)) return false;
      if (/^\d+\+?\s*(?:years?|yrs?)\b/i.test(s)) return false;
      return true;
    };
    if (filterOpts?.services?.length) {
      return filterOpts.services.filter(isCleanService);
    }
    const s = new Set<string>();
    helpers.forEach((h) => {
      (h.categories || []).forEach((c) => isCleanService(c) && s.add(c));
      (h.skills || []).forEach((sk) => isCleanService(sk) && s.add(sk));
    });
    return Array.from(s).sort();
  }, [filterOpts, helpers]);

  const availableLocations = useMemo(() => {
    const isCleanLocation = (loc?: string) => {
      if (!loc || loc.length < 2) return false;
      if (loc.includes("+")) return false;
      if (/^\d+-\d+(?:-\d+)?$/.test(loc)) return false;
      if (/^[\d\s.,+-]+$/.test(loc)) return false;
      if (/^[0-9a-fA-F]{24}$/.test(loc)) return false;
      const lower = loc.toLowerCase();
      if (["telangana", "andhra pradesh", "karnataka", "maharashtra", "bihar", "tamil nadu"].includes(lower)) return false;
      return true;
    };
    if (filterOpts?.locations?.length) {
      return filterOpts.locations.filter(isCleanLocation);
    }
    const l = new Set<string>();
    helpers.forEach((h) => {
      if (h.city && isCleanLocation(h.city)) l.add(h.city);
      (h.work_areas || []).forEach((a) => isCleanLocation(a) && l.add(a));
    });
    return Array.from(l).sort();
  }, [filterOpts, helpers]);

  // Filtered rows
  const filtered = useMemo(() => {
    return helpers.filter((h) => {
      // Free text search
      if (q) {
        const query = q.toLowerCase();
        const searchable = [
          h.name,
          h.phone,
          h.alt_phone,
          h.email,
          h.id,
          h.profile_id,
          h.city,
          h.address,
          ...(h.skills || []),
          ...(h.categories || []),
          ...(h.work_areas || []),
        ];
        if (!searchable.some((val) => val?.toLowerCase().includes(query))) return false;
      }

      // Service / Category filter
      if (selectedService) {
        const target = selectedService.toLowerCase();
        const hasService =
          (h.categories || []).some((c) => c.toLowerCase().includes(target) || target.includes(c.toLowerCase())) ||
          (h.skills || []).some((s) => s.toLowerCase().includes(target) || target.includes(s.toLowerCase()));
        if (!hasService) return false;
      }

      // Location filter
      if (selectedLocation) {
        const target = selectedLocation.toLowerCase();
        const hasLoc =
          (h.city && h.city.toLowerCase().includes(target)) ||
          (h.work_areas || []).some((a) => a.toLowerCase().includes(target) || target.includes(a.toLowerCase()));
        if (!hasLoc) return false;
      }

      // Status & Verification filter
      if (statusFilter === "assigned" && !(h.active_tickets_count && h.active_tickets_count > 0)) return false;
      if (statusFilter === "active" && !h.is_active) return false;
      if (statusFilter === "verified" && !h.is_verified) return false;
      if (statusFilter === "can_accept" && !h.can_accept_tasks) return false;

      // Shift filter
      if (shiftFilter !== "all" && h.work_shift_type !== shiftFilter) return false;

      return true;
    });
  }, [helpers, q, selectedService, selectedLocation, statusFilter, shiftFilter]);

  const hasActiveFilters = Boolean(
    q || selectedService || selectedLocation || statusFilter !== "all" || shiftFilter !== "all"
  );

  const clearFilters = () => {
    setQ("");
    setSelectedService("");
    setSelectedLocation("");
    setStatusFilter("all");
    setShiftFilter("all");
  };

  // KPI calculations
  const kpis = useMemo(() => {
    const total = helpers.length;
    const servicesCount = availableServices.length;
    const citiesCount = new Set(helpers.map((h) => h.city).filter(Boolean)).size;
    const readyCount = helpers.filter((h) => h.can_accept_tasks && h.is_active).length;
    const assignedHelpersCount =
      filterOpts?.assigned_helpers_count ?? helpers.filter((h) => (h.active_tickets_count ?? 0) > 0).length;
    const assignedTicketsCount =
      filterOpts?.assigned_tickets_count ?? helpers.reduce((acc, h) => acc + (h.active_tickets_count ?? 0), 0);
    return { total, servicesCount, citiesCount, readyCount, assignedHelpersCount, assignedTicketsCount };
  }, [helpers, availableServices, filterOpts]);

  return (
    <Stagger className="page">
      {/* Header */}
      <motion.div className="page-head row" variants={itemVariants}>
        <div>
          <div className="crumbs">Platform / Partners</div>
          <h1>Helper details</h1>
          <p className="muted">
            Directory of ExtraHand service partners & dispatch helpers with skill profiles, coverage areas,
            verifications, and real-time dispatch history.
          </p>
        </div>
        <div className="topbar-actions">
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Card View"
              aria-label="Grid View"
            >
              <Grid size={16} />
            </button>
            <button
              className={`view-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table View"
              aria-label="Table View"
            >
              <List size={16} />
            </button>
          </div>
          <motion.button
            className="btn btn-secondary btn-md"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw size={14} className={syncing ? "spin" : ""} />
            <span>{syncing ? "Syncing…" : "Sync from ExtraHand"}</span>
          </motion.button>
        </div>
      </motion.div>

      {/* KPI Stats Banner */}
      <motion.div className="kpis" variants={itemVariants}>
        <div className="kpi">
          <div className="kpi-icon">
            <Users size={18} />
          </div>
          <div className="kpi-label">Total Helpers</div>
          <b>{kpis.total}</b>
        </div>
        <div className="kpi">
          <div className="kpi-icon">
            <Wrench size={18} />
          </div>
          <div className="kpi-label">Services Covered</div>
          <b>{kpis.servicesCount}</b>
        </div>
        <div className="kpi">
          <div className="kpi-icon">
            <MapPin size={18} />
          </div>
          <div className="kpi-label">Cities / Zones</div>
          <b>{kpis.citiesCount}</b>
        </div>
        <div className="kpi live">
          <div className="kpi-icon">
            <CheckCircle2 size={18} />
          </div>
          <div className="kpi-label">Dispatch Ready</div>
          <b>{kpis.readyCount}</b>
        </div>
        <div
          className={`kpi ${kpis.assignedHelpersCount > 0 ? "live clickable" : ""}`}
          onClick={() => {
            setStatusFilter("assigned");
            setSearchParams({ status: "assigned" });
          }}
          style={{ cursor: "pointer" }}
          title="Click to filter by currently assigned helpers"
        >
          <div className="kpi-icon">
            <Briefcase size={18} />
          </div>
          <div className="kpi-label">Currently Assigned</div>
          <b>
            {kpis.assignedHelpersCount} helpers
            <span style={{ fontSize: "0.75rem", fontWeight: 400, opacity: 0.75, display: "block" }}>
              {kpis.assignedTicketsCount} active tasks
            </span>
          </b>
        </div>
      </motion.div>

      {/* Filter and Search Bar */}
      <motion.div className="filter-bar" variants={itemVariants}>
        <label className="search">
          <Search size={15} className="search-icon" />
          <input
            placeholder="Search name, phone, skill, city, area…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        <div className="filter-controls">
          {/* Service / Category Filter */}
          <select
            className="filter-select"
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            aria-label="Filter by Service"
          >
            <option value="">All Services ({availableServices.length})</option>
            {availableServices.map((srv) => (
              <option key={srv} value={srv}>
                {srv}
              </option>
            ))}
          </select>

          {/* Location Filter */}
          <select
            className="filter-select"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            aria-label="Filter by Location"
          >
            <option value="">All Locations ({availableLocations.length})</option>
            {availableLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          {/* Status / Verifications */}
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by Status"
          >
            <option value="all">All Statuses</option>
            <option value="assigned">Currently Assigned ({kpis.assignedHelpersCount})</option>
            <option value="active">Active Only</option>
            <option value="verified">Aadhaar Verified</option>
            <option value="can_accept">Ready to Accept Tasks</option>
          </select>

          {/* Shift Type */}
          <select
            className="filter-select"
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            aria-label="Filter by Shift"
          >
            <option value="all">All Shifts</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
          </select>

          {hasActiveFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>

        <div className="filter-stats">
          Showing <b>{filtered.length}</b> of {helpers.length} helpers
        </div>
      </motion.div>

      {/* Main Content: Grid vs Table */}
      {!rawHelpers ? (
        <div className="card-body">
          <SkeletonRows />
        </div>
      ) : filtered.length === 0 ? (
        <Empty icon={Users}>
          {hasActiveFilters
            ? "No helpers match the selected filters. Try broadening your criteria or reset filters."
            : "No helpers stored yet. Click 'Sync from ExtraHand' to load all registered service partners."}
        </Empty>
      ) : viewMode === "grid" ? (
        <Stagger className="helpers-grid">
          {filtered.map((h) => (
            <motion.div
              key={h.id}
              className="helper-card-item"
              variants={itemVariants}
              onClick={() => setActiveHelperId(h.id)}
            >
              <div className="helper-card-head">
                <div className="helper-avatar-wrap">
                  <Avatar name={h.name} size={42} />
                  <span className={`helper-status-dot ${h.is_active ? "active" : ""}`} />
                </div>
                <div className="helper-card-title">
                  <div className="helper-card-name">
                    <span>{h.name ?? "Unnamed Helper"}</span>
                    {h.is_verified && (
                      <span className="badge-verified-mini" title="Aadhaar Verified">
                        <ShieldCheck size={16} />
                      </span>
                    )}
                  </div>
                  <div className="small muted mono">{h.id}</div>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {(h.active_tickets_count ?? 0) > 0 && (
                    <Pill
                      value="assigned"
                      label={`${h.active_tickets_count} Assigned`}
                      tone="info"
                    />
                  )}
                  <Pill
                    value={h.can_accept_tasks ? "ready" : "unavailable"}
                    label={h.can_accept_tasks ? "Ready" : "Unavailable"}
                    tone={h.can_accept_tasks ? "success" : "neutral"}
                  />
                </div>
              </div>

              <div className="helper-card-body">
                <div className="helper-info-row">
                  <Phone value={h.phone} />
                </div>
                <div className="helper-info-row">
                  <MapPin size={14} />
                  <span>
                    {h.city ?? "Location unassigned"}
                    {h.work_areas?.length ? ` (${h.work_areas.slice(0, 2).join(", ")})` : ""}
                  </span>
                </div>
                <div className="helper-tags-row">
                  {(h.categories?.length ? h.categories : h.skills).slice(0, 3).map((item) => (
                    <span key={item} className="chip">
                      {item}
                    </span>
                  ))}
                  {(h.categories?.length ? h.categories : h.skills).length > 3 && (
                    <span className="chip muted">
                      +{(h.categories?.length ? h.categories : h.skills).length - 3}
                    </span>
                  )}
                </div>
              </div>

              <div className="helper-card-footer">
                <div>
                  <span className="tag" style={{ marginLeft: 0 }}>
                    {h.work_shift_type === "part_time" ? "Part-time" : "Full-time"}
                  </span>
                </div>
                <div className="row" style={{ gap: "4px" }}>
                  <span>View Details</span>
                  <ChevronRight size={14} />
                </div>
              </div>
            </motion.div>
          ))}
        </Stagger>
      ) : (
        <motion.div className="table-wrap" variants={itemVariants}>
          <table className="table responsive">
            <thead>
              <tr>
                <th>Helper</th>
                <th>Contact</th>
                <th>Services & Skills</th>
                <th>Location & Coverage</th>
                <th>Shift & Status</th>
                <th>Workload</th>
                <th className="row-actions">Actions</th>
              </tr>
            </thead>
            <Stagger as="tbody">
              {filtered.map((h) => (
                <motion.tr
                  key={h.id}
                  variants={itemVariants}
                  className="clickable"
                  onClick={() => setActiveHelperId(h.id)}
                >
                  <td data-label="Helper">
                    <div className="person">
                      <Avatar name={h.name} size={34} />
                      <div>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                          {h.name ?? "—"}
                          {h.is_verified && (
                            <span title="Aadhaar Verified" style={{ display: "inline-flex" }}>
                              <ShieldCheck size={14} color="var(--brand)" />
                            </span>
                          )}
                        </div>
                        <div className="small muted mono">{h.id}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Contact">
                    <Phone value={h.phone} />
                    {h.email && <div className="small muted">{h.email}</div>}
                  </td>
                  <td data-label="Services & Skills">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {(h.categories?.length ? h.categories : h.skills).map((s) => (
                        <span key={s} className="chip">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Location & Coverage">
                    <div>
                      <b>{h.city ?? "—"}</b>
                    </div>
                    {h.work_areas?.length ? (
                      <div className="small muted">{h.work_areas.join(", ")}</div>
                    ) : null}
                    {h.lat != null && h.lng != null ? (
                      <div className="small muted mono">
                        {h.lat.toFixed(3)}, {h.lng.toFixed(3)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Shift & Status">
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      <Pill
                        value={h.can_accept_tasks ? "ready" : "unavailable"}
                        label={h.can_accept_tasks ? "Ready to call" : "Unavailable"}
                        tone={h.can_accept_tasks ? "success" : "neutral"}
                      />
                      <span className="small muted">
                        {h.work_shift_type === "part_time" ? "Part-time" : "Full-time"}
                      </span>
                    </div>
                  </td>
                  <td data-label="Workload">
                    <div className="small">
                      {(h.active_tickets_count ?? 0) > 0 ? (
                        <div style={{ marginBottom: 3 }}>
                          <span
                            className="chip"
                            style={{
                              background: "rgba(56, 189, 248, 0.15)",
                              color: "var(--info)",
                              borderColor: "rgba(56, 189, 248, 0.3)",
                              fontWeight: 600,
                            }}
                          >
                            {h.active_tickets_count} Active {h.active_tickets_count === 1 ? "task" : "tasks"}
                          </span>
                        </div>
                      ) : (
                        <div className="muted">0 tasks</div>
                      )}
                      <div className="muted">
                        Calls made: {h.total_calls_count ?? 0}
                      </div>
                    </div>
                  </td>
                  <td className="row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setActiveHelperId(h.id)}>
                      Details <ChevronRight size={13} />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </Stagger>
          </table>
        </motion.div>
      )}

      {/* Slide-over Drawer for Full Helper Details */}
      <AnimatePresence>
        {activeHelperId && (
          <HelperDetailDrawer
            helperId={activeHelperId}
            onClose={() => setActiveHelperId(null)}
          />
        )}
      </AnimatePresence>
    </Stagger>
  );
}

/** Detailed Slide-over Drawer component */
function HelperDetailDrawer({ helperId, onClose }: { helperId: string; onClose: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<HelperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "works" | "calls" | "raw">("overview");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .helper(helperId)
      .then((data) => {
        if (!cancel) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancel) {
          toast.error("Failed to load helper", err.message);
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [helperId, toast]);

  const copyText = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    toast.success("Copied to clipboard", `${label}: ${val}`);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <motion.div
        className="drawer-panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 450, damping: 38 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="drawer-head">
          <div className="drawer-head-info">
            <Avatar name={detail?.name ?? helperId} size={48} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ fontSize: "18px", margin: 0 }}>{detail?.name ?? helperId}</h2>
                {detail?.is_verified && (
                  <span className="pill tone-brand" title="Aadhaar Verified">
                    <ShieldCheck size={13} /> Verified
                  </span>
                )}
              </div>
              <div className="small muted mono" style={{ marginTop: 2 }}>
                UID: {helperId}
                {detail?.profile_id && ` · Profile: ${detail.profile_id}`}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close drawer">
            <X size={18} />
          </button>
        </div>

        {/* Drawer Tabs */}
        <div className="tabs" style={{ padding: "0 22px", background: "var(--surface)" }}>
          <button
            className={`tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <User size={15} /> Overview
          </button>
          <button
            className={`tab ${activeTab === "works" ? "active" : ""}`}
            onClick={() => setActiveTab("works")}
          >
            <Briefcase size={15} /> Assigned Works
            {detail?.tickets?.length ? <span className="tab-count">{detail.tickets.length}</span> : null}
          </button>
          <button
            className={`tab ${activeTab === "calls" ? "active" : ""}`}
            onClick={() => setActiveTab("calls")}
          >
            <PhoneCall size={15} /> Call History
            {detail?.calls?.length ? <span className="tab-count">{detail.calls.length}</span> : null}
          </button>
          <button
            className={`tab ${activeTab === "raw" ? "active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            <Layers size={15} /> Raw ExtraHand
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body">
          {loading || !detail ? (
            <SkeletonRows />
          ) : (
            <>
              {activeTab === "overview" && (
                <>
                  {/* Contact & Profile */}
                  <div className="drawer-section">
                    <div className="drawer-section-title">
                      <PhoneCall size={15} /> Contact & Identity
                    </div>
                    <div className="drawer-grid">
                      <div>
                        <div className="drawer-field-label">Primary Phone</div>
                        <div className="drawer-field-val" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Phone value={detail.phone} />
                          {detail.phone && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: "0 4px", height: "24px" }}
                              onClick={() => copyText(detail.phone!, "Phone")}
                              title="Copy phone"
                            >
                              <Copy size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      {detail.alt_phone && (
                        <div>
                          <div className="drawer-field-label">Alternate Phone</div>
                          <div className="drawer-field-val">
                            <Phone value={detail.alt_phone} />
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="drawer-field-label">Email Address</div>
                        <div className="drawer-field-val">{detail.email ?? "Not configured"}</div>
                      </div>
                      <div>
                        <div className="drawer-field-label">Account Status</div>
                        <div className="drawer-field-val" style={{ textTransform: "capitalize" }}>
                          <Pill
                            value={detail.status || "active"}
                            tone={detail.is_active ? "success" : "danger"}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="drawer-field-label">Dispatch Availability</div>
                        <div className="drawer-field-val">
                          <Pill
                            value={detail.can_accept_tasks ? "ready" : "disabled"}
                            label={detail.can_accept_tasks ? "Ready to accept tasks" : "Currently disabled"}
                            tone={detail.can_accept_tasks ? "success" : "neutral"}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="drawer-field-label">Work Shift Type</div>
                        <div className="drawer-field-val" style={{ textTransform: "capitalize" }}>
                          {detail.work_shift_type === "part_time" ? "Part-time Shift" : "Full-time Shift"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Services & Skills */}
                  <div className="drawer-section">
                    <div className="drawer-section-title">
                      <Wrench size={15} /> Services & Specializations
                    </div>
                    <div>
                      <div className="drawer-field-label" style={{ marginBottom: 6 }}>
                        Service Categories
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {detail.categories?.length ? (
                          detail.categories.map((c) => (
                            <span key={c} className="chip big">
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="muted">No explicit categories</span>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div className="drawer-field-label" style={{ marginBottom: 6 }}>
                        Specialized Skills
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {detail.skills?.length ? (
                          detail.skills.map((s) => (
                            <span key={s} className="chip">
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="muted">None listed</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Location & Coverage */}
                  <div className="drawer-section">
                    <div className="drawer-section-title">
                      <MapPin size={15} /> Location & Coverage Zones
                    </div>
                    <div className="drawer-grid">
                      <div>
                        <div className="drawer-field-label">City</div>
                        <div className="drawer-field-val">{detail.city ?? "—"}</div>
                      </div>
                      <div>
                        <div className="drawer-field-label">State / Region</div>
                        <div className="drawer-field-val">{detail.state ?? "—"}</div>
                      </div>
                      <div>
                        <div className="drawer-field-label">Pincode</div>
                        <div className="drawer-field-val">{detail.pincode ?? "—"}</div>
                      </div>
                      <div>
                        <div className="drawer-field-label">GPS Coordinates</div>
                        <div className="drawer-field-val mono small">
                          {detail.lat != null && detail.lng != null ? (
                            <a
                              href={`https://maps.google.com/?q=${detail.lat},${detail.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="link-icon"
                              style={{ color: "var(--brand)" }}
                            >
                              {detail.lat.toFixed(4)}, {detail.lng.toFixed(4)} <ExternalLink size={12} />
                            </a>
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div className="drawer-field-label" style={{ marginBottom: 4 }}>
                        Assigned Work Areas
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {detail.work_areas?.length ? (
                          detail.work_areas.map((a) => (
                            <span key={a} className="chip">
                              <MapPin size={12} /> {a}
                            </span>
                          ))
                        ) : (
                          <span className="muted">All city zones</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "works" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">
                    <Briefcase size={15} /> Assigned Tasks ({detail.tickets?.length ?? 0})
                  </div>
                  {!detail.tickets?.length ? (
                    <Empty icon={Briefcase}>No tasks currently assigned to this helper.</Empty>
                  ) : (
                    <div className="stack" style={{ gap: 10 }}>
                      {detail.tickets.map((t) => (
                        <Link
                          key={t.id}
                          to={`/tickets/${t.id}`}
                          className="card"
                          style={{ textDecoration: "none", color: "inherit", padding: "12px 14px" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{t.title ?? t.id}</div>
                              <div className="small muted">
                                {t.category ?? "General"} · {t.city ?? "—"}
                              </div>
                            </div>
                            <Pill value={t.dispatch_status} />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginTop: 8,
                              fontSize: "12px",
                              color: "var(--muted)",
                            }}
                          >
                            <span>Scheduled: {t.scheduled_at ? fmtRelative(t.scheduled_at) : "TBD"}</span>
                            {t.budget != null && <span className="amount">₹{t.budget}</span>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "calls" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">
                    <PhoneCall size={15} /> Call & Dispatch Logs ({detail.calls?.length ?? 0})
                  </div>
                  {!detail.calls?.length ? (
                    <Empty icon={PhoneCall}>No calls recorded yet for this helper.</Empty>
                  ) : (
                    <table className="table" style={{ fontSize: "12.5px" }}>
                      <thead>
                        <tr>
                          <th>Purpose</th>
                          <th>Status / Outcome</th>
                          <th>Prompts</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.calls.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <span style={{ textTransform: "capitalize", fontWeight: 550 }}>
                                {c.purpose}
                              </span>
                              {c.ticket_id && (
                                <div className="small muted mono">
                                  <Link to={`/tickets/${c.ticket_id}`}>{c.ticket_id}</Link>
                                </div>
                              )}
                            </td>
                            <td>
                              <Pill value={c.outcome || c.status} />
                            </td>
                            <td>{c.prompts_played} / 3</td>
                            <td className="small muted">{fmtRelative(c.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === "raw" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">
                    <Layers size={15} /> ExtraHand Raw JSON
                  </div>
                  <pre className="raw-box">
                    {JSON.stringify(detail.raw ?? detail, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
