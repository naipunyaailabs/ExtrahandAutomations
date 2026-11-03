import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Play,
  Square,
  Sparkles,
  X,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export interface FloatingAIAgentProps {
  onStartProcess?: () => void;
  onStopProcess?: () => void;
  onScanEvents?: () => void;
  onRefreshEvents?: () => void;
  onOpenCalendar?: () => void;
  scanning?: boolean;
  selectedCity?: string;
  activeCity?: string;
  currentCityIndex?: number;
  totalCities?: number;
}

export function FloatingAIAgent({
  onStartProcess,
  onStopProcess,
  onScanEvents,
  scanning = false,
  selectedCity = "Telangana",
  activeCity,
  currentCityIndex = 0,
  totalCities = 9,
}: FloatingAIAgentProps) {
  const [open, setOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const navigate = useNavigate();

  const isScanning = scanning;
  const currentTargetCity = activeCity || selectedCity || "All-India";

  return (
    <div
      style={{
        position: "fixed",
        bottom: "22px",
        right: "24px",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* Interactive Popover Dialog */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.94 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: "66px",
              right: 0,
              width: "300px",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "16px",
              boxShadow: "0 18px 42px rgba(15, 23, 42, 0.16)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              color: "#0f172a",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <div
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "50%",
                    background: isScanning ? "#ecfdf5" : "#eff6ff",
                    border: isScanning ? "1px solid #a7f3d0" : "1px solid #dbeafe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: isScanning ? "#16a34a" : "#2563eb",
                  }}
                >
                  <Bot size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#0f172a" }}>
                    Marketing Agent
                  </div>
                  <div style={{ fontSize: "11px", color: isScanning ? "#16a34a" : "#64748b", fontWeight: 600 }}>
                    {isScanning
                      ? `Scanning: ${currentTargetCity} (${currentCityIndex + 1}/${totalCities})`
                      : "Ready · OpenRouter API Active"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: "4px",
                  borderRadius: "6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Close assistant"
              >
                <X size={16} />
              </button>
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: "11.5px",
                color: "#475569",
                lineHeight: 1.45,
                fontWeight: 500,
                background: isScanning ? "#f0fdf4" : "#f8fafc",
                padding: "8px 12px",
                borderRadius: "8px",
                border: isScanning ? "1px solid #bbf7d0" : "1px solid #f1f5f9",
              }}
            >
              {isScanning ? (
                <div>
                  <span style={{ fontWeight: 700, color: "#15803d" }}>● Active Multi-City Scan:</span> Reading official district portals and discovering festival surges one by one city.
                </div>
              ) : (
                "Autonomous festival radar. Scans official district portals one by one city, detects upcoming demand spikes, and schedules customer WhatsApp promotions."
              )}
            </div>

            {/* THE TWO OPTIONS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {/* Option 1: START */}
              <button
                type="button"
                disabled={isScanning}
                onClick={() => {
                  if (onStartProcess) {
                    onStartProcess();
                  } else if (onScanEvents) {
                    onScanEvents();
                  } else {
                    navigate("/advertisement?start=true");
                  }
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "none",
                  background: isScanning
                    ? "#e2e8f0"
                    : "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                  color: isScanning ? "#94a3b8" : "#ffffff",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: isScanning ? "not-allowed" : "pointer",
                  boxShadow: isScanning ? "none" : "0 3px 12px rgba(37, 99, 235, 0.3)",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <Play size={15} fill={isScanning ? "#94a3b8" : "#ffffff"} />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ lineHeight: 1.15 }}>Start</div>
                    <div style={{ fontSize: "10px", fontWeight: 500, opacity: 0.9, marginTop: "2px" }}>
                      One by one city
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 650,
                    background: isScanning ? "#cbd5e1" : "rgba(255, 255, 255, 0.22)",
                    padding: "3px 9px",
                    borderRadius: "999px",
                  }}
                >
                  {isScanning ? "Running..." : "9 Cities"}
                </span>
              </button>

              {/* Option 2: STOP */}
              <button
                type="button"
                disabled={!isScanning}
                onClick={() => {
                  if (onStopProcess) {
                    onStopProcess();
                  }
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: isScanning ? "1.5px solid #ef4444" : "1px solid #e2e8f0",
                  background: isScanning ? "#fef2f2" : "#f8fafc",
                  color: isScanning ? "#dc2626" : "#94a3b8",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: !isScanning ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <Square size={14} fill={isScanning ? "#dc2626" : "#cbd5e1"} />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ lineHeight: 1.15 }}>Stop</div>
                    <div style={{ fontSize: "10px", fontWeight: 500, color: isScanning ? "#ef4444" : "#94a3b8", marginTop: "2px" }}>
                      Halt process
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: isScanning ? "#b91c1c" : "#94a3b8",
                  }}
                >
                  {isScanning ? "Active" : "Idle"}
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hovering Tooltip Pill on Mouse Enter */}
      <AnimatePresence>
        {isHovered && !open && (
          <motion.div
            initial={{ opacity: 0, x: 8, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 8, scale: 0.92 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute",
              right: "64px",
              whiteSpace: "nowrap",
              background: "#0f172a",
              color: "#ffffff",
              fontSize: "11.5px",
              fontWeight: 600,
              padding: "5px 12px",
              borderRadius: "20px",
              boxShadow: "0 6px 18px rgba(0, 0, 0, 0.16)",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Sparkles size={12} style={{ color: "#60a5fa" }} />
            <span>{isScanning ? `Scanning ${currentTargetCity}...` : "Marketing Agent (Click for Start / Stop)"}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HOVERING ANIMATED FLOATING AI AGENT BUTTON */}
      <div style={{ position: "relative" }}>
        {/* Concentric Pulsing Aura Wave 1 */}
        <motion.div
          style={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            border: isScanning ? "2px solid rgba(22, 163, 74, 0.5)" : "1.8px solid rgba(37, 99, 235, 0.4)",
            pointerEvents: "none",
          }}
          animate={{
            scale: [1, 1.25, 1],
            opacity: [0.65, 0, 0.65],
          }}
          transition={{
            duration: isScanning ? 1.4 : 2.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* The Circular Button with Float Animation */}
        <motion.button
          type="button"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => setOpen(!open)}
          animate={{
            y: [0, -6, 0],
            boxShadow: isScanning
              ? [
                  "0 6px 18px rgba(22, 163, 74, 0.3)",
                  "0 12px 26px rgba(22, 163, 74, 0.45)",
                  "0 6px 18px rgba(22, 163, 74, 0.3)",
                ]
              : [
                  "0 6px 18px rgba(37, 99, 235, 0.2)",
                  "0 12px 26px rgba(37, 99, 235, 0.32)",
                  "0 6px 18px rgba(37, 99, 235, 0.2)",
                ],
          }}
          transition={{
            duration: isScanning ? 1.6 : 2.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          whileHover={{
            scale: 1.08,
            y: -8,
          }}
          whileTap={{ scale: 0.92 }}
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "#ffffff",
            border: isScanning ? "2px solid #16a34a" : "1.8px solid #2563eb",
            color: isScanning ? "#16a34a" : "#2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            position: "relative",
            outline: "none",
            padding: 0,
          }}
          title="Marketing Agent"
          aria-label="Marketing Agent"
        >
          {/* Micro-tilt Floating Bot Icon */}
          <motion.div
            animate={{
              rotate: isScanning ? [0, 360] : [0, -5, 5, 0],
              scale: [1, 1.04, 1],
            }}
            transition={{
              duration: isScanning ? 3.0 : 3.2,
              repeat: Infinity,
              ease: isScanning ? "linear" : "easeInOut",
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {isScanning ? (
              <RefreshCw size={24} style={{ color: "#16a34a" }} />
            ) : (
              <Bot size={27} style={{ color: "#2563eb" }} />
            )}
          </motion.div>

          {/* Active Live Status Indicator */}
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: isScanning ? "#16a34a" : "#2563eb",
              border: "2px solid #ffffff",
              boxShadow: isScanning ? "0 0 6px #16a34a" : "0 0 4px #2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: "#ffffff",
              }}
            />
          </span>
        </motion.button>
      </div>
    </div>
  );
}
