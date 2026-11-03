import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  PhoneCall,
  RefreshCw,
} from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ThemeButton } from "../components/Layout";
import { LogoMark, Wordmark } from "../components/Logo";
import { EASE } from "../components/motion";
import { useAuth } from "../context/AuthContext";

const DEMO = { email: "admin@intelligence.ai", password: "admin123" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  { icon: PhoneCall, tone: "calling", title: "Calling Agent", text: "Dials helpers nearest-first and books the job on a keypress." },
  { icon: MessageSquare, tone: "whatsapp", title: "WhatsApp Agent", text: "Sends work orders with a direct link into the task." },
  { icon: RefreshCw, tone: "sync", title: "Live ExtraHand sync", text: "Tickets, helpers and escalations stay in step." },
];

/** Illustrative activity cards for the brand panel. */
const ACTIVITY = [
  { icon: PhoneCall, tone: "calling", title: "Ramesh K. pressed 1", meta: "AC service · Indiranagar · accepted" },
  { icon: MessageSquare, tone: "whatsapp", title: "Work order delivered", meta: "Deep link opened in app" },
  { icon: BellRing, tone: "sync", title: "Reminder call queued", meta: "60 min before shift" },
];

type FieldErrors = { email?: string; password?: string };

export default function LoginPage() {
  const { login } = useAuth();
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
    else if (password.length < 4) next.password = "Password must be at least 4 characters.";
    return next;
  };

  const signIn = (e: string, p: string) => {
    setLoading(true);
    setTimeout(() => {
      login(e, p, remember);
      setLoading(false);
    }, 450);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (next.email || next.password) return;
    signIn(email, password);
  };

  const signInDemo = () => {
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    setErrors({});
    signIn(DEMO.email, DEMO.password);
  };

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  const errorCount = Number(!!errors.email) + Number(!!errors.password);

  return (
    <div className="auth">
      {/* Brand panel */}
      <aside className="auth-brand">
        <div className="auth-brand-glow" aria-hidden />
        <div className="auth-brand-grid" aria-hidden />

        <div className="auth-brand-head">
          <LogoMark size={36} />
          <span className="auth-brand-name"><Wordmark /></span>
        </div>

        <div className="auth-brand-body">
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            Dispatch the right helper,<br /><span className="auth-accent">automatically.</span>
          </motion.h1>
          <motion.p className="auth-lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.06, ease: EASE }}>
            Voice and WhatsApp agents that place every ExtraHand ticket with a nearby helper, and hand
            customer care the ones they can't.
          </motion.p>

          <ul className="auth-features">
            {FEATURES.map((f, i) => (
              <motion.li key={f.title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.14 + i * 0.07, ease: EASE }}>
                <span className={`auth-feature-icon ${f.tone}`}><f.icon size={16} /></span>
                <div>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </div>
              </motion.li>
            ))}
          </ul>

          <div className="auth-activity" aria-hidden>
            {ACTIVITY.map((a, i) => (
              <motion.div key={a.title} className="auth-activity-item"
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.45 + i * 0.15, ease: EASE }}>
                <span className={`auth-feature-icon ${a.tone}`}><a.icon size={14} /></span>
                <div className="auth-activity-text">
                  <b>{a.title}</b>
                  <span>{a.meta}</span>
                </div>
                <CheckCircle2 size={15} className="auth-activity-check" />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="auth-brand-foot">© {new Date().getFullYear()} Extrahand Automation · Multi-agent dispatch</div>
      </aside>

      {/* Form panel */}
      <main className="auth-main">
        <div className="auth-main-top">
          <span className="auth-mobile-brand"><LogoMark size={28} /><Wordmark /></span>
          <ThemeButton />
        </div>

        <motion.div className="auth-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE }}>
          <div className="auth-card-head">
            <h2>Sign in</h2>
            <p>Welcome back. Sign in to the dispatch command center.</p>
          </div>

          <AnimatePresence>
            {errorCount > 0 && (
              <motion.div className="auth-alert" role="alert" initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <AlertCircle size={15} />
                <span>{errorCount === 1 ? "Please fix the highlighted field." : "Please fix the highlighted fields."}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className={`auth-field ${errors.email ? "invalid" : ""}`}>
              <label htmlFor="login-email">Work email</label>
              <div className="auth-input">
                <Mail size={16} className="auth-input-icon" />
                <input id="login-email" type="email" inputMode="email" placeholder="you@company.com" value={email}
                  autoComplete="username" autoFocus aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors({ ...errors, email: undefined }); }} />
              </div>
              {errors.email && <span id="login-email-error" className="auth-field-error">{errors.email}</span>}
            </div>

            <div className={`auth-field ${errors.password ? "invalid" : ""}`}>
              <label htmlFor="login-password">Password</label>
              <div className="auth-input">
                <Lock size={16} className="auth-input-icon" />
                <input id="login-password" type={showPassword ? "text" : "password"} placeholder="Enter your password"
                  value={password} autoComplete="current-password" aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                  onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)}
                  onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: undefined }); }} />
                <button type="button" className="auth-eye" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password ? (
                <span id="login-password-error" className="auth-field-error">{errors.password}</span>
              ) : capsLock ? (
                <span className="auth-field-hint">Caps Lock is on</span>
              ) : null}
            </div>

            <label className="auth-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Keep me signed in for 30 days</span>
            </label>

            <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : null}
              <span>{loading ? "Signing in…" : "Sign in"}</span>
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <div className="auth-demo">
            <span className="auth-demo-icon"><KeyRound size={16} /></span>
            <div className="auth-demo-text">
              <b>Demo account</b>
              <span className="mono">{DEMO.email} · {DEMO.password}</span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={signInDemo} disabled={loading}>
              Use demo
            </button>
          </div>
        </motion.div>

        <p className="auth-legal">Authorised operations staff only. Activity is logged.</p>
      </main>
    </div>
  );
}
