import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { fmtTime } from "../format";
import type { EventItem } from "../types";
import type { Tone } from "./ui";

function toneForEvent(kind: string): Tone {
  if (/accepted|confirmed|assigned|followups_scheduled|resolved/.test(kind)) return "success";
  if (/escalat|rejected|declined|failed|cancel/.test(kind)) return "danger";
  if (/no_input|no_answer|hung_up|busy|missed|skipped/.test(kind)) return "warn";
  if (/call_placed|call_answered|dispatch_started|followup_call/.test(kind)) return "live";
  if (/synced|closed/.test(kind)) return "neutral";
  return "info";
}

/** Vertical timeline whose line draws itself in; new events fade in at the top. */
export function Timeline({
  events = [],
  showTicket,
  time = fmtTime,
}: {
  events?: EventItem[];
  showTicket?: boolean;
  time?: (iso: string) => string;
}) {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);

  return (
    <div className="timeline">
      <motion.span className="timeline-line" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
      <ul>
        <AnimatePresence initial={false}>
          {events.map((e, i) => (
            <motion.li key={e.id} layout="position" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: mounted.current ? 0 : Math.min(i * 0.03, 0.6) }}>
              <span className={`timeline-dot tone-${toneForEvent(e.kind)}`} />
              <span className="mono small muted timeline-time">{time(e.created_at)}</span>
              <span className="timeline-msg">
                {showTicket && e.ticket_id && (
                  <Link to={`/tickets/${encodeURIComponent(e.ticket_id)}`} className="mono small">{e.ticket_id}</Link>
                )}{" "}
                {e.message}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
