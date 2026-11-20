import { motion } from "framer-motion";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { WhatsAppAgentView, type WhatsAppSection } from "../components/WhatsAppAgentView";
import { usePoll } from "../hooks";

export default function WhatsAppPage({ section }: { section: WhatsAppSection }) {
  const tickets = usePoll(() => api.tickets(), 5000);
  const waStatus = usePoll(api.whatsapp.status, 6000);
  const helpers = usePoll(() => api.helpers(), 30000);
  const events = usePoll(() => api.events(20), 4000);

  const refreshAll = () => {
    tickets.refresh();
    waStatus.refresh();
    helpers.refresh();
    events.refresh();
  };

  return (
    <Stagger className="page">
      <motion.div variants={itemVariants}>
        <WhatsAppAgentView
          section={section}
          tickets={tickets.data ?? []}
          helpers={helpers.data ?? []}
          events={events.data ?? []}
          onRefreshAll={refreshAll}
        />
      </motion.div>
    </Stagger>
  );
}
