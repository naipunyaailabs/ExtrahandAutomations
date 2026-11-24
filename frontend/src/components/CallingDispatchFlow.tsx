import { motion } from "framer-motion";
import {
  AlertCircle,
  Clock,
  LifeBuoy,
  PhoneCall,
  PhoneForwarded,
  Radio,
  ShieldCheck,
  Ticket,
  UserCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./motion";
import type { Call, CallingFlow, Escalation, Stats, Ticket as TicketType } from "../types";
import { api } from "../api";
import { useCachedState, usePoll } from "../hooks";
import { CallTimingBanner } from "./CallTimingBanner";

export interface CallingDispatchFlowProps {
  tickets?: TicketType[];
  calls?: Call[];
  stats?: Stats;
  escalations?: Escalation[];
  onSelectFilter?: (
    type: "all" | "assigned" | "unassigned" | "calls" | "accepted" | "care" | "direct_followup" | "calling_followup"
  ) => void;
  onRefresh?: () => void;
  compact?: boolean;
}

/** "+3  −1 cancelled  = 2 active": everything that came in, what was cancelled after, and what is left.
 * The minus part only shows when something was cancelled. */
function PlusMinus({ added, cancelled, what }: { added: number; cancelled: number; what: string }) {
  const left = Math.max(added - cancelled, 0);
  if (!added) return null; // nothing yet today: no "+0" line
  return (
    <div
      className="node-plus-minus"
      title={`${added} ${what}${cancelled ? `, ${cancelled} of them cancelled later, ${left} still active` : ""}`}
    >
      <span className="pm-plus">+{added}</span>
      {cancelled > 0 && (
        <>
          <span className="pm-minus">−{cancelled} cancelled</span>
          <span className="pm-net">= {left} active</span>
        </>
      )}
    </div>
  );
}

/**
 * Animated Calling Agent Dispatch Lifecycle Flow Diagram
 * 
 * CLEAN DUAL-STREAM 5-COLUMN GEOMETRY (ZERO OVERLAP):
 * Column 1 (x: 20):  Tasks (Today)
 * Column 2 (x: 235): Direct Assigned (Top) | Unassigned Tasks (Bottom)
 * Column 3 (x: 470): Direct Follow-up Calls (Top) | IVR Helper Calls (Bottom)
 * Column 4 (x: 750): Assigned OK (Mid) | Customer Care Escalation (Bottom)
 * Column 5 (x: 980): Calling Agent Follow-ups (Mid - Right of Assigned OK)
 */
export function CallingDispatchFlow({
  tickets,
  calls,
  stats,
  escalations,
  onSelectFilter,
}: CallingDispatchFlowProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Today's real numbers from the backend (real-customer orders live from ExtraHand + this app's calls,
  // follow-ups and escalations). Nothing is estimated: a 0 means nothing happened today.
  const [flow, setFlow] = useCachedState<CallingFlow>("calling-flow");
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.calling
        .flow()
        .then((f) => !stop && setFlow(f))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [tickets, calls, stats, escalations]);

  // "1 completed · 2 in progress" (only the parts that are not zero; cancelled is shown in the +/- line)
  const progressText = (p?: { completed: number; in_progress: number; cancelled: number }) => {
    if (!p) return "—";
    const parts = [
      p.completed ? `${p.completed} completed` : "",
      p.in_progress ? `${p.in_progress} in progress` : "",
    ].filter(Boolean);
    return parts.join(" · ") || (p.cancelled ? "all cancelled" : "No tasks yet today");
  };

  const metrics = useMemo(
    () => ({
      tasksTodayCount: flow?.tasks_today ?? 0,
      totalVolume: (flow?.total_orders ?? 0).toLocaleString("en-IN"),
      sourceLabel: !flow ? "Loading…" : flow.source === "live" ? "Live ExtraHand · real customers" : "Local copy (ExtraHand offline)",
      assignedCount: flow?.assigned_today ?? 0,
      unassignedCount: flow?.unassigned_today ?? 0,
      cancelledToday: flow?.cancelled_today ?? 0,
      todayProgress: progressText(flow?.today_progress),
      assignedProgress: progressText(flow?.assigned_progress),
      unassignedProgress: progressText(flow?.unassigned_progress),
      todayCancelled: flow?.today_progress?.cancelled ?? 0,
      assignedCancelled: flow?.assigned_progress?.cancelled ?? 0,
      unassignedCancelled: flow?.unassigned_progress?.cancelled ?? 0,
      unassignedWaiting: flow?.unassigned_progress?.in_progress ?? 0,
      totalCallsCount: flow?.dispatch_calls_today ?? 0,
      callsToday: flow?.calls_today ?? 0,
      simulatedCalls: flow?.simulated_calls_today ?? 0,
      activeCallsCount: flow?.active_calls ?? 0,
      assignedOkCount: flow?.accepted_today ?? 0,
      customerCareCount: flow?.open_escalations ?? 0,
      escalatedToday: flow?.escalated_today ?? 0,
      directFollowupsCount: flow?.followups_due_today ?? 0,
      followupsDone: flow?.followups_done_today ?? 0,
      callingFollowupsCount: flow?.followup_calls_today ?? 0,
    }),
    [flow]
  );

  // Calling hours (India time): the agent only places calls inside this window
  const { data: agentStatus } = usePoll(() => api.callingAgentStatus(), 30000);
  const hours = agentStatus?.calling_hours;

  const handleNodeClick = (nodeKey: string, filterType: any) => {
    setSelectedNode(nodeKey);
    onSelectFilter?.(filterType);
  };

  return (
    <div className="calling-dispatch-flow-container">
      {/* 1. Minimal Clean Header: Removed "Flow" and "Pipeline Active" as requested */}
      <div className="flow-header" style={{ paddingBottom: "0.4rem", borderBottom: "none" }}>
        <div className="flow-title-wrap">
          <div className="flow-title-icon-badge">
            <Radio size={18} />
          </div>
          <h3 className="flow-heading">Calling Agent Dispatch</h3>
        </div>
        {hours && (
          <div
            title={hours.open ? "The agent is placing calls now" : "No calls now: job offers, reminders and feedback calls wait until the window opens"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 12px",
              borderRadius: "999px",
              fontSize: "13px",
              fontWeight: 600,
              border: `1px solid ${hours.open ? "rgba(22, 163, 74, 0.35)" : "rgba(217, 119, 6, 0.4)"}`,
              background: hours.open ? "rgba(22, 163, 74, 0.08)" : "rgba(217, 119, 6, 0.08)",
              color: "var(--text, #0f172a)",
              whiteSpace: "nowrap",
            }}
          >
            <Clock size={15} style={{ color: hours.open ? "#16a34a" : "#d97706" }} />
            <span>Calling hours: {hours.label.replace(" IST", "")}</span>
            <span
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                padding: "1px 8px",
                borderRadius: "999px",
                background: hours.open ? "#16a34a" : "#d97706",
                color: "#fff",
              }}
            >
              {hours.open ? "Open now" : "Closed"}
            </span>
          </div>
        )}
      </div>

      <CallTimingBanner tickets={tickets} />

      {/* 2. Aligned SVG & Card Flow Diagram (5-Column Layout with ZERO Overlap) */}
      <div className="flow-diagram-wrapper">
        <div className="flow-diagram-canvas" style={{ width: "1200px", height: "420px" }}>
          {/* Background SVG Connectors & Traveling Pulse Particles */}
          <svg
            className="flow-connectors-svg"
            viewBox="0 0 1200 420"
            fill="none"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="flowGradBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <linearGradient id="flowGradGreen" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="flowGradAmber" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#ea580c" />
              </linearGradient>
              <linearGradient id="flowGradRose" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#dc2626" />
              </linearGradient>
              <linearGradient id="flowGradPurple" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>

              {/* Markers */}
              <marker id="arr-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#3b82f6" />
              </marker>
              <marker id="arr-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
              </marker>
              <marker id="arr-amber" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#ea580c" />
              </marker>
              <marker id="arr-rose" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#ef4444" />
              </marker>
              <marker id="arr-purple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#8b5cf6" />
              </marker>

              <filter id="flowGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* TOP STREAM (DIRECT ASSIGNED PIPELINE) */}
            {/* PATH 1: Tasks -> Direct Assigned */}
            <path d="M 185 175 C 208 175, 208 75, 230 75" className="flow-track-base" />
            <path d="M 185 175 C 208 175, 208 75, 230 75" className="flow-track-active line-blue anim-flow" markerEnd="url(#arr-blue)" />

            {/* PATH 2: Direct Assigned -> Direct Follow-up Calls */}
            <path d="M 410 75 L 465 75" className="flow-track-base" />
            <path d="M 410 75 L 465 75" className="flow-track-active line-green anim-flow" markerEnd="url(#arr-green)" />

            {/* BOTTOM STREAM (CALLING AGENT OUTREACH PIPELINE) */}
            {/* PATH 3: Tasks -> Unassigned Tasks */}
            <path d="M 185 220 C 208 220, 208 275, 230 275" className="flow-track-base" />
            <path d="M 185 220 C 208 220, 208 275, 230 275" className="flow-track-active line-amber anim-flow" markerEnd="url(#arr-amber)" />

            {/* PATH 4: Unassigned Tasks -> IVR Helper Calls */}
            <path d="M 410 275 L 465 275" className="flow-track-base" />
            <path d="M 410 275 L 465 275" className="flow-track-active line-amber anim-flow" markerEnd="url(#arr-amber)" />

            {/* PATH 5: IVR Helper Calls -> Assigned OK (Key 1 Accept) */}
            <path d="M 700 245 C 725 245, 725 200, 750 200" className="flow-track-base" />
            <path d="M 700 245 C 725 245, 725 200, 750 200" className="flow-track-active line-green anim-flow" markerEnd="url(#arr-green)" />

            {/* PATH 6: Assigned OK -> Calling Agent Follow-ups (Separate Column 5!) */}
            <path d="M 940 200 L 980 200" className="flow-track-base" />
            <path d="M 940 200 L 980 200" className="flow-track-active line-purple anim-flow" markerEnd="url(#arr-purple)" />

            {/* PATH 7: IVR Helper Calls -> Customer Care Escalation (Key 0 / Timeout) */}
            <path d="M 700 310 C 725 310, 725 340, 750 340" className="flow-track-base" />
            <path d="M 700 310 C 725 310, 725 340, 750 340" className="flow-track-active line-rose anim-flow" markerEnd="url(#arr-rose)" />

            {/* Traveling Pulse Particles */}
            <circle r="4" fill="#3b82f6" filter="url(#flowGlow)">
              <animateMotion path="M 185 175 C 208 175, 208 75, 230 75" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#10b981" filter="url(#flowGlow)">
              <animateMotion path="M 410 75 L 465 75" dur="1.3s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#ea580c" filter="url(#flowGlow)">
              <animateMotion path="M 185 220 C 208 220, 208 275, 230 275" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#ea580c" filter="url(#flowGlow)">
              <animateMotion path="M 410 275 L 465 275" dur="1.3s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#10b981" filter="url(#flowGlow)">
              <animateMotion path="M 700 245 C 725 245, 725 200, 750 200" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#8b5cf6" filter="url(#flowGlow)">
              <animateMotion path="M 940 200 L 980 200" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="#ef4444" filter="url(#flowGlow)">
              <animateMotion path="M 700 310 C 725 310, 725 340, 750 340" dur="2s" repeatCount="indefinite" />
            </circle>
          </svg>

          {/* HTML Interactive Node Cards Positioned on 5 Non-Overlapping Columns */}
          <div className="flow-nodes-layer">
            {/* COLUMN 1: INGEST */}
            {/* Node 1: Tasks (Today) */}
            <motion.div
              className={`flow-node-card node-tasks ${selectedNode === "tasks" ? "selected" : ""}`}
              style={{ left: "20px", top: "135px", width: "165px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("tasks", "all")}
              title="Click to view all tasks"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-blue">
                  <Ticket size={15} />
                </div>
                <span className="node-badge-tag blue">INGEST</span>
              </div>
              <div className="node-num-val">
                <AnimatedNumber value={metrics.tasksTodayCount} />
              </div>
              <div className="node-name-primary">Tasks (Today)</div>
              <PlusMinus added={metrics.tasksTodayCount} cancelled={metrics.todayCancelled} what="booked" />
              <div className="node-desc-sub" title={metrics.todayProgress}>
                {metrics.todayProgress}
              </div>
              <div className="node-footer-hint">{metrics.sourceLabel}</div>
            </motion.div>

            {/* COLUMN 2: TRIAGE */}
            {/* Node 2 (Top): Direct Assigned */}
            <motion.div
              className={`flow-node-card node-assigned ${selectedNode === "assigned" ? "selected" : ""}`}
              style={{ left: "230px", top: "25px", width: "180px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("assigned", "assigned")}
              title="Click to view directly assigned tasks"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-green">
                  <UserCheck size={15} />
                </div>
                <span className="node-badge-tag green">DIRECT ASSIGN</span>
              </div>
              <div className="node-num-val green">
                <AnimatedNumber value={metrics.assignedCount} />
              </div>
              <div className="node-name-primary">Helper Assigned</div>
              <PlusMinus added={metrics.assignedCount} cancelled={metrics.assignedCancelled} what="assigned" />
              <div className="node-desc-sub" title={metrics.assignedProgress}>{metrics.assignedProgress}</div>
              <div className="node-footer-hint direct">Direct ➔ Follow-up</div>
            </motion.div>

            {/* Node 3 (Bottom): Unassigned Tasks */}
            <motion.div
              className={`flow-node-card node-unassigned ${selectedNode === "unassigned" ? "selected" : ""}`}
              style={{ left: "230px", top: "225px", width: "180px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("unassigned", "unassigned")}
              title="Click to view unassigned tasks needing outreach"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-amber">
                  <AlertCircle size={15} />
                </div>
                <span className="node-badge-tag amber">UNASSIGNED</span>
              </div>
              <div className="node-num-val amber">
                <AnimatedNumber value={metrics.unassignedCount} />
              </div>
              <div className="node-name-primary">Not Assigned</div>
              <PlusMinus added={metrics.unassignedCount} cancelled={metrics.unassignedCancelled} what="not assigned" />
              <div className="node-desc-sub" title={metrics.unassignedProgress}>{metrics.unassignedProgress}</div>
              <div className="node-footer-hint amber">
                {metrics.unassignedWaiting
                  ? `${metrics.unassignedWaiting} waiting · Queue for Voice IVR`
                  : "Nothing waiting for Voice IVR"}
              </div>
            </motion.div>

            {/* COLUMN 3: DIRECT ACTION & OUTREACH */}
            {/* Node 4A (Top): Direct Follow-up Calls */}
            <motion.div
              className={`flow-node-card node-followup ${selectedNode === "direct_followup" ? "selected" : ""}`}
              style={{ left: "465px", top: "25px", width: "205px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("direct_followup", "direct_followup")}
              title="Click to view Direct Assignment follow-ups"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-green">
                  <Clock size={15} />
                </div>
                <span className="node-badge-tag green">DIRECT FOLLOW-UP</span>
              </div>
              <div className="node-num-val green">
                <AnimatedNumber value={metrics.directFollowupsCount} />
              </div>
              <div className="node-name-primary">Follow-ups Due Today</div>
              <div className="node-desc-sub">For today's tasks · {metrics.followupsDone} done</div>
              <div className="node-footer-hint direct">Partner Arrival Verification</div>
            </motion.div>

            {/* Node 4B (Bottom): Location & Service Voice Calls */}
            <motion.div
              className={`flow-node-card node-ivr-action ${selectedNode === "ivr" ? "selected" : ""}`}
              style={{ left: "465px", top: "205px", width: "235px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("ivr", "calls")}
              title="Click to view helper outreach calls log"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-orange">
                  <PhoneCall size={15} className={metrics.activeCallsCount > 0 ? "phone-shake" : ""} />
                </div>
                <div className="ivr-call-status">
                  {metrics.activeCallsCount > 0 ? (
                    <span className="ivr-live-tag">
                      <span className="live-dot" /> {metrics.activeCallsCount} Ringing
                    </span>
                  ) : (
                    <span className="ivr-ready-tag">IVR Standby</span>
                  )}
                </div>
              </div>

              <div className="node-num-val orange">
                <AnimatedNumber value={metrics.totalCallsCount} />
                <span className="sub-num-unit">Calls</span>
              </div>

              <div className="node-name-primary">Helper Dispatch Calls Today</div>
              <div className="ivr-script-box">
                <p className="ivr-script-text">
                  Voice IVR prompt played to helpers:
                </p>
                <div className="ivr-dtmf-guide">
                  <span className="dtmf-pill dtmf-1">
                    <b>1</b> Accept
                  </span>
                  <span className="dtmf-pill dtmf-0">
                    <b>0</b> Cancel
                  </span>
                  <span className="dtmf-pill dtmf-star">
                    <b>*</b> Repeat
                  </span>
                </div>
              </div>
            </motion.div>

            {/* COLUMN 4: ACCEPTED & ESCALATED (COMPLETELY SEPARATED VERTICALLY) */}
            {/* Node 5 (Mid): Assigned OK (Calling Agent) */}
            <motion.div
              className={`flow-node-card node-assigned-ok ${selectedNode === "accepted" ? "selected" : ""}`}
              style={{ left: "750px", top: "150px", width: "190px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("accepted", "accepted")}
              title="Click to view calls accepted by helpers"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-emerald">
                  <ShieldCheck size={15} />
                </div>
                <span className="node-badge-tag emerald">KEY 1 ACCEPT</span>
              </div>
              <div className="node-num-val emerald">
                <AnimatedNumber value={metrics.assignedOkCount} />
              </div>
              <div className="node-name-primary">Accepted on Call Today</div>
              <div className="node-desc-sub">Helper pressed 1 to accept</div>
              <div className="node-footer-hint emerald">Auto-Allocated ➔ Follow-up</div>
            </motion.div>

            {/* Node 6 (Bottom): Not Assigned ➔ Customer Care (40px BELOW Assigned OK - NO OVERLAP!) */}
            <motion.div
              className={`flow-node-card node-escalation ${selectedNode === "care" ? "selected" : ""}`}
              style={{ left: "750px", top: "290px", width: "190px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("care", "care")}
              title="Click to open Customer Care escalations"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-rose">
                  <LifeBuoy size={15} />
                </div>
                <span className="node-badge-tag rose">ESCALATED</span>
              </div>
              <div className="node-num-val rose">
                <AnimatedNumber value={metrics.customerCareCount} />
              </div>
              <div className="node-name-primary">Customer Care (Open)</div>
              <div className="node-desc-sub">Open escalations · {metrics.escalatedToday} new today</div>
              <div className="node-footer-hint rose">Manual Helper Redispatch</div>
            </motion.div>

            {/* COLUMN 5: CALLING AGENT FOLLOW-UPS (SEPARATE COLUMN - NO OVERLAP WITH ASSIGNED OK!) */}
            {/* Node 7B: Calling Agent Assigned Follow-up Calls */}
            <motion.div
              className={`flow-node-card node-followup ${selectedNode === "calling_followup" ? "selected" : ""}`}
              style={{ left: "980px", top: "150px", width: "200px" }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => handleNodeClick("calling_followup", "calling_followup")}
              title="Click to view Calling Agent assigned follow-ups"
            >
              <div className="flow-node-head">
                <div className="node-icon-pill icon-purple">
                  <PhoneForwarded size={15} />
                </div>
                <span className="node-badge-tag purple">CALL DISPATCHED</span>
              </div>
              <div className="node-num-val purple">
                <AnimatedNumber value={metrics.callingFollowupsCount} />
              </div>
              <div className="node-name-primary">Follow-up Calls Today</div>
              <div className="node-desc-sub">Calls made to helpers today</div>
              <div className="node-footer-hint purple">Automated Job Check Call</div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* 3. BELOW: Real-time Metric Strip with Separated Follow-ups */}
      <div className="flow-metrics-summary-bar">
        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("tasks", "all")}
          title="Click to filter all tasks"
        >
          <span className="metric-dot blue" />
          <span className="metric-label">Today's Tasks:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.tasksTodayCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("assigned", "assigned")}
          title="Click to filter direct assigned"
        >
          <span className="metric-dot green" />
          <span className="metric-label">Assigned:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.assignedCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("direct_followup", "direct_followup")}
          title="Click to filter direct follow-up reminders"
        >
          <span className="metric-dot green" />
          <span className="metric-label">Direct Follow-ups:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.directFollowupsCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("unassigned", "unassigned")}
          title="Click to filter unassigned tasks"
        >
          <span className="metric-dot amber" />
          <span className="metric-label">Not Assigned:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.unassignedCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("ivr", "calls")}
          title="Click to view outreach calls"
        >
          <span className="metric-dot orange" />
          <span className="metric-label">Calls Triggered:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.totalCallsCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("accepted", "accepted")}
          title="Click to view voice accepted dispatches"
        >
          <span className="metric-dot emerald" />
          <span className="metric-label">Assigned via Call:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.assignedOkCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("calling_followup", "calling_followup")}
          title="Click to filter calling agent follow-ups"
        >
          <span className="metric-dot purple" />
          <span className="metric-label">Calling Follow-ups:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.callingFollowupsCount} />
          </span>
        </div>

        <div
          className="flow-metric-pill clickable"
          onClick={() => handleNodeClick("care", "care")}
          title="Click to view Customer Care escalations"
        >
          <span className="metric-dot rose" />
          <span className="metric-label">Failed ➔ Care:</span>
          <span className="metric-val">
            <AnimatedNumber value={metrics.customerCareCount} />
          </span>
        </div>
      </div>
    </div>
  );
}
