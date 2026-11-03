import { motion } from "framer-motion";

/** Extrahand Automation official brand logo mark with clean white background. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`logo-mark ${className || ""}`}
      style={{
        width: size,
        height: size,
        background: "#ffffff",
        borderRadius: "8px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
        border: "1px solid #e2e8f0",
        padding: "2px",
        boxSizing: "border-box",
      }}
    >
      <img
        src="/extrahand-logo.png"
        alt="Extrahand Automation"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </motion.div>
  );
}

/** "Extrahand Automation" wordmark with bold Extrahand & vibrant orange Automation. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Extrahand Automation" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
      <span style={{ color: "var(--text)", fontWeight: 850, letterSpacing: "-0.015em" }}>
        Extrahand
      </span>
      <span
        className="wordmark-at"
        style={{
          background: "linear-gradient(135deg, #f97316 0%, #ea580c 55%, #d97706 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          fontWeight: 850,
          letterSpacing: "-0.015em",
        }}
      >
        Automation
      </span>
    </span>
  );
}
