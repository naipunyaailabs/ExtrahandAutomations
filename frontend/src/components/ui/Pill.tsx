import { humanize } from "../../format";

export type Tone = "info" | "live" | "success" | "danger" | "warn" | "neutral" | "brand";

const TONES: Record<string, Tone> = {
  new: "info", scheduled: "info",
  dispatching: "live", running: "live", ringing: "live", in_progress: "live", calling: "live", queued: "neutral",
  assigned: "success", accepted: "success", confirmed: "success", done: "success", resolved: "success",
  escalated: "danger", rejected: "danger", failed: "danger", declined: "danger", open: "danger",
  no_input: "warn", no_answer: "warn", busy: "warn", hung_up: "warn", missed: "warn",
  closed: "neutral", cancelled: "neutral", ended: "neutral",
};
const LIVE = new Set(["dispatching", "running", "ringing", "in_progress", "calling"]);

export const toneOf = (value: string | null | undefined): Tone => TONES[value ?? ""] ?? "neutral";

export function Pill({ value, label, tone }: { value: string | null | undefined; label?: string; tone?: Tone }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span className={`pill tone-${tone ?? toneOf(value)} ${LIVE.has(value) ? "live" : ""}`}>
      <span className="pill-dot" />
      {label ?? humanize(value)}
    </span>
  );
}
