import { AnimatePresence, motion } from "framer-motion";
import { PhoneOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Call } from "../types";
import { SimPhone } from "./SimPhone";
import { Empty } from "./ui";

const LINGER_MS = 1800;

/** Live call cards. A call that just ended stays briefly to show its outcome, then collapses out. */
export function LiveCalls({ calls, maxPrompts, onChange, empty }: {
  calls: Call[]; maxPrompts: number; onChange: () => void; empty?: string;
}) {
  const [ended, setEnded] = useState<Record<number, Call>>({});
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const onEnded = useCallback((c: Call) => {
    setEnded((m) => ({ ...m, [c.id]: c }));
    timers.current.push(window.setTimeout(() => setEnded((m) => {
      const { [c.id]: _, ...rest } = m;
      return rest;
    }), LINGER_MS));
  }, []);

  const shown = [
    ...calls.filter((c) => !ended[c.id]),
    ...Object.values(ended),
  ].sort((a, b) => a.id - b.id);

  if (!shown.length) return <Empty icon={PhoneOff}>{empty ?? "No calls right now."}</Empty>;

  return (
    <motion.div className="phones" layout>
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((c) => (
          <motion.div key={c.id} layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }} transition={{ type: "spring", stiffness: 380, damping: 32 }}>
            <SimPhone call={c} maxPrompts={maxPrompts} onChange={onChange} onEnded={onEnded} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
