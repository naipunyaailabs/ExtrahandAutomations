import { motion } from "framer-motion";
import { CheckCircle2, Inbox, Layers, LifeBuoy, PhoneOutgoing, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { AnimatedNumber, useIncreaseKey } from "./motion";
import type { Tone } from "./ui";

interface NodeProps { to: string; tone: Tone; icon: LucideIcon; label: string; hint: string; value: number | undefined; tip: string }

function Node({ to, tone, icon: Icon, label, hint, value, tip }: NodeProps) {
  const glowKey = useIncreaseKey(value);
  return (
    <Link to={to} target="_blank" className={`node tone-${tone}`} data-tip={tip}>
      {glowKey > 0 && (
        <motion.span key={glowKey} className="node-glow" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: 1.4 }} />
      )}
      <span className="node-icon"><Icon size={18} /></span>
      <span className="node-text">
        <span className="node-num"><AnimatedNumber value={value ?? 0} /></span>
        <span className="node-label">{label}</span>
        <span className="node-hint">{hint}</span>
      </span>
    </Link>
  );
}

function Connector({ fork }: { fork?: boolean }) {
  return (
    <svg className="connector" viewBox="0 0 80 100" preserveAspectRatio="none" aria-hidden>
      {fork ? (
        <>
          <path d="M0 50 C 40 50, 40 22, 80 22" />
          <path d="M0 50 C 40 50, 40 78, 80 78" />
        </>
      ) : (
        <path d="M0 50 L 80 50" />
      )}
    </svg>
  );
}

export function Pipeline({
  totalTasks,
  unassigned,
  calling,
  assigned,
  completed,
  cancelled,
  escalated,
  reminders,
  assignedHelpers,
}: {
  totalTasks?: number;
  unassigned?: number;
  calling?: number;
  assigned?: number;
  completed?: number;
  cancelled?: number;
  escalated?: number;
  reminders?: number;
  assignedHelpers?: number;
}) {
  return (
    <div className="pipeline">
      <Node
        to="/tickets"
        tone="brand"
        icon={Layers}
        label="Total tasks"
        hint={`${unassigned ?? 0} unassigned · ${assigned ?? 0} assigned · ${completed ?? 0} completed`}
        value={totalTasks}
        tip={`All ${totalTasks ?? 0} bookings synced from ExtraHand (${unassigned ?? 0} unassigned, ${assigned ?? 0} assigned, ${completed ?? 0} completed, ${cancelled ?? 0} cancelled).`}
      />
      <Connector />
      <Node
        to="/tickets?status=new"
        tone="info"
        icon={Inbox}
        label="Unassigned"
        hint="waiting for a helper"
        value={unassigned}
        tip="Bookings with no helper yet. Click Call helpers to start."
      />
      <Connector />
      <Node
        to="/tickets?status=dispatching"
        tone="live"
        icon={PhoneOutgoing}
        label="Calling helpers"
        hint="one by one, nearest first"
        value={calling}
        tip="The agent is calling helpers right now"
      />
      <Connector fork />
      <div className="pipeline-split">
        <Node
          to="/tickets?status=assigned"
          tone="success"
          icon={CheckCircle2}
          label="Assigned"
          hint={
            assignedHelpers !== undefined
              ? `${assignedHelpers} helpers · ${reminders ?? 0} reminders`
              : `${reminders ?? 0} reminders queued`
          }
          value={assigned}
          tip={
            assignedHelpers !== undefined
              ? `${assignedHelpers} helpers assigned across ${assigned ?? 0} tasks. Reminder calls are scheduled.`
              : "Helper accepted. Reminder calls are scheduled."
          }
        />
        <Node
          to="/customer-care"
          tone="danger"
          icon={LifeBuoy}
          label="Customer care"
          hint="needs a person"
          value={escalated}
          tip="Nobody accepted, or the helper can't attend"
        />
      </div>
    </div>
  );
}
