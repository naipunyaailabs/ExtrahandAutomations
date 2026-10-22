import { motion } from "framer-motion";
import { Activity, BellRing, CheckCheck, CheckCircle2, Inbox, Layers, PhoneCall, Radio, Target, Ticket, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { LiveCalls } from "../components/LiveCalls";
import { AnimatedNumber, itemVariants, Stagger } from "../components/motion";
import { Pipeline } from "../components/Pipeline";
import { Card, Empty, SkeletonRows } from "../components/ui";
import { usePoll } from "../hooks";
import { fmtDateTime, fmtOffset, fmtRelative, fmtTime } from "../format";
import { Timeline } from "../components/Timeline";

export default function Dashboard() {
  const config = useConfig()!;
  const stats = usePoll(api.stats, 3000);
  const calls = usePoll(() => api.calls(true), 2000);
  const tickets = usePoll(() => api.tickets(), 5000);
  const events = usePoll(() => api.events(25), 3000);

  const s = stats.data;
  const by = s?.tickets_by_status ?? {};
  const refreshAll = () => { calls.refresh(); stats.refresh(); events.refresh(); tickets.refresh(); };

  const total = s?.tickets_total ?? 0;
  const unassignedCount = s?.unassigned_tickets ?? by.new ?? 0;
  const assignedCount = s?.assigned_tickets ?? by.assigned ?? 0;
  const completedCount = s?.completed_tickets ?? (tickets.data ?? []).filter((t) => t.status === "completed").length;
  const cancelledCount = s?.cancelled_tickets ?? (tickets.data ?? []).filter((t) => t.status === "cancelled").length;

  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "0%");

  const reminders = (tickets.data ?? [])
    .filter((t) => t.next_followup)
    .sort((a, b) => a.next_followup!.due_at.localeCompare(b.next_followup!.due_at))
    .slice(0, 6);

  const kpis = [
    { label: "Total tasks", icon: Ticket, value: s?.tickets_total },
    { label: "Unassigned", icon: Inbox, value: by.new },
    { label: "Assigned tasks", icon: CheckCircle2, value: s?.assigned_tickets ?? by.assigned },
    { label: "Calls in last 24h", icon: PhoneCall, value: s?.calls_24h },
    { label: "Acceptance rate", icon: Target, value: s?.acceptance_rate_24h == null ? null : Math.round(s.acceptance_rate_24h * 100), suffix: "%" },
    { label: "Calls live now", icon: Radio, value: s?.active_calls, live: (s?.active_calls ?? 0) > 0 },
  ];

  return (
    <Stagger className="page">
      <motion.div className="page-head" variants={itemVariants}>
        <h1>Overview</h1>
        <p className="muted">Bookings from ExtraHand, helper calls in progress and anything that needs a person.</p>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Pipeline
          totalTasks={s?.tickets_total}
          unassigned={unassignedCount}
          calling={by.dispatching}
          assigned={assignedCount}
          completed={completedCount}
          cancelled={cancelledCount}
          escalated={s?.open_escalations}
          reminders={s?.followups_scheduled}
          assignedHelpers={s?.assigned_helpers}
        />
      </motion.div>

      {/* Task Lifecycle Breakdown Section */}
      <motion.div variants={itemVariants} className="breakdown-card">
        <div className="breakdown-header">
          <div className="breakdown-title">
            <Layers size={16} style={{ color: "var(--brand)" }} />
            <span>Task Lifecycle Breakdown</span>
          </div>
          <span className="breakdown-subtitle">
            <b>{total}</b> total bookings synced from ExtraHand
          </span>
        </div>

        {/* Visual segmented distribution bar */}
        <div
          className="breakdown-bar"
          title={`Completed: ${completedCount} | Unassigned: ${unassignedCount} | Cancelled: ${cancelledCount} | Assigned: ${assignedCount}`}
        >
          <div
            className="breakdown-bar-segment"
            style={{ width: pct(completedCount), background: "var(--brand)" }}
            title={`Completed: ${completedCount} (${pct(completedCount)})`}
          />
          <div
            className="breakdown-bar-segment"
            style={{ width: pct(unassignedCount), background: "var(--info)" }}
            title={`Unassigned: ${unassignedCount} (${pct(unassignedCount)})`}
          />
          <div
            className="breakdown-bar-segment"
            style={{ width: pct(assignedCount), background: "var(--success)" }}
            title={`Assigned: ${assignedCount} (${pct(assignedCount)})`}
          />
          <div
            className="breakdown-bar-segment"
            style={{ width: pct(cancelledCount), background: "var(--neutral)" }}
            title={`Cancelled: ${cancelledCount} (${pct(cancelledCount)})`}
          />
        </div>

        {/* 4 Clickable Breakdown Cards */}
        <div className="breakdown-grid">
          {/* 1. Unassigned */}
          <Link
            to="/tickets?status=new"
            className="breakdown-item"
            style={{ "--item-color": "var(--info)" } as React.CSSProperties}
          >
            <div className="breakdown-item-icon">
              <Inbox size={18} />
            </div>
            <div className="breakdown-item-info">
              <div className="breakdown-item-top">
                <span className="breakdown-item-label">Unassigned</span>
                <span className="breakdown-item-num">
                  <AnimatedNumber value={unassignedCount} />
                </span>
              </div>
              <div className="breakdown-item-meta">
                <span>Waiting for dispatch</span>
                <span>{pct(unassignedCount)}</span>
              </div>
            </div>
          </Link>

          {/* 2. Assigned */}
          <Link
            to="/tickets?status=assigned"
            className="breakdown-item"
            style={{ "--item-color": "var(--success)" } as React.CSSProperties}
          >
            <div className="breakdown-item-icon">
              <CheckCircle2 size={18} />
            </div>
            <div className="breakdown-item-info">
              <div className="breakdown-item-top">
                <span className="breakdown-item-label">Assigned</span>
                <span className="breakdown-item-num">
                  <AnimatedNumber value={assignedCount} />
                </span>
              </div>
              <div className="breakdown-item-meta">
                <span>Helper active</span>
                <span>{pct(assignedCount)}</span>
              </div>
            </div>
          </Link>

          {/* 3. Completed */}
          <Link
            to="/tickets?status=completed"
            className="breakdown-item"
            style={{ "--item-color": "var(--brand)" } as React.CSSProperties}
          >
            <div className="breakdown-item-icon">
              <CheckCheck size={18} />
            </div>
            <div className="breakdown-item-info">
              <div className="breakdown-item-top">
                <span className="breakdown-item-label">Completed</span>
                <span className="breakdown-item-num">
                  <AnimatedNumber value={completedCount} />
                </span>
              </div>
              <div className="breakdown-item-meta">
                <span>Finished work</span>
                <span>{pct(completedCount)}</span>
              </div>
            </div>
          </Link>

          {/* 4. Cancelled */}
          <Link
            to="/tickets?status=cancelled"
            className="breakdown-item"
            style={{ "--item-color": "var(--neutral)" } as React.CSSProperties}
          >
            <div className="breakdown-item-icon">
              <XCircle size={18} />
            </div>
            <div className="breakdown-item-info">
              <div className="breakdown-item-top">
                <span className="breakdown-item-label">Cancelled</span>
                <span className="breakdown-item-num">
                  <AnimatedNumber value={cancelledCount} />
                </span>
              </div>
              <div className="breakdown-item-meta">
                <span>Cancelled on ExtraHand</span>
                <span>{pct(cancelledCount)}</span>
              </div>
            </div>
          </Link>
        </div>
      </motion.div>

      <div className="kpis">
        {kpis.map((k) => (
          <motion.div key={k.label} className={`kpi ${k.live ? "live" : ""}`} variants={itemVariants}>
            <span className="kpi-icon"><k.icon size={16} /></span>
            <span className="kpi-label">{k.label}</span>
            <b>{k.value == null ? "—" : <><AnimatedNumber value={k.value} />{k.suffix}</>}</b>
          </motion.div>
        ))}
      </div>

      <div className="grid-2">
        <Card title={<>Live calls {config.telephony_provider === "simulator" && <span className="tag">simulator</span>}</>} icon={PhoneCall}>
          {calls.data ? (
            <LiveCalls calls={calls.data} maxPrompts={config.ivr_max_prompts} onChange={refreshAll}
              empty="No calls right now. Open a ticket and press Call helpers." />
          ) : <SkeletonRows rows={2} />}
        </Card>

        <div className="stack">
          <Card title="Upcoming reminder calls" icon={BellRing}>
            {!tickets.data ? <SkeletonRows rows={3} /> : reminders.length ? (
              <Stagger as="ul" className="list">
                {reminders.map((t) => (
                  <motion.li key={t.id} variants={itemVariants}>
                    <div>
                      <Link to={`/tickets/${encodeURIComponent(t.id)}`}>{t.title ?? t.id}</Link>
                      <div className="small muted">
                        {t.next_followup!.helper_name} · {fmtOffset(t.next_followup!.offset_minutes)} before start ({fmtDateTime(t.scheduled_at)})
                      </div>
                    </div>
                    <span className="chip">{fmtRelative(t.next_followup!.due_at)}</span>
                  </motion.li>
                ))}
              </Stagger>
            ) : (
              <Empty icon={BellRing}>No reminders queued.</Empty>
            )}
          </Card>

          <Card title="Recent activity" icon={Activity}>
            {!events.data ? <SkeletonRows rows={4} /> : events.data.length ? (
              <Timeline events={events.data} showTicket time={fmtTime} />
            ) : (
              <Empty icon={Activity}>Nothing yet. Sync to pull tickets from ExtraHand.</Empty>
            )}
          </Card>
        </div>
      </div>
    </Stagger>
  );
}
