import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <label className="toggle">
      <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}>
        <motion.span className="knob" layout transition={{ type: "spring", stiffness: 600, damping: 34 }} />
      </button>
      {children && <span onClick={() => onChange(!checked)}>{children}</span>}
    </label>
  );
}
