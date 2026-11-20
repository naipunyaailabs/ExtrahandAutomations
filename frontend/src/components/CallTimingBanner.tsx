import { AlarmClock, Hourglass, PhoneOutgoing, TimerOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { callWindow, fmtIn, fmtStartTime, leadLabel } from "../callWindow";
import type { Ticket } from "../types";
import { useConfig } from "./Layout";

const CLOSED = new Set(["completed", "cancelled", "canceled", "closed", "rejected", "expired"]);

/** When automatic calls & IVR start: the 6-hour rule, and where today's open tasks stand against it. */
export function CallTimingBanner({ tickets }: { tickets?: Ticket[] }) {
  const config = useConfig();
  const lead = config?.runtime?.dispatch_lead_hours ?? 6;
  const auto = !!config?.runtime?.auto_dispatch;
  const hours = { start: config?.runtime?.calling_hours_start, end: config?.runtime?.calling_hours_end };
  const hhmm = (v?: string) => {
    const [h, m] = (v ?? "").split(":").map(Number);
    return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` : "";
  };
  const night = hours.start && hours.end ? `${hhmm(hours.end)} – ${hhmm(hours.start)}` : "";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const s = useMemo(() => {
    let open = 0, waiting = 0, missed = 0;
    let next: { at: number; ticket: Ticket } | null = null;
    for (const t of tickets ?? []) {
      if (t.assignee || CLOSED.has((t.status || "").toLowerCase())) continue;
      const w = callWindow(t, lead, now, hours);
      if (w.state === "open" || w.state === "flexible") open++;
      else if (w.state === "missed") {
        if (t.scheduled_at && now - Date.parse(t.scheduled_at) < 86_400_000) missed++;
      }
      else if (w.state === "waiting" && w.opensAt) {
        waiting++;
        if (!next || w.opensAt < next.at) next = { at: w.opensAt, ticket: t };
      }
    }
    return { open, waiting, missed, next };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, lead, now, hours.start, hours.end]);

  return (
    <div className="ctb">
      <div className="ctb-rule">
        <span className="ctb-icon"><AlarmClock size={18} /></span>
        <div>
          <b>Calls &amp; IVR start {leadLabel(lead)} of calling time before each task</b>
          <span>
            {night && <>Night hours ({night}) are skipped: a 9:00 AM task is called from the evening before.{" "}</>}
            A task with no time is called right away.{" "}
            {auto
              ? <>Automatic calling is <em className="ctb-on">ON</em>.</>
              : <>Automatic calling is <em className="ctb-off">OFF</em>: calls go out only when you click Dispatch. Turn it on in Settings.</>}
          </span>
        </div>
      </div>
      <div className="ctb-stats">
        <div title="Unassigned tasks inside the calling window (or with no time set)">
          <PhoneOutgoing size={14} className="ctb-c-open" />
          <span>Ready to call</span>
          <b className="tabular">{s.open}</b>
        </div>
        <div title={`Unassigned tasks more than ${leadLabel(lead)} away`}>
          <Hourglass size={14} className="ctb-c-wait" />
          <span>Waiting</span>
          <b className="tabular">{s.waiting}</b>
        </div>
        <div className="ctb-next">
          <AlarmClock size={14} className="ctb-c-wait" />
          <span>Next calls start</span>
          <b className="tabular">{s.next ? fmtStartTime(s.next.at) : "—"}</b>
          {s.next && <small>in {fmtIn(s.next.at - now)} · {s.next.ticket.title || s.next.ticket.category || "task"}</small>}
        </div>
        {s.missed > 0 && (
          <div title="Unassigned tasks whose time passed without automatic calls">
            <TimerOff size={14} className="ctb-c-miss" />
            <span>Time passed</span>
            <b className="tabular">{s.missed}</b>
          </div>
        )}
      </div>
    </div>
  );
}
