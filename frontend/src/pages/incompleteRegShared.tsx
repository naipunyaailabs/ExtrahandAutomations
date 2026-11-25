/** Shared helpers & status pills for Incomplete Registration Engagement pages. */

export const inr = (x: number) => "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function toDate(iso: string): Date {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return toDate(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export function agoText(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - toDate(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtWhen(iso);
}

export function fmtCountdown(sec: number): string {
  if (sec <= 0) return "Ready now";
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  if (h <= 0) return `${m}m left`;
  return `${h}h ${m}m left`;
}

export function fmtPhone(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return "No phone";
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
}

export const MSG_STATUS_LOOK: Record<string, { label: string; tone: string }> = {
  waiting_5h: { label: "Waiting (5h)", tone: "warn" },
  ready: { label: "Ready (>5h)", tone: "reg" },
  old_skipped: { label: "Before activation · ignored", tone: "off" },
  sent: { label: "Sent", tone: "sent" },
  delivered: { label: "Delivered", tone: "delivered" },
  read: { label: "Read", tone: "read" },
  failed: { label: "Failed", tone: "failed" },
  simulated: { label: "Simulated", tone: "off" },
  no_phone: { label: "No phone", tone: "warn" },
};

export function IncompleteStatusPill({ status }: { status: string }) {
  const look = MSG_STATUS_LOOK[status] ?? { label: status, tone: "off" };
  return <span className={`wwl-chip wwl-t-${look.tone}`}>{look.label}</span>;
}

export function AudienceBadge({ audience }: { audience: "helper" | "customer" }) {
  return (
    <span
      className={`wwl-chip ${audience === "helper" ? "wwl-t-delivered" : "wwl-t-read"}`}
      style={{ textTransform: "capitalize" }}
    >
      {audience}
    </span>
  );
}
