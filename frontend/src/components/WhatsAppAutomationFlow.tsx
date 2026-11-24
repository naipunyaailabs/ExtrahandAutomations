import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  Ticket,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useCachedState } from "../hooks";
import { AnimatedNumber } from "./motion";
import { ChannelActiveButton } from "./WhatsAppChannelToggle";
import type { Helper, Ticket as TicketType, WhatsAppFlow, WhatsAppStatus } from "../types";

export interface WhatsAppAutomationFlowProps {
  tickets?: TicketType[];
  helpers?: Helper[];
  status?: WhatsAppStatus | null;
  automationActive?: boolean;
  onToggleAutomation?: () => void;
  isTogglingChannel?: string | null;
  onSelectFilter?: (filter: "all" | "today" | "eligible" | "sent" | "inprogress" | "failed") => void;
  onRefresh?: () => void;
  compact?: boolean;
}

/**
 * Animated WhatsApp Automation Flow Diagram
 * 
 * Flow Structure (as specified by user diagram):
 * [Today count / Tasks count] ➔ [Based on location and service] ➔ [Sended] ➔ [In progress]
 *                                                                                ↓
 *                                                                    [Sended today / Total send]
 */
export function WhatsAppAutomationFlow({
  tickets,
  status,
  automationActive = true,
  onToggleAutomation,
  isTogglingChannel,
  onSelectFilter,
}: WhatsAppAutomationFlowProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Today's real numbers from the backend (real-customer orders live from ExtraHand + the WhatsApp dispatch log)
  const [flow, setFlow] = useCachedState<WhatsAppFlow>("whatsapp-flow");
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.whatsapp
        .flow()
        .then((f) => !stop && setFlow(f))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [tickets, status]);

  const metrics = useMemo(() => {
    const n = (v?: number) => (v ?? 0).toLocaleString("en-IN");
    return {
      tasksTodayCount: flow?.tasks_today ?? 0,
      totalVolume: n(flow?.total_orders),
      eligibleCount: flow?.eligible_helpers ?? 0,
      openToday: flow?.open_today ?? 0,
      helperPool: n(flow?.helper_pool),
      messagesTodayCount: flow?.sent_today ?? 0,
      totalSentCount: flow?.sent_total ?? 0,
      simulatedTotal: n(flow?.simulated_total),
      deliveryRate: "Not tracked yet",
      inProgressCount: flow?.in_progress_today ?? 0,
      failedCount: flow?.failed_today ?? 0,
      failedTotal: n(flow?.failed_total),
      sourceLabel: !flow ? "Loading…" : flow.source === "live" ? "Live ExtraHand · real customers" : "Local copy (ExtraHand offline)",
    };
  }, [flow]);

  const handleNodeClick = (nodeKey: string, filterType: "all" | "today" | "eligible" | "sent" | "inprogress" | "failed") => {
    setSelectedNode(nodeKey);
    onSelectFilter?.(filterType);
  };

  return (
    <div className="whatsapp-automation-flow-container">
      {/* 1. Header with Status Telemetry */}
      <div className="flow-header" style={{ paddingBottom: "0.6rem", borderBottom: "none" }}>
        <div className="flow-title-wrap">
          <div
            className="flow-title-icon-badge"
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
            }}
          >
            <Send size={18} style={{ transform: "rotate(-10deg)" }} />
          </div>
          <div>
            <h3 className="flow-heading">WhatsApp Dispatch Dashboard</h3>
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
              Automated geo-proximity &amp; skill matching WhatsApp delivery pipeline
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Individual Active / Deactivated Button for Dispatch Dashboard */}
          <ChannelActiveButton
            channelName="Automation"
            isActive={automationActive}
            onToggle={onToggleAutomation}
            isLoading={isTogglingChannel === "automation"}
          />

          <span className="pill tone-success" style={{ fontSize: "12px", padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span className="live-pulse-dot" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <span>Meta Cloud API</span>
          </span>
        </div>
      </div>

      {/* Warning banner when WhatsApp Automation is Inactive */}
      {!automationActive && (
        <div
          style={{
            marginBottom: "0.85rem",
            padding: "9px 14px",
            borderRadius: "10px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1.5px solid rgba(239, 68, 68, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            color: "#991b1b",
            fontSize: "12.5px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={16} style={{ color: "#ef4444", flexShrink: 0 }} />
            <span>
              <strong>WhatsApp Automation is INACTIVE:</strong> Automated task dispatches and candidate broadcasts are paused and cannot send messages. Bulk Messaging can still send if Active.
              <strong>WhatsApp Automation is DEACTIVATED:</strong> Automated task dispatches and candidate broadcasts are paused and cannot send messages. Click the red <strong>Deactivated</strong> button at top right to activate.
            </span>
          </div>
          {onToggleAutomation && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onToggleAutomation}
              style={{
                fontSize: "11.5px",
                padding: "3px 10px",
                background: "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Turn On Automation
            </button>
          )}
        </div>
      )}

      {/* 2. ANIMATED FLOW DIAGRAM CANVAS */}
      <div className="flow-diagram-wrapper">
        <div className="flow-diagram-canvas" style={{ width: "1100px", height: "410px" }}>
          {/* Background SVG Connectors & Traveling Pulse Particles */}
          <svg
            className="flow-connectors-svg"
            viewBox="0 0 1100 410"
            fill="none"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="waGradBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
              <linearGradient id="waGradTeal" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0ea5e9" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id="waGradGreen" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
              <linearGradient id="waGradDown" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id="waGradRose" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#dc2626" />
              </linearGradient>

              {/* Arrow Markers */}
              <marker id="arr-wa-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#0ea5e9" />
              </marker>
              <marker id="arr-wa-teal" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
              </marker>
              <marker id="arr-wa-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#22c55e" />
              </marker>
              <marker id="arr-wa-down" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
              </marker>
              <marker id="arr-wa-rose" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#ef4444" />
              </marker>

              <filter id="waGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* PATH 1: Node 1 (Tasks Intake) -> Node 2 (Location & Skill Match) */}
            <path d="M 235 135 L 295 135" className="flow-track-base" />
            <path d="M 235 135 L 295 135" className="flow-track-active line-blue anim-flow" markerEnd="url(#arr-wa-blue)" />

            {/* PATH 2: Node 2 (Location & Skill Match) -> Node 3 (WhatsApp Outreach) */}
            <path d="M 525 135 L 585 135" className="flow-track-base" />
            <path d="M 525 135 L 585 135" className="flow-track-active line-teal anim-flow" markerEnd="url(#arr-wa-teal)" />

            {/* PATH 3: Node 3 (WhatsApp Outreach) -> Node 4 (In Progress) */}
            <path d="M 800 135 L 860 135" className="flow-track-base" />
            <path d="M 800 135 L 860 135" className="flow-track-active line-green anim-flow" markerEnd="url(#arr-wa-green)" />

            {/* PATH 4: Node 4 (In Progress) -> Step Down to Node 5 (KPI Sent Metrics) */}
            <path d="M 972.5 205 L 972.5 255" className="flow-track-base" />
            <path d="M 972.5 205 L 972.5 255" className="flow-track-active line-emerald anim-flow" markerEnd="url(#arr-wa-down)" />

            {/* PATH 5: Node 3 (WhatsApp Outreach) -> Step Down to Failed / Unable to Send */}
            <path d="M 692.5 205 L 692.5 255" className="flow-track-base" />
            <path d="M 692.5 205 L 692.5 255" className="flow-track-active line-rose anim-flow" markerEnd="url(#arr-wa-rose)" />

            {/* Traveling Glowing Light Particles - Multi-Wave Stream */}
            {/* Track 1 Particles */}
            <circle r="4" fill="#0ea5e9" filter="url(#waGlow)">
              <animateMotion path="M 235 135 L 295 135" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#38bdf8" opacity="0.85">
              <animateMotion path="M 235 135 L 295 135" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </circle>

            {/* Track 2 Particles */}
            <circle r="4" fill="#10b981" filter="url(#waGlow)">
              <animateMotion path="M 525 135 L 585 135" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#34d399" opacity="0.85">
              <animateMotion path="M 525 135 L 585 135" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
            </circle>

            {/* Track 3 Particles */}
            <circle r="4" fill="#22c55e" filter="url(#waGlow)">
              <animateMotion path="M 800 135 L 860 135" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#4ade80" opacity="0.85">
              <animateMotion path="M 800 135 L 860 135" dur="1.2s" begin="1.2s" repeatCount="indefinite" />
            </circle>

            {/* Track 4 Particles (Step-down to Sent KPI) */}
            <circle r="4" fill="#10b981" filter="url(#waGlow)">
              <animateMotion path="M 972.5 205 L 972.5 255" dur="1.0s" begin="0.2s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#34d399" opacity="0.85">
              <animateMotion path="M 972.5 205 L 972.5 255" dur="1.0s" begin="0.7s" repeatCount="indefinite" />
            </circle>

            {/* Track 5 Particles (Step-down to Failed / Unable to Send) */}
            <circle r="4" fill="#ef4444" filter="url(#waGlow)">
              <animateMotion path="M 692.5 205 L 692.5 255" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
            </circle>
            <circle r="2.5" fill="#f87171" opacity="0.85">
              <animateMotion path="M 692.5 205 L 692.5 255" dur="1.2s" begin="1.0s" repeatCount="indefinite" />
            </circle>
          </svg>

          {/* HTML Interactive Node Cards (Fixed Spelling & Elevated Layout) */}
          <div className="flow-nodes-layer">
            {/* STEP 1: TODAY'S TASKS & INTAKE */}
            <motion.div
              className={`flow-node-card node-tasks ${selectedNode === "tasks" ? "selected" : ""}`}
              style={{ left: "20px", top: "65px", width: "215px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("tasks", "today")}
              title="Click to view today's tasks"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-blue">
                  <Ticket size={15} />
                </div>
                <span className="node-badge-tag blue">TASK INGEST</span>
              </div>
              <div className="node-num-val">
                <AnimatedNumber value={metrics.tasksTodayCount} />
              </div>
              <div className="node-name-primary">Today's Tasks &amp; Intake</div>
              <div className="node-desc-sub">
                All time: <b>{metrics.totalVolume}</b> customer orders
              </div>
              <div className="node-footer-hint">{metrics.sourceLabel}</div>
            </motion.div>

            {/* STEP 2: LOCATION & SKILL MATCH */}
            <motion.div
              className={`flow-node-card node-geo-filter ${selectedNode === "geo" ? "selected" : ""}`}
              style={{ left: "295px", top: "65px", width: "230px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("geo", "eligible")}
              title="Click to view location and skill matched helpers"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-teal">
                  <MapPin size={15} />
                </div>
                <span className="node-badge-tag teal">GEO &amp; SKILL MATCH</span>
              </div>
              <div className="node-num-val teal">
                <AnimatedNumber value={metrics.eligibleCount} />
              </div>
              <div className="node-name-primary">Location &amp; Skill Match</div>
              <div className="node-desc-sub">
                For <b>{metrics.openToday}</b> open order{metrics.openToday === 1 ? "" : "s"} · {metrics.helperPool} helpers available
              </div>
              <div className="node-footer-hint teal">Approved helpers matching the service</div>
            </motion.div>

            {/* STEP 3: SENT ALERTS (WHATSAPP BROADCAST OUTREACH) */}
            <motion.div
              className={`flow-node-card node-sent ${selectedNode === "sended" ? "selected" : ""}`}
              style={{
                left: "585px",
                top: "65px",
                width: "215px",
                border: automationActive ? undefined : "1.5px dashed rgba(239, 68, 68, 0.5)",
                opacity: automationActive ? 1 : 0.88,
              }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("sended", "sent")}
              title={
                automationActive
                  ? "Click to view sent WhatsApp alert broadcasts"
                  : "Automation is Inactive - dispatches paused"
              }
            >
              <div className="flow-node-head">
                <div
                  className={`node-icon-pill ${automationActive ? "icon-green" : "icon-amber"}`}
                  style={!automationActive ? { background: "rgba(239, 68, 68, 0.12)", color: "#ef4444" } : undefined}
                >
                  <Send size={15} />
                </div>
                <span
                  className={`node-badge-tag ${automationActive ? "green" : "amber"}`}
                  style={
                    !automationActive
                      ? { background: "rgba(239, 68, 68, 0.15)", color: "#dc2626", borderColor: "rgba(239, 68, 68, 0.3)" }
                      : undefined
                  }
                >
                  {automationActive ? "WHATSAPP OUTREACH" : "OUTREACH PAUSED"}
                </span>
              </div>
              <div className={`node-num-val ${automationActive ? "green" : "amber"}`} style={!automationActive ? { color: "#dc2626" } : undefined}>
                <AnimatedNumber value={metrics.messagesTodayCount} />
              </div>
              <div className="node-name-primary">
                {automationActive ? "Sent Today (WhatsApp)" : "Alerts (Automation Paused)"}
              </div>
              <div className="node-desc-sub">
                {automationActive ? "1-Click Task Acceptance Alert" : "🚫 Inactive — Cannot dispatch"}
              </div>
              <div className={`node-footer-hint ${automationActive ? "green" : "amber"}`} style={!automationActive ? { color: "#dc2626" } : undefined}>
                {automationActive ? "Delivered through Meta (not simulated)" : "Messaging Inactive"}
              </div>
            </motion.div>

            {/* STEP 4: IN PROGRESS & AWAITING */}
            <motion.div
              className={`flow-node-card node-inprogress ${selectedNode === "inprogress" ? "selected" : ""}`}
              style={{ left: "860px", top: "65px", width: "225px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("inprogress", "inprogress")}
              title="Click to view tasks currently in progress"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-amber">
                  <Clock size={15} />
                </div>
                <span className="node-badge-tag amber">DELIVERY ACTIVE</span>
              </div>
              <div className="node-num-val amber">
                <AnimatedNumber value={metrics.inProgressCount} />
              </div>
              <div className="node-name-primary">In Progress Today</div>
              <div className="node-desc-sub">
                Today's orders with a helper assigned
              </div>
              <div className="node-footer-hint amber">Live ExtraHand status</div>
            </motion.div>

            {/* STEP 5: SENT TODAY / TOTAL SENT (DELIVERY KPI METRICS) */}
            <motion.div
              className={`flow-node-card node-metrics-kpi ${selectedNode === "metrics" ? "selected" : ""}`}
              style={{ left: "840px", top: "255px", width: "265px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("metrics", "sent")}
              title="Click to view complete delivery success telemetry"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-emerald">
                  <CheckCircle2 size={15} />
                </div>
                <span className="node-badge-tag emerald">KPI METRICS</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "2px" }}>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#10b981", lineHeight: 1 }}>
                  <AnimatedNumber value={metrics.messagesTodayCount} />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginLeft: "4px" }}>Today</span>
                </div>
                <span style={{ color: "#cbd5e1" }}>/</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={metrics.totalSentCount} />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginLeft: "4px" }}>Total</span>
                </div>
              </div>

              <div className="node-name-primary" style={{ marginTop: "6px" }}>
                Sent Today / Total Sent
              </div>
              <div className="node-desc-sub">
                Real sends · {metrics.simulatedTotal} more were only simulated
              </div>
              <div className="node-footer-hint green">Delivery receipts: {metrics.deliveryRate}</div>
            </motion.div>

            {/* STEP 6: FAILED / UNABLE TO SEND (BOUNCE / ERROR RETRY) */}
            <motion.div
              className={`flow-node-card node-failed ${selectedNode === "failed" ? "selected" : ""}`}
              style={{ left: "565px", top: "255px", width: "255px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("failed", "failed")}
              title="Click to view tasks unable to be sent or failed delivery"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-rose">
                  <AlertCircle size={15} />
                </div>
                <span className="node-badge-tag rose">UNABLE TO SEND</span>
              </div>
              <div className="node-num-val rose">
                <AnimatedNumber value={metrics.failedCount} />
              </div>
              <div className="node-name-primary" style={{ color: "#b91c1c" }}>Failed to Send Today</div>
              <div className="node-desc-sub">
                {metrics.failedTotal} failed in total · invalid phone, opt-out, error
              </div>
              <div className="node-footer-hint rose">Auto-Escalate to Voice Calling</div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* 3. BOTTOM METRIC STRIP (Corrected spelling & failure tracking) */}
      <div className="flow-metrics-summary-bar">
        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("tasks", "today")}
        >
          <span className="metric-dot blue" />
          <span className="metric-label">Today's Tasks:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.tasksTodayCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("geo", "eligible")}
        >
          <span className="metric-dot teal" />
          <span className="metric-label">Eligible Helpers:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.eligibleCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("sended", "sent")}
        >
          <span className="metric-dot green" />
          <span className="metric-label">WhatsApp Sent:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.messagesTodayCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("inprogress", "inprogress")}
        >
          <span className="metric-dot amber" />
          <span className="metric-label">In Progress:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.inProgressCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("failed", "failed")}
          style={{ borderColor: "rgba(239, 68, 68, 0.35)", background: "rgba(254, 242, 242, 0.5)" }}
        >
          <span className="metric-dot red" style={{ background: "#ef4444", boxShadow: "0 0 6px #ef4444" }} />
          <span className="metric-label" style={{ color: "#b91c1c" }}>Failed / Unable:</span>
          <span className="metric-val" style={{ color: "#ef4444", fontWeight: 750 }}>
            <AnimatedNumber value={metrics.failedCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("metrics", "sent")}
        >
          <span className="metric-dot emerald" />
          <span className="metric-label">Total Sent:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.totalSentCount} />
          </span>
        </div>

        <div className="flow-metric-pill">
          <span className="metric-dot green" />
          <span className="metric-label">Delivery Rate:</span>
          <span className="metric-val">{metrics.deliveryRate}</span>
        </div>
      </div>
    </div>
  );
}
