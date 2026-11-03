import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api";
import type { CustomerFeedback } from "../types";

export const CustomerFeedbackPage: React.FC = () => {
  const [feedbacks, setFeedbacks] = useState<CustomerFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "complaints" | "callbacks">("all");
  const [selectedRating, setSelectedRating] = useState<number | "">("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<CustomerFeedback | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<string>("pending");
  const [editAgent, setEditAgent] = useState("");
  const [triggerTicketId, setTriggerTicketId] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchFeedbacks = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: { rating?: number; complaint_category?: string; resolution_status?: string; q?: string } = {};
      if (selectedRating !== "") params.rating = Number(selectedRating);
      if (selectedCategory) params.complaint_category = selectedCategory;
      if (searchQuery.trim()) params.q = searchQuery.trim();

      const data = await api.feedback.list(params);
      setFeedbacks(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load feedback records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedbacks();
  }, [selectedRating, selectedCategory]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFeedbacks();
  };

  const handleTriggerFeedbackCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!triggerTicketId.trim()) return;
    try {
      setTriggering(true);
      setSuccessMsg(null);
      const res = await api.feedback.trigger(triggerTicketId.trim());
      const callNum = res.call_id || res.call_attempt_id || "active";
      setSuccessMsg(`Feedback call initiated! Call #${callNum} (${res.status})`);
      setTriggerTicketId("");
      setTimeout(fetchFeedbacks, 1500);
    } catch (err: any) {
      setError(err?.message || "Failed to initiate feedback call");
    } finally {
      setTriggering(false);
    }
  };

  const openResolutionModal = (fb: CustomerFeedback) => {
    setSelectedFeedback(fb);
    setEditNotes(fb.resolution_notes || "");
    setEditStatus(fb.resolution_status || "pending");
    setEditAgent(fb.assigned_agent || "");
  };

  const handleSaveResolution = async () => {
    if (!selectedFeedback) return;
    try {
      await api.feedback.update(selectedFeedback.id, {
        resolution_status: editStatus as any,
        resolution_notes: editNotes,
        assigned_agent: editAgent,
      });
      setSuccessMsg(`Updated feedback resolution for booking #${selectedFeedback.ticket_id}`);
      setSelectedFeedback(null);
      fetchFeedbacks();
    } catch (err: any) {
      setError(err?.message || "Failed to update feedback resolution");
    }
  };

  // KPI Calculations
  const totalCount = feedbacks.length;
  const avgRating =
    totalCount > 0 ? (feedbacks.reduce((acc, f) => acc + f.rating, 0) / totalCount).toFixed(1) : "0.0";
  const complaints = feedbacks.filter((f) => f.complaint_category !== null || f.rating <= 2);
  const callbacks = feedbacks.filter((f) => f.callback_requested);
  const ratingCounts = [5, 4, 3, 2, 1].map((r) => ({
    stars: r,
    count: feedbacks.filter((f) => f.rating === r).length,
  }));

  const filteredList = feedbacks.filter((f) => {
    if (activeTab === "complaints") return f.complaint_category !== null || f.rating <= 2;
    if (activeTab === "callbacks") return f.callback_requested;
    return true;
  });

  return (
    <div className="feedback-page-container" style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <span style={{ fontSize: "1.75rem" }}>⭐</span>
            <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 800, color: "var(--blue-main, #2563eb)" }}>
              Customer Feedback &amp; Complaint Management
            </h1>
          </div>
          <p style={{ margin: 0, color: "var(--text-muted, #78716c)", fontSize: "0.95rem" }}>
            Post-service multilingual AI calling agent (Telugu, Hindi, English), CSAT tracking, and escalation resolution.
          </p>
        </div>

        {/* Trigger Call Widget */}
        <form
          onSubmit={handleTriggerFeedbackCall}
          style={{
            display: "flex",
            gap: "0.5rem",
            background: "var(--card-bg, rgba(255,255,255,0.05))",
            padding: "0.5rem 0.75rem",
            borderRadius: "10px",
            border: "1.5px solid rgba(59, 130, 246, 0.35)",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--blue-main, #2563eb)" }}>
            📞 Trigger Call:
          </span>
          <input
            type="text"
            placeholder="Booking / Ticket ID"
            value={triggerTicketId}
            onChange={(e) => setTriggerTicketId(e.target.value)}
            style={{
              padding: "0.35rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle, #d1d5db)",
              background: "var(--input-bg, #fff)",
              color: "inherit",
              fontSize: "0.85rem",
              width: "150px",
            }}
          />
          <button
            type="submit"
            disabled={triggering || !triggerTicketId.trim()}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              color: "#fff",
              border: "none",
              cursor: triggering ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: "0.85rem",
              boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
            }}
          >
            {triggering ? "Calling..." : "Call Customer"}
          </button>
        </form>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(16, 185, 129, 0.15)",
            border: "1px solid #10b981",
            borderRadius: "8px",
            color: "#059669",
            marginBottom: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>✓ {successMsg}</span>
          <button
            onClick={() => setSuccessMsg(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            color: "#dc2626",
            marginBottom: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>⚠️ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI Cards Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {/* CSAT Score Card */}
        <motion.div
          whileHover={{ y: -4, scale: 1.015 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: "spring", stiffness: 350, damping: 22 }}
          style={{
            background: "linear-gradient(135deg, rgba(37, 99, 235, 0.14), rgba(59, 130, 246, 0.05))",
            border: "1.5px solid rgba(59, 130, 246, 0.35)",
            borderRadius: "14px",
            padding: "1.2rem",
            boxShadow: "0 4px 16px rgba(37, 99, 235, 0.08)",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted, #64748b)", fontWeight: 700, letterSpacing: "0.03em" }}>AVERAGE CSAT</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.4rem" }}>
            <span style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--blue-bright, #3b82f6)" }}>
              {avgRating}
            </span>
            <span style={{ fontSize: "1.1rem", color: "#38bdf8" }}>★★★★★</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
            From {totalCount} post-service voice & WhatsApp responses
          </div>
        </motion.div>

        {/* Complaints Card */}
        <motion.div
          whileHover={{ y: -4, scale: 1.015 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: "spring", stiffness: 350, damping: 22 }}
          style={{
            background: "linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(220, 38, 38, 0.04))",
            border: "1.5px solid rgba(239, 68, 68, 0.35)",
            borderRadius: "14px",
            padding: "1.2rem",
            boxShadow: "0 4px 16px rgba(239, 68, 68, 0.08)",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "#dc2626", fontWeight: 700, letterSpacing: "0.03em" }}>ESCALATED COMPLAINTS</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 800, color: "#dc2626", marginTop: "0.4rem" }}>
            {complaints.length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
            Poor service, late arrivals & incomplete work
          </div>
        </motion.div>

        {/* Callbacks Requested */}
        <motion.div
          whileHover={{ y: -4, scale: 1.015 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: "spring", stiffness: 350, damping: 22 }}
          style={{
            background: "linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(37, 99, 235, 0.05))",
            border: "1.5px solid rgba(6, 182, 212, 0.35)",
            borderRadius: "14px",
            padding: "1.2rem",
            boxShadow: "0 4px 16px rgba(6, 182, 212, 0.08)",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--cyan-bright, #0284c7)", fontWeight: 700, letterSpacing: "0.03em" }}>CALLBACKS REQUESTED</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--cyan-bright, #0284c7)", marginTop: "0.4rem" }}>
            {callbacks.length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
            Customer pressed 9 or requested executive call
          </div>
        </motion.div>

        {/* Rating Breakdown Bar */}
        <motion.div
          whileHover={{ y: -4, scale: 1.015 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: "spring", stiffness: 350, damping: 22 }}
          style={{
            background: "var(--surface, rgba(255,255,255,0.05))",
            border: "1.5px solid rgba(59, 130, 246, 0.25)",
            borderRadius: "14px",
            padding: "1.1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-muted, #64748b)", marginBottom: "0.5rem", letterSpacing: "0.03em" }}>
            RATING DISTRIBUTION
          </div>
          {ratingCounts.map(({ stars, count }) => {
            const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
            return (
              <div key={stars} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                <span style={{ width: "28px", fontWeight: 700 }}>{stars} ★</span>
                <div style={{ flex: 1, height: "6px", background: "rgba(59, 130, 246, 0.12)", borderRadius: "3px", overflow: "hidden" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    style={{
                      height: "100%",
                      background: stars >= 4 ? "#10b981" : stars === 3 ? "#38bdf8" : "#ef4444",
                    }}
                  />
                </div>
                <span style={{ width: "20px", textAlign: "right", color: "var(--text-muted, #64748b)", fontWeight: 600 }}>{count}</span>
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Controls & Filter Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          background: "var(--card-bg, rgba(255,255,255,0.04))",
          padding: "1rem",
          borderRadius: "12px",
          border: "1.5px solid rgba(59, 130, 246, 0.25)",
          marginBottom: "1.25rem",
        }}
      >
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[
            { id: "all", label: `All Feedback (${feedbacks.length})` },
            { id: "complaints", label: `⚠️ Complaints (${complaints.length})` },
            { id: "callbacks", label: `📞 Callbacks (${callbacks.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                border: "none",
                fontWeight: 700,
                fontSize: "0.85rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
                background:
                  activeTab === tab.id
                    ? "linear-gradient(135deg, #2563eb, #1d4ed8)"
                    : "rgba(59, 130, 246, 0.08)",
                color: activeTab === tab.id ? "#fff" : "var(--text-2, #3b82f6)",
                boxShadow: activeTab === tab.id ? "0 2px 10px rgba(37, 99, 235, 0.35)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={selectedRating}
            onChange={(e) => setSelectedRating(e.target.value === "" ? "" : Number(e.target.value))}
            style={{
              padding: "0.45rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle, #d1d5db)",
              background: "var(--input-bg, #fff)",
              color: "inherit",
              fontSize: "0.85rem",
            }}
          >
            <option value="">All Ratings</option>
            <option value="5">5 Stars (Excellent)</option>
            <option value="4">4 Stars (Good)</option>
            <option value="3">3 Stars (Average)</option>
            <option value="2">2 Stars (Poor)</option>
            <option value="1">1 Star (Very Poor)</option>
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle, #d1d5db)",
              background: "var(--input-bg, #fff)",
              color: "inherit",
              fontSize: "0.85rem",
            }}
          >
            <option value="">All Categories</option>
            <option value="late_arrival">Late Arrival</option>
            <option value="poor_service">Poor Service</option>
            <option value="incomplete_work">Incomplete Work</option>
            <option value="overcharging">Overcharging</option>
            <option value="unprofessional">Unprofessional</option>
          </select>

          <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.3rem" }}>
            <input
              type="text"
              placeholder="Search comments / booking ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.45rem 0.6rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                fontSize: "0.85rem",
                width: "200px",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "0.45rem 0.8rem",
                borderRadius: "6px",
                border: "1.5px solid #3b82f6",
                background: "rgba(59, 130, 246, 0.1)",
                color: "#2563eb",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "0.85rem",
              }}
            >
              Search
            </button>
          </form>

          <a
            href={api.reports.exportUrl("feedback", 90)}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "6px",
              background: "rgba(37, 99, 235, 0.12)",
              color: "#2563eb",
              border: "1.5px solid rgba(59, 130, 246, 0.4)",
              textDecoration: "none",
              fontSize: "0.85rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            📥 Export CSV
          </a>
        </div>
      </div>

      {/* Feedback Records Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted, #78716c)" }}>
          Loading customer feedback records...
        </div>
      ) : filteredList.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            background: "var(--card-bg, rgba(255,255,255,0.03))",
            borderRadius: "10px",
            border: "1px dashed var(--border-subtle, #ccc)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>💬</div>
          <div style={{ fontWeight: 600, fontSize: "1rem" }}>No feedback records found</div>
          <p style={{ color: "var(--text-muted, #78716c)", fontSize: "0.85rem" }}>
            Post-service customer feedback calls and survey responses will appear here.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: "var(--card-bg, #fff)",
            borderRadius: "14px",
            border: "1.5px solid rgba(59, 130, 246, 0.25)",
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "rgba(37, 99, 235, 0.08)", borderBottom: "1.5px solid rgba(59, 130, 246, 0.25)" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Booking</th>
                <th style={{ padding: "0.75rem 1rem" }}>Rating</th>
                <th style={{ padding: "0.75rem 1rem" }}>Channel & Lang</th>
                <th style={{ padding: "0.75rem 1rem" }}>Customer Feedback / AI Summary</th>
                <th style={{ padding: "0.75rem 1rem" }}>Complaint Type</th>
                <th style={{ padding: "0.75rem 1rem" }}>Resolution</th>
                <th style={{ padding: "0.75rem 1rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map((fb) => (
                <tr
                  key={fb.id}
                  style={{
                    borderBottom: "1px solid rgba(59, 130, 246, 0.1)",
                    background: fb.complaint_category ? "rgba(239,68,68,0.02)" : "transparent",
                  }}
                >
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>
                    <a
                      href={`/tickets/${encodeURIComponent(fb.ticket_id)}`}
                      style={{ color: "var(--blue-bright, #3b82f6)", textDecoration: "none", fontWeight: 700 }}
                    >
                      #{fb.ticket_id}
                    </a>
                    {fb.call_duration_seconds && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #78716c)", fontWeight: 400 }}>
                        ⏱ {Math.round(fb.call_duration_seconds)}s call
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "6px",
                        fontWeight: 700,
                        background:
                          fb.rating >= 4 ? "rgba(16,185,129,0.15)" : fb.rating === 3 ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
                        color: fb.rating >= 4 ? "#059669" : fb.rating === 3 ? "#2563eb" : "#dc2626",
                      }}
                    >
                      {fb.rating} ★
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{fb.channel}</span>
                    <span
                      style={{
                        marginLeft: "0.4rem",
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.3rem",
                        borderRadius: "4px",
                        background: "rgba(59, 130, 246, 0.1)",
                        color: "var(--blue-bright, #3b82f6)",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {fb.language}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", maxWidth: "340px" }}>
                    <div style={{ fontWeight: 500, color: "inherit" }}>
                      {fb.feedback_text || "No verbal comments recorded."}
                    </div>
                    {fb.callback_requested && (
                      <span
                        style={{
                          display: "inline-block",
                          marginTop: "0.3rem",
                          fontSize: "0.7rem",
                          padding: "0.15rem 0.4rem",
                          borderRadius: "4px",
                          background: "rgba(37,99,235,0.15)",
                          color: "#2563eb",
                          fontWeight: 600,
                        }}
                      >
                        📞 Callback Requested
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    {fb.complaint_category ? (
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "6px",
                          background: "rgba(239,68,68,0.15)",
                          color: "#dc2626",
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "capitalize",
                        }}
                      >
                        {fb.complaint_category.replace("_", " ")}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted, #78716c)", fontSize: "0.8rem" }}>None</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "6px",
                        fontWeight: 600,
                        fontSize: "0.75rem",
                        background:
                          fb.resolution_status === "resolved"
                            ? "rgba(16,185,129,0.15)"
                            : fb.resolution_status === "in_review"
                            ? "rgba(59,130,246,0.15)"
                            : "rgba(245,158,11,0.15)",
                        color:
                          fb.resolution_status === "resolved"
                            ? "#059669"
                            : fb.resolution_status === "in_review"
                            ? "#2563eb"
                            : "#d97706",
                        textTransform: "capitalize",
                      }}
                    >
                      {fb.resolution_status}
                    </span>
                    {fb.assigned_agent && (
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted, #78716c)", marginTop: "0.2rem" }}>
                        Assignee: {fb.assigned_agent}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <button
                      onClick={() => openResolutionModal(fb)}
                      style={{
                        padding: "0.35rem 0.75rem",
                        borderRadius: "6px",
                        border: "1.5px solid rgba(59, 130, 246, 0.4)",
                        background: "rgba(37, 99, 235, 0.1)",
                        color: "#2563eb",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolution & Management Modal */}
      {selectedFeedback && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--card-bg, #fff)",
              color: "inherit",
              borderRadius: "14px",
              maxWidth: "520px",
              width: "100%",
              padding: "1.5rem",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              border: "1.5px solid rgba(59, 130, 246, 0.45)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--blue-bright, #2563eb)" }}>
                Resolution: Booking #{selectedFeedback.ticket_id}
              </h3>
              <button
                onClick={() => setSelectedFeedback(null)}
                style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "inherit" }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: "1rem", fontSize: "0.9rem" }}>
              <div>
                <strong>Rating:</strong> {selectedFeedback.rating} ★ ({selectedFeedback.sentiment})
              </div>
              <div style={{ marginTop: "0.3rem" }}>
                <strong>Comment:</strong> {selectedFeedback.feedback_text || "No verbal commentary."}
              </div>
              {selectedFeedback.complaint_category && (
                <div style={{ marginTop: "0.3rem", color: "#dc2626" }}>
                  <strong>Complaint:</strong> {selectedFeedback.complaint_category.replace("_", " ")}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Resolution Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle, #d1d5db)",
                    background: "var(--input-bg, #fff)",
                    color: "inherit",
                    fontSize: "0.85rem",
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="escalated">Escalated to Ops Lead</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Assign Support Executive
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh (Tier-2 Support)"
                  value={editAgent}
                  onChange={(e) => setEditAgent(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle, #d1d5db)",
                    background: "var(--input-bg, #fff)",
                    color: "inherit",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Resolution Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Details of customer callback, apology coupon, or helper retraining..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle, #d1d5db)",
                    background: "var(--input-bg, #fff)",
                    color: "inherit",
                    fontSize: "0.85rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setSelectedFeedback(null)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle, #ccc)",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveResolution}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                    color: "#fff",
                    border: "none",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 10px rgba(37, 99, 235, 0.35)",
                  }}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
