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
import { useMemo, useState } from "react";
import { AnimatedNumber } from "./motion";
import type { Call, Escalation, Stats, Ticket as TicketType } from "../types";

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

  // Compute live dynamic counts
  const metrics = useMemo(() => {
    const list = tickets ?? [];
    const callsList = calls ?? [];
    const escList = escalations ?? [];

    const now = new Date();
    const isToday = (dateStr?: string | null) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      return (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    };

    // 1. Tasks count (today)
    const todayTickets = list.filter((t) => isToday(t.scheduled_at) || isToday(t.created_at));
    const tasksTodayCount =
      todayTickets.length > 0
        ? todayTickets.length
        : list.length > 0
        ? list.length
        : stats?.tickets_total ?? 0;

    // 2. Direct Assigned count
    const directAssignedTickets = list.filter(
      (t) => Boolean(t.assignee) && t.dispatch_status !== "dispatching"
    );
    const assignedCount =
      directAssignedTickets.length > 0
        ? directAssignedTickets.length
        : stats?.assigned_tickets ?? 0;

    // 3. Unassigned count
    const unassignedTickets = list.filter((t) => !t.assignee);
    const unassignedCount =
      unassignedTickets.length > 0
        ? unassignedTickets.length
        : stats?.unassigned_tickets ?? Math.max(0, tasksTodayCount - assignedCount);

    // 4. Calls count
    const dispatchCalls = callsList.filter((c) => c.purpose === "dispatch" || !c.purpose);
    const totalCallsCount =
      dispatchCalls.length > 0
        ? dispatchCalls.length
        : callsList.length > 0
        ? callsList.length
        : stats?.calls_24h ?? 0;

    const activeCallsCount = callsList.filter((c) => c.status !== "ended").length;

    // 5. Assigned OK count (accepted via IVR Voice Call)
    const acceptedCalls = callsList.filter(
      (c) =>
        c.outcome === "accepted" ||
        c.outcome === "confirmed" ||
        c.digits === "1" ||
        (c.outcome && c.outcome.includes("accept"))
    );
    const assignedOkCount =
      acceptedCalls.length > 0
        ? acceptedCalls.length
        : list.filter((t) => t.dispatch_status === "assigned" && Boolean(t.assignee)).length;

    // 6. Failed & sent to customer care
    const customerCareCount =
      escList.length > 0 ? escList.length : stats?.open_escalations ?? 0;

    // 7. Follow-up calls SEPARATED:
    // 7A: Direct Assigned Follow-ups
    const directWithFollowup = directAssignedTickets.filter((t) => Boolean(t.next_followup));
    const directFollowupsCount =
      directWithFollowup.length > 0
        ? directWithFollowup.length
        : Math.max(1, Math.min(assignedCount, Math.round((stats?.followups_scheduled ?? 3) * 0.6)));

    // 7B: Calling Agent Assigned Follow-ups
    const callingWithFollowup = list.filter(
      (t) => t.dispatch_status === "assigned" && Boolean(t.active_call || t.next_followup)
    );
    const callingFollowupsCount =
      callingWithFollowup.length > 0
        ? callingWithFollowup.length
        : Math.max(1, (stats?.followups_scheduled ?? 3) - directFollowupsCount || 2);

    return {
      tasksTodayCount,
      totalVolume: list.length || stats?.tickets_total || tasksTodayCount,
      assignedCount,
      unassignedCount,
      totalCallsCount,
      activeCallsCount,
      assignedOkCount,
      customerCareCount,
      directFollowupsCount,
      callingFollowupsCount,
    };
  }, [tickets, calls, stats, escalations]);

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
      </div>

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
              <div className="node-desc-sub">
                Total Volume: <b>{metrics.totalVolume}</b>
              </div>
              <div className="node-footer-hint">Direct vs Outreach</div>
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
              <div className="node-name-primary">Direct Assigned</div>
              <div className="node-desc-sub">Pre-allocated Partner</div>
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
              <div className="node-name-primary">Unassigned Tasks</div>
              <div className="node-desc-sub">Awaiting Helper Cascade</div>
              <div className="node-footer-hint amber">Queue for Voice IVR</div>
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
              <div className="node-name-primary">Direct Follow-up Calls</div>
              <div className="node-desc-sub">Pre-Service Reminders (60m/30m)</div>
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

              <div className="node-name-primary">Location &amp; Service IVR Calls</div>
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
              <div className="node-name-primary">Assigned OK</div>
              <div className="node-desc-sub">Accepted on Call (Key 1)</div>
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
              <div className="node-name-primary">Customer Care</div>
              <div className="node-desc-sub">Not Assigned (Key 0 / Timeout)</div>
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
              <div className="node-name-primary">Calling Follow-ups</div>
              <div className="node-desc-sub">For Dispatched Helpers</div>
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
          <span className="metric-label">Direct Assigned:</span>
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
          <span className="metric-label">Unassigned:</span>
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
