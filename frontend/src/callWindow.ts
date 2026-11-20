import type { Ticket } from "./types";

/** Same rule as the backend (services/common.py call_window): automatic job-offer calls (IVR) start
 * `leadHours` before a task's scheduled time; a task with no time is called right away; a task more than
 * 30 minutes past its time is not called automatically. */
export type CallWindowState = "flexible" | "waiting" | "open" | "missed" | "done";

const GRACE_MS = 30 * 60_000;

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

function minutesOf(hhmm?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Same as the backend calls_open_at: `leadHours` of CALLING time before the task, skipping the night outside
 * calling hours (India time). 9:00 AM task, 6 h, 07:30-21:30 -> 5:00 PM the day before. */
export function callsOpenAt(at: number, leadHours: number, start?: string, end?: string): number {
  const plain = at - leadHours * 3_600_000;
  const s = minutesOf(start), e = minutesOf(end);
  if (s === null || e === null || s >= e) return plain;
  let cursor = at + IST_MS; // India time, as a UTC-based timestamp
  let remaining = leadHours * 3_600_000;
  for (let i = 0; i < 400; i++) {
    const midnight = Math.floor(cursor / DAY_MS) * DAY_MS;
    const dayStart = midnight + s * 60_000;
    const dayEnd = midnight + e * 60_000;
    if (cursor > dayEnd) cursor = dayEnd;
    if (cursor <= dayStart) {
      cursor = dayEnd - DAY_MS;
      continue;
    }
    const available = cursor - dayStart;
    if (remaining <= available) return cursor - remaining - IST_MS;
    remaining -= available;
    cursor = dayEnd - DAY_MS;
  }
  return plain;
}

export function callWindow(
  t: Pick<Ticket, "scheduled_at" | "dispatch_status">,
  leadHours: number,
  now = Date.now(),
  hours?: { start?: string; end?: string },
) {
  const at = t.scheduled_at ? Date.parse(t.scheduled_at) : NaN;
  const opensAt = Number.isFinite(at) ? callsOpenAt(at, leadHours, hours?.start, hours?.end) : null;
  let state: CallWindowState;
  if (t.dispatch_status !== "new") state = "done";
  else if (opensAt === null) state = "flexible";
  else if (now < opensAt) state = "waiting";
  else if (now > at + GRACE_MS) state = "missed";
  else state = "open";
  return { state, opensAt };
}

export function fmtIn(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.round(h / 24)} days`;
}

export function fmtStartTime(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const leadLabel = (h: number) => (Number.isInteger(h) ? `${h} hours` : `${h} h`);
