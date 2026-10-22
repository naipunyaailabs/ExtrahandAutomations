import { animate, motion, useMotionValue, useTransform, type Variants } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.18 } },
};

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

/** Route wrapper: fade + slide up on enter. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggers its <StaggerItem> children on first mount. Items mounted later
 * (new rows from polling) animate in on their own; re-renders don't restart anything.
 */
export function Stagger({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "ul" | "tbody" | "ol" }) {
  const Comp = motion[as];
  return (
    <Comp className={className} variants={containerVariants} initial="hidden" animate="show">
      {children}
    </Comp>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

export function FadeIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay }}>
      {children}
    </motion.div>
  );
}

/** Number that springs from its previous value to the new one. */
export function AnimatedNumber({ value, format }: { value: number | null | undefined; format?: (n: number) => string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => (format ? format(v) : Math.round(v).toLocaleString("en-IN")));
  useEffect(() => {
    if (value == null) return;
    const controls = animate(mv, value, { type: "spring", stiffness: 120, damping: 20 });
    return () => controls.stop();
  }, [value, mv]);
  if (value == null) return <span>—</span>;
  return <motion.span className="tabular">{text}</motion.span>;
}

/** True for one render cycle-ish window after `value` increases (for glow flashes). */
export function useIncreaseKey(value: number | null | undefined): number {
  const prev = useRef(value);
  const key = useRef(0);
  if (value != null && prev.current != null && value > prev.current) key.current += 1;
  prev.current = value;
  return key.current;
}
