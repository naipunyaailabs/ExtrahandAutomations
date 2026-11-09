export interface ChannelActiveButtonProps {
  channelName?: string;
  isActive: boolean;
  onToggle?: () => void;
  isLoading?: boolean;
}

/**
 * Individual Active / Deactivated button for WhatsApp channels.
 * - When Active: Vibrant Green button reading "● Active"
 * - When Clicked (Deactivated): Vibrant Red button reading "● Deactivated"
 */
export function ChannelActiveButton({
  channelName,
  isActive,
  onToggle,
  isLoading = false,
}: ChannelActiveButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isLoading}
      title={
        isActive
          ? `${channelName || "Channel"} is currently Active. Click to Deactivate.`
          : `${channelName || "Channel"} is currently Deactivated. Click to Activate.`
      }
      aria-label={`${channelName || "Channel"} status is ${isActive ? "Active" : "Deactivated"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        height: "32px",
        boxSizing: "border-box",
        padding: "0 16px",
        borderRadius: "9999px",
        fontSize: "12.5px",
        fontWeight: 700,
        letterSpacing: "0.2px",
        cursor: isLoading ? "wait" : "pointer",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        background: isActive
          ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
          : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
        border: isActive ? "1.5px solid #059669" : "1.5px solid #b91c1c",
        color: "#ffffff",
        boxShadow: isActive
          ? "0 2px 10px rgba(16, 185, 129, 0.35)"
          : "0 2px 10px rgba(239, 68, 68, 0.35)",
        userSelect: "none",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!isLoading) {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.filter = "brightness(1.06)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.filter = "brightness(1)";
      }}
    >
      {/* Indicator Dot */}
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow: isActive ? "0 0 6px rgba(255, 255, 255, 0.9)" : "none",
          display: "inline-block",
        }}
      />
      <span>{isActive ? "Active" : "Deactivated"}</span>
    </button>
  );
}

export interface WhatsAppChannelToggleProps {
  automationActive: boolean;
  bulkActive: boolean;
  onToggleAutomation: () => void;
  onToggleBulk: () => void;
  isToggling?: string | null;
}

export function WhatsAppChannelToggle({
  automationActive,
  bulkActive,
  onToggleAutomation,
  onToggleBulk,
  isToggling,
}: WhatsAppChannelToggleProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <ChannelActiveButton
        channelName="Automation"
        isActive={automationActive}
        onToggle={onToggleAutomation}
        isLoading={isToggling === "automation"}
      />
      <ChannelActiveButton
        channelName="Bulk Messaging"
        isActive={bulkActive}
        onToggle={onToggleBulk}
        isLoading={isToggling === "bulk"}
      />
    </div>
  );
}
