import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction } from "../../hooks";

type ToastType = "success" | "error" | "info" | "warning";
interface ToastItem { id: number; type: ToastType; title: string; body?: string }

interface ToastApi {
  show: (type: ToastType, title: string, body?: string) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
  warning: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((type: ToastType, title: string, body?: string) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-3), { id, type, title, body }]);
    setTimeout(() => dismiss(id), type === "error" ? 6000 : 4000);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (t, b) => show("success", t, b),
    error: (t, b) => show("error", t, b),
    info: (t, b) => show("info", t, b),
    warning: (t, b) => show("warning", t, b),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <motion.div key={t.id} layout className={`toast toast-${t.type}`}
                initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}>
                <Icon size={18} className="toast-icon" />
                <div className="toast-text">
                  <div className="toast-title">{t.title}</div>
                  {t.body && <div className="toast-body">{t.body}</div>}
                </div>
                <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

/** useAction that reports failures (and optionally success) as toasts. */
export function useToastAction() {
  const toast = useToast();
  const action = useAction();
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string) => {
    let failed: string | null = null;
    const res = await action.run(async () => {
      try {
        return await fn();
      } catch (e) {
        failed = (e as Error).message;
        throw e;
      }
    });
    if (failed) toast.error("Something went wrong", failed);
    else if (success) toast.success(success);
    return res;
  }, [action, toast]);
  return { busy: action.busy, run };
}
