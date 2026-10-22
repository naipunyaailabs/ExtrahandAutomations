import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { itemVariants } from "../motion";

export function Card({ title, icon: Icon, actions, children, className = "", flat }: {
  title?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string; flat?: boolean;
}) {
  return (
    <motion.section className={`card ${flat ? "flat" : ""} ${className}`} variants={itemVariants}>
      {(title || actions) && (
        <header className="card-head">
          <h3>{Icon && <Icon size={15} className="card-icon" />}{title}</h3>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </motion.section>
  );
}
