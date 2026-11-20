import { callWindow, fmtIn, fmtStartTime } from "../callWindow";
import type { Ticket } from "../types";
import { useConfig } from "./Layout";

/** One line under a task's time: when its automatic calls & IVR start (6 h before the task). */
export function CallStart({ ticket }: { ticket: Ticket }) {
  const runtime = useConfig()?.runtime;
  const lead = runtime?.dispatch_lead_hours ?? 6;
  if (ticket.assignee) return null;
  const w = callWindow(ticket, lead, Date.now(), { start: runtime?.calling_hours_start, end: runtime?.calling_hours_end });
  if (w.state === "done") return null;
  if (w.state === "waiting" && w.opensAt) {
    return <span className="call-start call-start-wait" title={`Calls & IVR start ${lead} h of calling time before the task (night skipped): ${fmtStartTime(w.opensAt)}, in ${fmtIn(w.opensAt - Date.now())}`}>Calls {fmtStartTime(w.opensAt)}</span>;
  }
  if (w.state === "open" || w.state === "flexible") return <span className="call-start call-start-open" title="Inside the calling window: helpers can be called now">Ready to call</span>;
  return null;
}
