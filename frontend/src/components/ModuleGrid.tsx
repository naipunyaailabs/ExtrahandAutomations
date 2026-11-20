import { motion, type Variants } from "framer-motion";
import {
  Activity, ArrowRight, CalendarDays, ChevronRight, PhoneCall, Radio, Smartphone, Sparkles, TrendingUp, type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { AnimatedNumber } from "./motion";
import { ModuleIcon, type SpotlightMetric, type SpotlightModule } from "./ModuleSpotlight";
import { WhatsAppIcon } from "./ui";
import "./module-grid.css";

/** The small icon in each card's status pill. */
const STATUS_ICON: Record<string, LucideIcon> = {
  calling: Radio, whatsapp: Smartphone, advertisement: CalendarDays, engagement: TrendingUp, pricing: Sparkles, feedback: Activity,
};
/** Calling and WhatsApp are the live automations: their buttons are the main, filled ones. */
const PRIMARY = new Set(["calling", "whatsapp"]);

const grid: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 210, damping: 24 } },
};

function Value({ m }: { m: SpotlightMetric }) {
  // numbers count up; text values ("8 Cities", "Up to 20%") are shown as they are
  return typeof m.value === "number" ? <AnimatedNumber value={m.value} /> : <>{m.value}</>;
}

/** Home page after sign-in: every automation's KPI card at once. Clicking a card opens that module. */
export function ModuleGrid({ modules, intro }: { modules: SpotlightModule[]; intro?: ReactNode }) {
  return (
    <div className="mg">
      {intro}
      <motion.div className="mg-grid" variants={grid} initial="hidden" animate="show">
        {modules.map((m) => {
          const StatusIcon = STATUS_ICON[m.key] ?? Activity;
          const primary = PRIMARY.has(m.key);
          return (
            <motion.article key={m.key} variants={card} className={`mg-card ${m.attention ? "attention" : ""}`}
              style={{ "--acc": m.accent } as CSSProperties}
              whileHover={{ y: -5, transition: { type: "spring", stiffness: 300, damping: 22 } }}
              role="link" tabIndex={0} aria-label={`Open ${m.title}`}
              onClick={m.onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); m.onOpen(); } }}>
              <span className="mg-shine" aria-hidden />

              <header className="mg-top">
                <span className="mg-icon"><ModuleIcon m={m} size={21} /></span>
                <span className="mg-status">
                  {m.attention ? <i className="mg-alert" /> : <StatusIcon size={12} />}
                  {m.status}
                </span>
              </header>

              <div className="mg-title">
                <h3>{m.title}</h3>
                <small><i />{m.subtitle}</small>
              </div>

              <div className="mg-metrics">
                {m.metrics.map((x) => (
                  <div key={x.label} className={`mg-metric ${x.tone ? `tone-${x.tone}` : ""}`}>
                    <span className="mg-label" title={x.label}>{x.label}</span>
                    <b className="mg-value"><Value m={x} /></b>
                    <small className="mg-note" title={x.note}>{x.note}</small>
                  </div>
                ))}
              </div>

              <footer className="mg-foot">
                <span className={`mg-action ${primary ? "primary" : ""}`}>
                  {primary && (
                    <span className="mg-action-icon">{m.key === "whatsapp" ? <WhatsAppIcon size={15} /> : <PhoneCall size={15} />}</span>
                  )}
                  <span className="mg-action-text">{m.action}</span>
                  {primary ? <ArrowRight size={16} className="mg-action-arrow" /> : <ChevronRight size={16} className="mg-action-arrow" />}
                </span>
              </footer>
            </motion.article>
          );
        })}
      </motion.div>
    </div>
  );
}
