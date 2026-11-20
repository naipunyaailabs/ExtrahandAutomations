import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedNumber } from "./motion";
import "./module-spotlight.css";

export interface SpotlightMetric {
  label: string;
  value: number | string;
  note: string;
  /** "good" | "bad" | "warn" colours the value; default uses the module accent */
  tone?: "good" | "bad" | "warn";
}

export interface SpotlightModule {
  key: string;
  title: string;
  subtitle: string;
  icon: LucideIcon | ((p: { size?: number }) => ReactNode);
  /** Accent colour, e.g. "#16a34a" */
  accent: string;
  status: string;
  metrics: SpotlightMetric[];
  /** Optional progress row (0..100) */
  progress?: { label: string; value: number } | null;
  /** Short line shown on the side cards, e.g. "0 Active · 5 Escalations" */
  peek: string;
  /** Values for the small trend line (oldest first) */
  trend: number[];
  trendLabel: string;
  action: string;
  /** Show a dot on the dock icon (something needs attention) */
  attention?: boolean;
  onOpen: () => void;
}

const STORE_KEY = "home.spotlight";

export function Sparkline({ values, color, id, width = 136, height = 40 }: { values: number[]; color: string; id: string; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - 4 - (v / max) * (height - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className="ms-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={`ms-g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#ms-g-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ModuleIcon({ m, size }: { m: SpotlightModule; size: number }) {
  const I = m.icon as LucideIcon;
  return <I size={size} />;
}

/** Home page: one module in focus, its neighbours tilted at the sides, and a dock to jump between modules. */
export function ModuleSpotlight({ modules, intro }: { modules: SpotlightModule[]; intro?: ReactNode }) {
  const n = modules.length;
  const [index, setIndex] = useState(() => {
    try {
      const i = modules.findIndex((m) => m.key === localStorage.getItem(STORE_KEY));
      return i >= 0 ? i : 0;
    } catch {
      return 0;
    }
  });
  const [dir, setDir] = useState(1);
  const [opening, setOpening] = useState<string | null>(null);
  const go = useCallback(
    (to: number, d?: number) => {
      const next = ((to % n) + n) % n;
      setDir(d ?? (next > index ? 1 : -1));
      setIndex(next);
      try { localStorage.setItem(STORE_KEY, modules[next].key); } catch { /* storage blocked */ }
    },
    [index, n, modules],
  );

  // Arrow keys move focus, Enter opens (ignored while typing in a field)
  const focused = modules[index];
  /** Card zooms forward for a moment, then the module opens. */
  const open = useCallback((m: SpotlightModule) => {
    if (opening) return;
    setOpening(m.key);
    window.setTimeout(() => m.onOpen(), 260);
  }, [opening]);
  const openRef = useRef(() => open(focused));
  openRef.current = () => open(focused);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") go(index + 1, 1);
      else if (e.key === "ArrowLeft") go(index - 1, -1);
      else if (e.key === "Enter" && t === document.body) openRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  // Swipe on touch screens
  const touchX = useRef<number | null>(null);

  const prev = modules[(index - 1 + n) % n];
  const next = modules[(index + 1) % n];

  return (
    <div className="ms-root" style={{ ["--ms-glow" as string]: focused.accent }}>
      <div className="ms-ambient" aria-hidden />
      {intro}
      <div
        className="ms-stage"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <SideCard m={prev} side="prev" onClick={() => go(index - 1, -1)} />

        <div className="ms-center">
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.article
              key={focused.key}
              className={`ms-card ${opening === focused.key ? "is-opening" : ""}`}
              style={{ ["--ms-accent" as string]: focused.accent }}
              role="link"
              tabIndex={0}
              aria-label={`Open ${focused.title}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest(".ms-open")) open(focused); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(focused); } }}
              whileHover={opening ? undefined : { y: -4 }}
              custom={dir}
              initial={{ opacity: 0, x: dir * 90, scale: 0.94, rotateY: dir * -14 }}
              animate={opening === focused.key ? { opacity: 0, scale: 1.06, y: -8 } : { opacity: 1, x: 0, scale: 1, rotateY: 0, y: 0 }}
              exit={{ opacity: 0, x: dir * -90, scale: 0.94, rotateY: dir * 14 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
            >
              <div className="ms-card-bar" />
              <header className="ms-head">
                <div className="ms-icon"><ModuleIcon m={focused} size={24} /></div>
                <div className="ms-title">
                  <div className="ms-title-row">
                    <h2>{focused.title}</h2>
                    <span className="ms-status">{focused.status}</span>
                  </div>
                  <p>{focused.subtitle}</p>
                </div>
                <div className="ms-trend" title={focused.trendLabel}>
                  <Sparkline values={focused.trend} color={focused.accent} id={focused.key} />
                  <span>{focused.trendLabel}</span>
                </div>
              </header>

              <div className="ms-metrics">
                {focused.metrics.map((mt, i) => (
                  <div key={mt.label} className={`ms-metric ${i === 0 ? "is-lead" : ""}`}>
                    <span className="ms-metric-label">{mt.label}</span>
                    <span className={`ms-metric-val ${mt.tone ? `tone-${mt.tone}` : ""}`}>
                      {typeof mt.value === "number" ? <AnimatedNumber value={mt.value} /> : mt.value}
                    </span>
                    <span className="ms-metric-note">{mt.note}</span>
                  </div>
                ))}
              </div>

              {focused.progress && (
                <div className="ms-progress">
                  <div className="ms-progress-head">
                    <span>{focused.progress.label}</span>
                    <b>{Math.round(focused.progress.value)}%</b>
                  </div>
                  <div className="ms-progress-track">
                    <motion.div className="ms-progress-fill" initial={{ width: 0 }}
                      animate={{ width: `${Math.max(0, Math.min(100, focused.progress.value))}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                </div>
              )}

              <footer className="ms-foot">
                <span className="ms-count">
                  Module {String(index + 1).padStart(2, "0")} of {String(n).padStart(2, "0")}
                  <span className="ms-hint"> · click the card to open</span>
                </span>
                <button type="button" className="ms-open" onClick={() => open(focused)}>
                  {focused.action} <ArrowRight size={16} />
                </button>
              </footer>
            </motion.article>
          </AnimatePresence>
        </div>

        <SideCard m={next} side="next" onClick={() => go(index + 1, 1)} />
      </div>

      <nav className="ms-dock" aria-label="Modules">
        <button type="button" className="ms-dock-arrow" onClick={() => go(index - 1, -1)} aria-label="Previous module">
          <ChevronLeft size={16} />
        </button>
        {modules.map((m, i) => (
          <motion.button
            key={m.key}
            type="button"
            className={`ms-dock-item ${i === index ? "is-active" : ""}`}
            style={{ ["--ms-accent" as string]: m.accent }}
            onClick={() => go(i)}
            onDoubleClick={() => open(m)}
            data-label={m.title}
            whileHover={{ y: -4, scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            aria-label={m.title}
            aria-current={i === index}
          >
            <ModuleIcon m={m} size={20} />
            {(i === index || m.attention) && <span className={`ms-dock-dot ${m.attention ? "is-alert" : ""}`} />}
          </motion.button>
        ))}
        <button type="button" className="ms-dock-arrow" onClick={() => go(index + 1, 1)} aria-label="Next module">
          <ChevronRight size={16} />
        </button>
      </nav>
    </div>
  );
}

function SideCard({ m, side, onClick }: { m: SpotlightModule; side: "prev" | "next"; onClick: () => void }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.button
        key={m.key}
        type="button"
        className={`ms-side ms-side-${side}`}
        style={{ ["--ms-accent" as string]: m.accent }}
        onClick={onClick}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        aria-label={`${side === "prev" ? "Previous" : "Next"}: ${m.title}`}
      >
        <div className="ms-side-top">
          {side === "prev" ? (
            <>
              <span className="ms-side-icon"><ModuleIcon m={m} size={20} /></span>
              <span className="ms-side-tag">← Prev</span>
            </>
          ) : (
            <>
              <span className="ms-side-tag">Next →</span>
              <span className="ms-side-icon"><ModuleIcon m={m} size={20} /></span>
            </>
          )}
        </div>
        <b className="ms-side-title">{m.title}</b>
        <span className="ms-side-sub">{m.subtitle}</span>
        {m.metrics[0] && (
          <span className="ms-side-lead">
            <b>{typeof m.metrics[0].value === "number" ? <AnimatedNumber value={m.metrics[0].value} /> : m.metrics[0].value}</b>
            <span>{m.metrics[0].label}</span>
          </span>
        )}
        <div className="ms-side-foot">
          <span>{m.peek}</span>
          <Sparkline values={m.trend} color={m.accent} id={`${side}-${m.key}`} width={220} height={36} />
        </div>
      </motion.button>
    </AnimatePresence>
  );
}
