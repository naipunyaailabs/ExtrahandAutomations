import { motion } from "framer-motion";
import { api } from "../api";
import { CallingAgentView } from "../components/CallingAgentView";
import { useConfig } from "../components/Layout";
import { itemVariants, Stagger } from "../components/motion";
import { usePoll } from "../hooks";

/** Calling Agent console tab: live calls, dialing queue, reminders and voice activity. */
export default function CallingPage({ initialView = "dispatch" }: { initialView?: "console" | "tickets" | "helpers" | "care" | "dispatch" }) {
  const config = useConfig()!;
  const stats = usePoll(api.stats, 3000);
  const calls = usePoll(() => api.calls(), 2500);
  const tickets = usePoll(() => api.tickets(), 5000);
  const events = usePoll(() => api.events(25), 3000);
  const helpers = usePoll(() => api.helpers(), 30000);
  const escalations = usePoll(() => api.escalations(), 4000);

  const refreshAll = () => {
    calls.refresh();
    stats.refresh();
    tickets.refresh();
    events.refresh();
    helpers.refresh();
    escalations.refresh();
  };

  return (
    <Stagger className="page">
      <motion.div variants={itemVariants}>
        <CallingAgentView
          stats={stats.data ?? undefined}
          calls={calls.data ?? undefined}
          tickets={tickets.data ?? undefined}
          events={events.data ?? undefined}
          helpers={helpers.data ?? undefined}
          escalations={escalations.data ?? undefined}
          onRefreshEscalations={escalations.refresh}
          ivrMaxPrompts={config.ivr_max_prompts}
          telephonyProvider={config?.telephony_provider ?? "simulator"}
          onRefreshAll={refreshAll}
          initialView={initialView}
        />
      </motion.div>
    </Stagger>
  );
}
