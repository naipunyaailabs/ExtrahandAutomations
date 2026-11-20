import { money } from "./branding";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : dateTime.format(d);
  } catch {
    return String(iso);
  }
};

export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : timeOnly.format(d);
  } catch {
    return String(iso);
  }
};

const istDayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const istTimeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Task slot in India time: "19 Nov · 11:30 am – 12:15 pm" (end only when known). */
export const fmtSlot = (start: string | null | undefined, end?: string | null) => {
  if (!start) return "Flexible";
  const s = new Date(start);
  if (isNaN(s.getTime())) return String(start);
  const day = istDayFmt.format(s);
  const from = istTimeFmt.format(s);
  const e = end ? new Date(end) : null;
  if (!e || isNaN(e.getTime())) return `${day} · ${from}`;
  const to = istDayFmt.format(e) === day ? istTimeFmt.format(e) : `${istDayFmt.format(e)}, ${istTimeFmt.format(e)}`;
  return `${day} · ${from} – ${to}`;
};

const istWeekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** Task slot split for display: { day: "Wed, 19 Nov", time: "11:30 am – 12:15 pm" }. */
export const fmtSlotParts = (start: string | null | undefined, end?: string | null): { day: string; time: string | null } => {
  if (!start) return { day: "Flexible", time: null };
  const s = new Date(start);
  if (isNaN(s.getTime())) return { day: String(start), time: null };
  const e = end ? new Date(end) : null;
  const from = istTimeFmt.format(s);
  if (!e || isNaN(e.getTime())) return { day: istWeekdayFmt.format(s), time: from };
  const sameDay = istDayFmt.format(e) === istDayFmt.format(s);
  return { day: istWeekdayFmt.format(s), time: `${from} – ${sameDay ? istTimeFmt.format(e) : `${istDayFmt.format(e)}, ${istTimeFmt.format(e)}`}` };
};

export const fmtMoney = (n: number | null | undefined) => money(n);

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const text =
    mins < 1 ? "now" : mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)}d`;
  if (text === "now") return "just now";
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

export const fmtOffset = (m: number) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "—");

/** What a call was for. */
export const callKind = (purpose: string) =>
  ({ dispatch: "Task offer", followup: "Reminder", feedback: "Rating call", callback: "Call-back" } as Record<string, string>)[purpose] ?? humanize(purpose);

export const fmtFullDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return String(iso);
  }
};

export const fmtShortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
    }).format(d);
  } catch {
    return String(iso);
  }
};

/** "8 s" or "1 min 42 s". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
