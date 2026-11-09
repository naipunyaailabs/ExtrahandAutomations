import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Headphones,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { request } from "../api";
import type { Branding } from "../types";
import { ThemeButton } from "../components/Layout";
import { LogoMark } from "../components/Logo";
import { EASE } from "../components/motion";
import { useAuth } from "../context/AuthContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  { icon: PhoneCall, tone: "calling", title: "Calling agent", text: "Calls nearby helpers one by one and books the job on a keypress." },
  { icon: MessageSquare, tone: "whatsapp", title: "WhatsApp agent", text: "Sends work orders with a direct link into the task." },
  { icon: RefreshCw, tone: "sync", title: "Live booking sync", text: "Tickets, helpers and escalations stay up to date." },
];

/** How a booking moves through the platform (describes the real flow, not live data). */
const STEPS = [
  { icon: RefreshCw, label: "Sync booking" },
  { icon: PhoneCall, label: "Call & message helpers" },
  { icon: Headphones, label: "Escalate to care" },
];

type FieldErrors = { email?: string; password?: string; form?: string };

export default function LoginPage() {
  const { login } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    request<Branding>("GET", "/api/public-config").then(setBranding).catch(() => setBranding(null));
  }, []);
  const company = branding?.company_name ?? "";

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
    if (error) setErrors({ form: error });
  };

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  const notConfigured = errors.form?.toLowerCase().includes("not configured");

  return (
    <div className="auth">
      {/* Brand panel */}
      <aside className="auth-brand">
        <div className="auth-brand-glow" aria-hidden />
        <div className="auth-brand-grid" aria-hidden />

        <div className="auth-brand-head">
          <LogoMark size={38} />
          <div className="auth-brand-name">
            <b>{company || "Dispatch"}</b>
            <span>Automation</span>
          </div>
        </div>

        <div className="auth-brand-body">
          <motion.span className="auth-eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}>
            <ShieldCheck size={13} /> Multi-agent dispatch platform
          </motion.span>
          <motion.h1 className="auth-title" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.04, ease: EASE }}>
            Dispatch the right helper, <span className="auth-accent">automatically.</span>
          </motion.h1>
          <motion.p className="auth-lede" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}>
            Voice and WhatsApp agents place every {company ? `${company} ` : ""}booking with a nearby helper,
            and hand customer care the ones they can't.
          </motion.p>

          <ul className="auth-features">
            {FEATURES.map((f, i) => (
              <motion.li key={f.title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.16 + i * 0.07, ease: EASE }}>
                <span className={`auth-feature-icon ${f.tone}`}><f.icon size={17} /></span>
                <div>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </div>
              </motion.li>
            ))}
          </ul>

          <motion.ol className="auth-steps" aria-label="How it works" initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.42, ease: EASE }}>
            {STEPS.map((s, i) => (
              <li key={s.label}>
                <span className="auth-step-num">{i + 1}</span>
                <s.icon size={14} />
                <span>{s.label}</span>
              </li>
            ))}
          </motion.ol>
        </div>

        <div className="auth-brand-foot">
          © {new Date().getFullYear()} {company ? `${company} Automation` : "Dispatch Automation"}
        </div>
      </aside>

      {/* Form panel */}
      <main className="auth-main">
        <div className="auth-main-top">
          <span className="auth-mobile-brand">
            <LogoMark size={30} />
            <b>{company}</b>
          </span>
          <ThemeButton />
        </div>

        <motion.div className="auth-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE }}>
          <div className="auth-card-icon"><Lock size={20} /></div>
          <div className="auth-card-head">
            <h2>Sign in</h2>
            <p>Welcome back{company ? ` to ${company}` : ""}. Use your operations account.</p>
          </div>

          <AnimatePresence initial={false}>
            {errors.form && (
              <motion.div key="form-error" className={`auth-alert ${notConfigured ? "warn" : ""}`} role="alert"
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <AlertCircle size={16} />
                <div>
                  <b>{notConfigured ? "Sign-in isn't set up yet" : "Couldn't sign you in"}</b>
                  <span>
                    {notConfigured ? (
                      <>Add <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> to <code>backend/.env</code>, then restart the backend.</>
                    ) : (
                      errors.form
                    )}
                  </span>
                </div>
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
                  onChange={(e) => { setEmail(e.target.value); if (errors.email || errors.form) setErrors({}); }} />
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
                  onChange={(e) => { setPassword(e.target.value); if (errors.password || errors.form) setErrors({}); }} />
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
              <span>Keep me signed in</span>
            </label>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : null}
              <span>{loading ? "Signing in…" : "Sign in"}</span>
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="auth-help">Forgot your password? Ask your administrator to reset it.</p>
        </motion.div>

        <p className="auth-legal"><ShieldCheck size={13} /> Authorised operations staff only. Activity is logged.</p>
      </main>
    </div>
  );
}
