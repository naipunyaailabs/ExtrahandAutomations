import { motion } from "framer-motion";
import { useId } from "react";

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

/** Automation mark: a gear (the machine) with a lightning bolt (the automation) and a copper signal dot. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <motion.svg width={size} height={size} viewBox="0 0 32 32" className="logo-mark" initial="rest" whileHover="hover" aria-hidden>
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10E39A" />
          <stop offset="1" stopColor="#0BA37A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#lg-${id})`} />
      <motion.g
        style={{ originX: "16px", originY: "16px" }}
        variants={{ rest: { rotate: 0 }, hover: { rotate: 90 } }}
        transition={{ type: "spring", stiffness: 120, damping: 12 }}
      >
        <g fill="#03241A" transform="translate(16 16)">
          {TEETH.map((deg) => <rect key={deg} x="-1.7" y="-10.2" width="3.4" height="4.4" rx="1" transform={`rotate(${deg})`} />)}
          <circle r="7.2" />
        </g>
        <circle cx="16" cy="16" r="4.6" fill={`url(#lg-${id})`} />
      </motion.g>
      <path d="M16.9 12.3 L13.9 16.6 H15.9 L15.1 19.8 L18.1 15.5 H16.1 Z" fill="#03241A" />
      <circle cx="26.2" cy="5.8" r="2.3" fill="#E8875A" className="logo-dot" />
    </motion.svg>
  );
}

/** "Autom@tion" wordmark; the @ carries the brand gradient. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Automation">
      Autom<span className="wordmark-at">@</span>tion
    </span>
  );
}
