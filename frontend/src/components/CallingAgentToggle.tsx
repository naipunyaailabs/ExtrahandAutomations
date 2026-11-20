import { useState } from "react";
import { Clock3, PhoneCall, PhoneOff, Play, Square, Loader2 } from "lucide-react";
import { api } from "../api";
import { usePoll } from "../hooks";

export type CallingChannel = "automation" | "bulk";

const CHANNELS: Record<
  CallingChannel,
  { title: string; short: string; activeText: string; idleText: string }
> = {
  automation: {
    title: "Automation Calling",
    short: "Auto Calls",
    activeText:
      "Automation Calling is running. Automated helper dispatch, reminders, and customer feedback calls can place phone calls.",
    idleText:
      "Automation Calling is deactivated. No automated calls will be made to real numbers. Click 'Activate' to start.",
  },
  bulk: {
    title: "Bulk Calling",
    short: "Bulk Calls",
    activeText: "Bulk Calling is running. Active campaigns dial their contacts one by one.",
    idleText:
      "Bulk Calling is deactivated. No campaign calls will be placed. Click 'Activate' to start, then activate a campaign.",
  },
};

interface CallingAgentToggleProps {
  channel?: CallingChannel;
  variant?: "bar" | "banner";
  className?: string;
  onStatusChange?: (active: boolean) => void;
}

export function CallingAgentToggle({
  channel = "automation",
  variant = "bar",
  className = "",
  onStatusChange,
}: CallingAgentToggleProps) {
  const meta = CHANNELS[channel];
  const { data: statusData, refresh } = usePoll(
    () => (channel === "bulk" ? api.bulk.agentStatus() : api.callingAgentStatus()),
    3000,
  );
  const [loading, setLoading] = useState(false);

  const isActive = statusData ? statusData.active : false;
  // Calling hours apply to the automated agent (job offers, reminders, feedback calls)
  const hours = channel === "automation" ? statusData?.calling_hours : undefined;

  const handleToggle = async (nextActive: boolean) => {
    if (loading) return;
    setLoading(true);
    try {
      if (channel === "bulk") {
        await (nextActive ? api.bulk.activateAgent() : api.bulk.deactivateAgent());
      } else if (nextActive) {
        await api.activateCallingAgent();
      } else {
        await api.deactivateCallingAgent();
      }
      await refresh();
      onStatusChange?.(nextActive);
    } catch (err) {
      console.error(`Failed to toggle ${meta.title}:`, err);
    } finally {
      setLoading(false);
    }
  };

  if (variant === "banner") {
    return (
      <div
        className={`calling-agent-banner ${isActive ? "is-active" : "is-deactive"} ${className}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          padding: "16px 20px",
          borderRadius: "14px",
          border: isActive ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid rgba(239, 68, 68, 0.4)",
          background: isActive
            ? "linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%)"
            : "linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(244, 63, 94, 0.03) 100%)",
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.03)",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "10px",
              display: "grid",
              placeItems: "center",
              background: isActive ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: isActive ? "#16a34a" : "#dc2626",
              flexShrink: 0,
            }}
          >
            {isActive ? <PhoneCall size={20} /> : <PhoneOff size={20} />}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text, #0f172a)" }}>
                {meta.title}:
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  padding: "2px 10px",
                  borderRadius: "999px",
                  background: isActive ? "#dcfce7" : "#fee2e2",
                  color: isActive ? "#15803d" : "#b91c1c",
                  border: isActive ? "1px solid #86efac" : "1px solid #fca5a5",
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: isActive ? "#16a34a" : "#dc2626",
                    boxShadow: isActive ? "0 0 6px #16a34a" : "none",
                  }}
                />
                {isActive ? "ACTIVE" : "DEACTIVE"}
              </span>
              {!isActive && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#dc2626",
                    background: "rgba(239, 68, 68, 0.1)",
                    padding: "2px 8px",
                    borderRadius: "6px",
                  }}
                >
                  Safe Mode · Real Data Protected
                </span>
              )}
            </div>
            <div style={{ fontSize: "12.5px", color: "var(--muted, #64748b)", marginTop: "3px" }}>
              {isActive ? meta.activeText : meta.idleText}
            </div>
            {hours && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginTop: "8px",
                  padding: "5px 10px",
                  borderRadius: "8px",
                  fontSize: "12.5px",
                  background: "var(--raised, rgba(148, 163, 184, 0.12))",
                  border: "1px solid var(--border, rgba(148, 163, 184, 0.3))",
                  color: "var(--text, #0f172a)",
                }}
              >
                <Clock3 size={14} style={{ color: "#0284c7" }} />
                <span>
                  Calling hours: <b>{hours.label}</b>
                </span>
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 700,
                    padding: "1px 8px",
                    borderRadius: "999px",
                    background: hours.open ? "#dcfce7" : "#fef3c7",
                    color: hours.open ? "#15803d" : "#b45309",
                  }}
                >
                  {hours.open
                    ? "Open now"
                    : `Closed now · calls resume at ${hours.next_open ? new Date(hours.next_open.endsWith("Z") ? hours.next_open : `${hours.next_open}Z`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "opening time"}`}
                </span>
                <span style={{ color: "var(--muted, #64748b)", fontSize: "11.5px" }}>
                  No calls outside these hours — job offers, reminders and feedback calls wait.
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => handleToggle(!isActive)}
          disabled={loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 18px",
            borderRadius: "10px",
            fontSize: "13px",
            fontWeight: 650,
            cursor: loading ? "wait" : "pointer",
            border: "none",
            color: "#ffffff",
            background: isActive
              ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
              : "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
            boxShadow: isActive
              ? "0 4px 12px rgba(239, 68, 68, 0.25)"
              : "0 4px 12px rgba(22, 163, 74, 0.25)",
            transition: "all 0.15s ease",
          }}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isActive ? (
            <Square size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
          <span>{loading ? "Updating..." : `${isActive ? "Deactivate" : "Activate"} ${meta.title}`}</span>
        </button>
      </div>
    );
  }

  // variant === "bar" (compact topbar)
  return (
    <div
      className={`calling-agent-bar-widget ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 8px 4px 10px",
        borderRadius: "999px",
        background: isActive ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
        border: isActive ? "1px solid rgba(34, 197, 94, 0.35)" : "1px solid rgba(239, 68, 68, 0.35)",
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: isActive ? "#16a34a" : "#dc2626",
            boxShadow: isActive ? "0 0 8px #16a34a" : "none",
          }}
        />
        <span style={{ fontSize: "12px", fontWeight: 650, color: isActive ? "#15803d" : "#b91c1c" }}>
          {meta.short}: {isActive ? "Active" : "Deactive"}
        </span>
        {hours && (
          <span
            title={`Calling hours ${hours.label}${hours.open ? " (open now)" : " (closed now)"}`}
            style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", color: hours.open ? "#15803d" : "#b45309" }}
          >
            <Clock3 size={11} /> {hours.start}–{hours.end}
          </span>
        )}
      </div>

      <button
        onClick={() => handleToggle(!isActive)}
        disabled={loading}
        title={`Click to ${isActive ? "Deactivate" : "Activate"} ${meta.title}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          padding: "4px 12px",
          borderRadius: "999px",
          fontSize: "11.5px",
          fontWeight: 650,
          cursor: loading ? "wait" : "pointer",
          border: "none",
          color: "#ffffff",
          background: isActive ? "#ef4444" : "#16a34a",
          transition: "all 0.15s ease",
          boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        }}
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : isActive ? (
          <Square size={11} fill="currentColor" />
        ) : (
          <Play size={11} fill="currentColor" />
        )}
        <span>{isActive ? "Deactivate" : "Activate"}</span>
      </button>
    </div>
  );
}
