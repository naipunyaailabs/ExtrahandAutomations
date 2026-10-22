import { LayoutGroup, motion } from "framer-motion";
import { useId } from "react";
import { AnimatedNumber } from "../motion";

export interface TabItem { key: string; label: string; count?: number }

export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (key: string) => void }) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div className="tabs" role="tablist">
        {items.map((t) => (
          <button key={t.key} role="tab" aria-selected={value === t.key}
            className={`tab ${value === t.key ? "active" : ""}`} onClick={() => onChange(t.key)}>
            {t.label}
            {t.count != null && <span className="tab-count"><AnimatedNumber value={t.count} /></span>}
            {value === t.key && (
              <motion.span layoutId="tab-underline" className="tab-underline"
                transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            )}
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
