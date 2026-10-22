import { motion } from "framer-motion";
import { Inbox, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export function Empty({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="empty">
      <motion.div className="empty-icon" animate={{ y: [0, -5, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
        <Icon size={22} />
      </motion.div>
      <div>{children}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <div className="error-note">{error}</div> : null;
}

export function Phone({ value }: { value: string | null | undefined }) {
  return value ? <a className="mono" href={`tel:${value}`} onClick={(e) => e.stopPropagation()}>{value}</a> : <span className="muted">no phone</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Skeleton({ w = "100%", h = 14, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton w={34} h={34} r={10} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <Skeleton w={`${55 + ((i * 17) % 35)}%`} />
            <Skeleton w={`${30 + ((i * 11) % 25)}%`} h={10} />
          </div>
          <Skeleton w={70} h={20} r={999} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="page">
      <Skeleton w={220} h={26} />
      <Skeleton w={360} h={12} />
      <div className="card"><div className="card-body"><SkeletonRows /></div></div>
    </div>
  );
}

export function Tooltip({ tip, children, side = "top" }: { tip: string; children: ReactNode; side?: "top" | "right" }) {
  return (
    <span className={`tip tip-${side}`} data-tip={tip}>
      {children}
    </span>
  );
}

// Palette hues only - no blues
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #10e39a, #0b7d5e)", // emerald
  "linear-gradient(135deg, #e8875a, #a8481c)", // copper
  "linear-gradient(135deg, #c3a6ff, #7c55d6)", // lilac
  "linear-gradient(135deg, #b8f35a, #5e8f17)", // lime
  "linear-gradient(135deg, #f2b544, #b97c10)", // ochre
  "linear-gradient(135deg, #ff8a7a, #c9373d)", // coral
];

export function Avatar({ name, size = 40 }: { name: string | null | undefined; size?: number }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) % AVATAR_GRADIENTS.length;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: AVATAR_GRADIENTS[h] }}>
      {initials}
    </span>
  );
}
