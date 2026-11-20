import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  IndianRupee,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  PartyPopper,
  PhoneCall,
  ShieldCheck,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request } from "../api";
import { ThemeButton } from "../components/Layout";
import { EASE } from "../components/motion";
import { useAuth } from "../context/AuthContext";
import type { Branding } from "../types";
import "./login.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The six modules around the ExtraHand logo (same colours as the home page). Descriptions only, no numbers. */
const MODULES = [
  { icon: PhoneCall, accent: "#3b82f6", name: "Calling", title: "Calling Agent", tag: "Voice",
    text: "Calls nearby helpers one by one in Telugu and books the job on a keypress." },
  { icon: MessageSquare, accent: "#22c55e", name: "WhatsApp", title: "WhatsApp Automation", tag: "Messaging",
    text: "Sends work orders, welcomes and festival offers with a direct link into the task." },
  { icon: PartyPopper, accent: "#f59e0b", name: "Advertisement", title: "Advertisement & Campaigns", tag: "Growth",
    text: "Festival calendars, AI posters, city discounts and first-booking nudges." },
  { icon: BarChart3, accent: "#8b5cf6", name: "Users", title: "User Engagement", tag: "Analytics",
    text: "Diamond, Gold and Silver customer tiers with live reports." },
  { icon: IndianRupee, accent: "#d946ef", name: "Pricing", title: "Competitive Pricing", tag: "Market",
    text: "An AI agent that tracks competitor prices area by area." },
  { icon: Star, accent: "#f43f5e", name: "Reviews", title: "Reviews & Feedback", tag: "Quality",
    text: "Customer ratings and replies collected after every task." },
];

type FieldErrors = { email?: string; password?: string; form?: string };

const STEP = 360 / MODULES.length; // degrees between two modules
const SPIN = 6; // slow turn: degrees per second (one full turn a minute)

/** The circle of modules: turns slowly by itself, can be spun by dragging, and a clicked module glides to the top.
 *  The module at the top is the highlighted one. The angle lives in a CSS variable, so React does not re-render
 *  every frame. */
function useOrbit() {
  const ref = useRef<HTMLDivElement>(null);
  const rot = useRef(0);
  const vel = useRef(SPIN);
  const target = useRef<number | null>(null);
  const holding = useRef(false); // pointer over a module: stop turning so it can be clicked
  const drag = useRef<{ last: number; t: number; v: number; moved: number; id: number } | null>(null);
  const dragged = useRef(false);
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag.current) {
        if (target.current !== null) {
          const d = target.current - rot.current;
          if (Math.abs(d) < 0.2) {
            rot.current = target.current;
            target.current = null;
            vel.current = 0;
          } else rot.current += d * Math.min(1, dt * 5);
        } else {
          const base = reduce || holding.current ? 0 : SPIN;
          vel.current += (base - vel.current) * Math.min(1, dt * 1.2); // a spin slows back to the gentle turn
          rot.current += vel.current * dt;
        }
      }
      ref.current?.style.setProperty("--rot", `${rot.current}deg`);
      const top = ((Math.round(-rot.current / STEP) % MODULES.length) + MODULES.length) % MODULES.length;
      if (top !== focusRef.current) {
        focusRef.current = top;
        setFocus(top);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const angleOf = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    target.current = null;
    drag.current = { last: angleOf(e), t: performance.now(), v: 0, moved: 0, id: e.pointerId };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const a = angleOf(e);
    let delta = a - d.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const now = performance.now();
    const dt = Math.max(0.001, (now - d.t) / 1000);
    d.moved += Math.abs(delta);
    if (d.moved > 3 && !dragged.current) {
      dragged.current = true;
      ref.current?.setPointerCapture(d.id); // only once it is a real drag, so a plain click still reaches the module
    }
    rot.current += delta;
    d.v = d.v * 0.6 + (delta / dt) * 0.4;
    d.last = a;
    d.t = now;
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    if (dragged.current) vel.current = Math.max(-240, Math.min(240, d.v)); // let it carry on, then ease back
    drag.current = null;
  };
  /** Turns the circle so module i is at the top (the shortest way round). */
  const bringToTop = (i: number) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const goal = -i * STEP;
    const k = Math.round((rot.current - goal) / 360);
    target.current = goal + 360 * k;
  };
  const hold = (on: boolean) => { holding.current = on; };

  return { ref, focus, bringToTop, hold, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

export default function LoginPage() {
  const { login } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    request<Branding>("GET", "/api/public-config").then(setBranding).catch(() => setBranding(null));
  }, []);
  const company = branding?.company_name || "ExtraHand";

  // the circle turns slowly; the module at the top is the highlighted one
  const orbit = useOrbit();
  const focus = orbit.focus;
  const active = MODULES[focus];

  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = "Enter your work email.";
    else if (!EMAIL_RE.test(email.trim())) next.email = "That doesn't look like a valid email address.";
    if (!password) next.password = "Enter your password.";
    return next;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (next.email || next.password) return;
    setLoading(true);
    const error = await login(email, password, remember);
    setLoading(false);
    if (error) {
      setErrors({ form: error });
    } else {
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith("/") && !from.startsWith("/login") ? from : "/home", { replace: true });
    }
  };

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  const notConfigured = /not (configured|set up)/i.test(errors.form ?? "");

  return (
    <div className="lg">
      {/* ------------------------------------------------------------------ brand panel */}
      <aside className="lg-brand">
        <div className="lg-brand-grid" aria-hidden />
        <div className="lg-brand-glow" aria-hidden />

        <header className="lg-brand-head">
          <span className="lg-brand-mark"><img src="/extrahand_app_icon_transparent.png" alt="" /></span>
          <div>
            <b>{company.toUpperCase()} <em>AUTOMATION</em></b>
            <span>Home &amp; Local Services · Operations Suite</span>
          </div>
        </header>

        <motion.div className="lg-brand-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}>
          <h1>Run every booking from <span>one unified hub.</span></h1>
          <p>Voice calling, WhatsApp automation, festival campaigns, customer insights, pricing and reviews,
            working together for {company}.</p>
        </motion.div>

        <div className="lg-orbit-wrap">
          <div className="lg-orbit" ref={orbit.ref} {...orbit.handlers}
            title="Drag to spin · click a module to bring it to the top">
            <svg className="lg-orbit-lines" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="38" className="lg-ring" />
              <circle cx="50" cy="50" r="24" className="lg-ring lg-ring-in" />
              <g className="lg-spokes">
                {MODULES.map((m, i) => {
                  const a = (i / MODULES.length) * Math.PI * 2 - Math.PI / 2;
                  return (
                    <line key={m.name} x1="50" y1="50" x2={50 + 38 * Math.cos(a)} y2={50 + 38 * Math.sin(a)}
                      className={i === focus ? "on" : ""} style={{ stroke: i === focus ? m.accent : undefined }} />
                  );
                })}
              </g>
            </svg>

            <div className="lg-core">
              <span className="lg-core-pulse" aria-hidden />
              <img src="/extrahand_app_icon_transparent.png" alt={company} />
              <b>{company.toUpperCase()}</b>
              <small>AUTOMATION</small>
            </div>

            {MODULES.map((m, i) => (
              <button key={m.name} type="button" className={`lg-node ${i === focus ? "on" : ""}`}
                style={{ "--acc": m.accent, "--i": i } as CSSProperties}
                onClick={() => orbit.bringToTop(i)} onPointerEnter={() => orbit.hold(true)} onPointerLeave={() => orbit.hold(false)}
                aria-pressed={i === focus} aria-label={m.title}>
                <span className="lg-node-in">
                  <m.icon />
                  <span>{m.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence initial={false}>
          <motion.div key={active.name} className="lg-info" style={{ "--acc": active.accent } as CSSProperties}
            initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <span className="lg-info-icon"><active.icon size={20} /></span>
            <div>
              <b>{active.title} <em>{active.tag}</em></b>
              <p>{active.text}</p>
            </div>
            <small className="lg-info-hint">Click any module to read about it</small>
          </motion.div>
        </AnimatePresence>
      </aside>

      {/* ------------------------------------------------------------------ sign-in */}
      <main className="lg-main">
        <div className="lg-main-top"><ThemeButton /></div>

        <motion.div className="lg-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE }}>
          <span className="lg-card-bar" aria-hidden />
          <div className="lg-card-brand">
            <span className="lg-card-mark"><img src="/extrahand_app_icon_transparent.png" alt="" /></span>
            <div>
              <b>{company}</b>
              <small>Home &amp; Local Services</small>
            </div>
            <em>Automation</em>
          </div>

          <div className="lg-head">
            <h2>Welcome back <span aria-hidden>👋</span></h2>
            <p>Sign in to your {company} Automation workspace.</p>
          </div>

          <AnimatePresence initial={false}>
            {errors.form && (
              <motion.div key="form-error" className={`lg-alert ${notConfigured ? "warn" : ""}`} role="alert"
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <AlertCircle size={16} />
                <div>
                  <b>{notConfigured ? "Sign-in isn't set up yet" : "Couldn't sign you in"}</b>
                  <span>{notConfigured
                    ? "The server needs ADMIN_EMAIL and ADMIN_PASSWORD in its settings. Ask your administrator."
                    : errors.form}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="lg-form" noValidate>
            <div className={`lg-field ${errors.email ? "invalid" : ""}`}>
              <label htmlFor="login-email">Work email</label>
              <div className="lg-input">
                <Mail size={17} />
                <input id="login-email" type="email" inputMode="email" placeholder="name@company.com" value={email}
                  autoComplete="username" autoFocus aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  onChange={(e) => { setEmail(e.target.value); if (errors.email || errors.form) setErrors({}); }} />
              </div>
              {errors.email && <span id="login-email-error" className="lg-error">{errors.email}</span>}
            </div>

            <div className={`lg-field ${errors.password ? "invalid" : ""}`}>
              <label htmlFor="login-password">Password</label>
              <div className="lg-input">
                <Lock size={17} />
                <input id="login-password" type={showPassword ? "text" : "password"} placeholder="Enter your password"
                  value={password} autoComplete="current-password" aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                  onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)}
                  onChange={(e) => { setPassword(e.target.value); if (errors.password || errors.form) setErrors({}); }} />
                <button type="button" className="lg-eye" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {errors.password ? (
                <span id="login-password-error" className="lg-error">{errors.password}</span>
              ) : capsLock ? (
                <span className="lg-hint">Caps Lock is on</span>
              ) : null}
            </div>

            <div className="lg-row">
              <label className="lg-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Keep me signed in</span>
              </label>
              <span className="lg-forgot" title="Passwords are reset by your administrator">Forgot password? Ask your admin</span>
            </div>

            <button type="submit" className="lg-submit" disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : null}
              <span>{loading ? "Signing in…" : "Sign in"}</span>
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="lg-foot">
            <span><ShieldCheck size={13} /> Authorised staff only · activity is logged</span>
            <span>© {new Date().getFullYear()} {company}</span>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
