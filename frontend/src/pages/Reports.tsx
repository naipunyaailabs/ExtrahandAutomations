import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Calendar,
  Crown,
  MapPin,
  Phone,
  Search,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "../api";
import { WhatsAppIcon } from "../components/ui";
import type { UserSegmentationSummary, UserSegmentItem, UserTier } from "../types";

const AVATAR_BG = [
  "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
  "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
];

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const ReportsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const urlTier = searchParams.get("tier") as UserTier | null;

  const [period, setPeriod] = useState<"monthly" | "weekly">("monthly");
  const [selectedTier, setSelectedTier] = useState<"all" | UserTier>(urlTier || "all");
  const [searchQuery, setSearchQuery] = useState("");

  const [segmentation, setSegmentation] = useState<UserSegmentationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync URL tier parameter
  useEffect(() => {
    if (urlTier && (urlTier === "diamond" || urlTier === "gold" || urlTier === "silver")) {
      setSelectedTier(urlTier);
    } else if (!urlTier) {
      setSelectedTier("all");
    }
  }, [urlTier]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.engagement.users();
      setSegmentation(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load user engagement list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filter users based on tier selection and search input
  const filteredUsers = useMemo<UserSegmentItem[]>(() => {
    if (!segmentation?.users) return [];
    return segmentation.users.filter((user) => {
      if (selectedTier !== "all") {
        const targetTier = period === "weekly" ? user.weekly_tier : user.monthly_tier;
        if (targetTier !== selectedTier) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        user.name.toLowerCase().includes(q) ||
        user.phone.includes(q) ||
        user.city.toLowerCase().includes(q) ||
        user.top_category.toLowerCase().includes(q)
      );
    });
  }, [segmentation, selectedTier, period, searchQuery]);

  const counts = period === "weekly" ? segmentation?.weekly : segmentation?.monthly;

  return (
    <div className="reports-page-container" style={{ padding: "1.5rem 1.75rem", maxWidth: "1440px", margin: "0 auto" }}>
      {/* =========================================================================
          HEADER: USER ENGAGEMENT TIER MONITORING
          ========================================================================= */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.5rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, color: "var(--text)" }}>
            User Engagement
          </h1>
        </div>

        {/* Period Selector (Monthly vs Weekly) */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "var(--raised, #f1f5f9)", padding: "4px", borderRadius: "8px" }}>
          <button
            type="button"
            onClick={() => setPeriod("monthly")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: period === "monthly" ? "linear-gradient(135deg, #4f46e5, #4338ca)" : "transparent",
              color: period === "monthly" ? "#ffffff" : "#64748b",
              boxShadow: period === "monthly" ? "0 2px 8px rgba(79, 70, 229, 0.25)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <Calendar size={13} />
            <span>Monthly</span>
          </button>
          <button
            type="button"
            onClick={() => setPeriod("weekly")}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: period === "weekly" ? "linear-gradient(135deg, #0ea5e9, #0284c7)" : "transparent",
              color: period === "weekly" ? "#ffffff" : "#64748b",
              boxShadow: period === "weekly" ? "0 2px 8px rgba(14, 165, 233, 0.25)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <TrendingUp size={13} />
            <span>Weekly</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "0.85rem 1.25rem",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1.5px solid #ef4444",
            borderRadius: "10px",
            color: "#dc2626",
            marginBottom: "1.5rem",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* =========================================================================
          THE THREE CATEGORIES: DIAMOND · GOLD · SILVER
          ========================================================================= */}
      <div className="engagement-tier-grid">
        {/* 1. DIAMOND TIER */}
        <motion.div
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          className={`engagement-tier-card diamond ${selectedTier === "diamond" ? "active" : ""}`}
          onClick={() => setSelectedTier(selectedTier === "diamond" ? "all" : "diamond")}
          title="Filter to Diamond Users"
          style={{ padding: "1.15rem 1.25rem" }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="engagement-tier-badge diamond">
                <Crown size={12} />
                <span>Diamond Tier</span>
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#4f46e5" }}>
                {counts?.diamond_pct || 0}% of users
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px" }}>
              <span style={{ fontSize: "2.1rem", fontWeight: 800, color: "#312e81", lineHeight: 1 }}>
                {counts?.diamond || 0}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#6366f1" }}>Customers</span>
            </div>

            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b", fontWeight: 550 }}>
              {period === "monthly" ? "30+ Tasks / Month" : "5+ Tasks / Week"}
            </p>
          </div>
        </motion.div>

        {/* 2. GOLD TIER */}
        <motion.div
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          className={`engagement-tier-card gold ${selectedTier === "gold" ? "active" : ""}`}
          onClick={() => setSelectedTier(selectedTier === "gold" ? "all" : "gold")}
          title="Filter to Gold Users"
          style={{ padding: "1.15rem 1.25rem" }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="engagement-tier-badge gold">
                <Star size={12} />
                <span>Gold Tier</span>
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#b45309" }}>
                {counts?.gold_pct || 0}% of users
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px" }}>
              <span style={{ fontSize: "2.1rem", fontWeight: 800, color: "#78350f", lineHeight: 1 }}>
                {counts?.gold || 0}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#d97706" }}>Customers</span>
            </div>

            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b", fontWeight: 550 }}>
              {period === "monthly" ? "10–30 Tasks / Month" : "3–5 Tasks / Week"}
            </p>
          </div>
        </motion.div>

        {/* 3. SILVER TIER */}
        <motion.div
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          className={`engagement-tier-card silver ${selectedTier === "silver" ? "active" : ""}`}
          onClick={() => setSelectedTier(selectedTier === "silver" ? "all" : "silver")}
          title="Filter to Silver Users"
          style={{ padding: "1.15rem 1.25rem" }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span className="engagement-tier-badge silver">
                <Users size={12} />
                <span>Silver Tier</span>
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>
                {counts?.silver_pct || 0}% of users
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px" }}>
              <span style={{ fontSize: "2.1rem", fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>
                {counts?.silver || 0}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#64748b" }}>Customers</span>
            </div>

            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b", fontWeight: 550 }}>
              {period === "monthly" ? "<10 Tasks / Month" : "<3 Tasks / Week"}
            </p>
          </div>
        </motion.div>
      </div>

      {/* =========================================================================
          MONITORED USER DIRECTORY TABLE
          ========================================================================= */}
      <div className="engagement-users-panel">
        {/* Header & Full-Width Search */}
        <div className="engagement-users-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 750, color: "var(--text)", whiteSpace: "nowrap" }}>
              User Directory ({filteredUsers.length})
            </h3>
            {selectedTier !== "all" && (
              <button
                type="button"
                onClick={() => setSelectedTier("all")}
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontSize: "11px",
                  fontWeight: 650,
                  background: "var(--raised, #f1f5f9)",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
                title="Clear tier filter"
              >
                <span>Filter: {selectedTier.toUpperCase()}</span>
                <span>✕</span>
              </button>
            )}
          </div>

          {/* Search Input extended all the way to the end */}
          <div className="engagement-search-wrap">
            <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              type="text"
              className="engagement-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search user by name, phone, city, or service..."
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "13px" }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
            Loading user list and tier volumes...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", border: "1.5px dashed var(--border)", borderRadius: "12px", background: "#f8fafc" }}>
            <Users size={32} style={{ color: "var(--muted)", margin: "0 auto 8px", opacity: 0.5 }} />
            <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text)" }}>No customers found</div>
            <div className="text-xs muted" style={{ marginTop: "4px" }}>
              {searchQuery ? `No users matching "${searchQuery}".` : `No users in tier "${selectedTier}".`}
            </div>
          </div>
        ) : (
          <div className="engagement-table-wrap">
            <table className="engagement-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Monthly Tasks</th>
                  <th>Weekly Tasks</th>
                  <th>Category</th>
                  <th>Last Active</th>
                  <th style={{ textAlign: "right" }}>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, idx) => {
                  const cleanName = u.name.replace(/\s*\(.*?\)/g, "").trim();
                  const cleanPhone = u.phone.replace(/[^0-9]/g, "");
                  const tierGreet =
                    u.monthly_tier === "diamond"
                      ? `Hello ${cleanName}! As a Diamond VIP ExtraHand customer (${u.monthly_tasks} tasks), your priority helper dispatch and benefits are active.`
                      : u.monthly_tier === "gold"
                      ? `Hello ${cleanName}! Thank you for being a Gold ExtraHand member (${u.monthly_tasks} tasks). Here is your loyalty reward for your next task.`
                      : `Hello ${cleanName}! Book your next home task on ExtraHand to unlock Gold Tier benefits.`;

                  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(tierGreet)}`;

                  return (
                    <tr key={u.customer_id || idx}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            className="engagement-user-avatar"
                            style={{ background: AVATAR_BG[idx % AVATAR_BG.length] }}
                          >
                            {getInitials(cleanName)}
                          </div>
                          <div>
                            <div className="engagement-user-name">
                              <span>{cleanName}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "1px" }}>
                              <a href={`tel:${u.phone}`} className="engagement-phone-link">
                                <Phone size={9} />
                                <span>{u.phone}</span>
                              </a>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11.5px", color: "#475569", fontWeight: 600 }}>
                          <MapPin size={10} style={{ color: "#10b981" }} />
                          <span>{u.city}</span>
                        </span>
                      </td>

                      <td>
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 750, color: "var(--text)" }}>
                            {u.monthly_tasks}
                          </span>
                          <div style={{ fontSize: "10.5px", color: "var(--muted)", marginTop: "1px" }}>
                            {u.total_tasks} all-time
                          </div>
                        </div>
                      </td>

                      <td>
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 750, color: "var(--text)" }}>
                            {u.weekly_tasks}
                          </span>
                          <div style={{ fontSize: "10.5px", color: "var(--muted)", marginTop: "1px" }}>
                            past 7 days
                          </div>
                        </div>
                      </td>

                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 7px",
                            borderRadius: "5px",
                            fontSize: "10.5px",
                            fontWeight: 650,
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            color: "#047857",
                          }}
                        >
                          {u.top_category}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: "11.5px", color: "var(--text-2)", fontWeight: 500 }}>
                          {u.last_active || "Recent"}
                        </span>
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="engagement-wa-btn"
                          title="Open WhatsApp chat with this customer"
                        >
                          <WhatsAppIcon size={12} />
                          <span>Chat</span>
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
