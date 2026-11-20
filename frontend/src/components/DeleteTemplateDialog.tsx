import { AlertTriangle, EyeOff, Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { WhatsAppTemplate } from "../types";

interface Props {
  open: boolean;
  /** all templates on the Bulk Msgs list (including pending / rejected ones) */
  templates: WhatsAppTemplate[];
  /** the one picked first (the template selected in Bulk Msgs) */
  initial?: string | null;
  onClose: () => void;
  onDone: (name: string, fromMeta: boolean) => void;
}

/** Remove a Meta template from Bulk Msgs, or delete it permanently from Meta (blocked for automation templates). */
export function DeleteTemplateDialog({ open, templates, initial, onClose, onDone }: Props) {
  const [picked, setPicked] = useState<string>("");
  const [mode, setMode] = useState<"hide" | "meta">("hide");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setPicked(initial && templates.some((t) => (t.id || t.name) === initial) ? initial : (templates[0]?.id ?? ""));
  }, [open, initial, templates]);

  useEffect(() => {
    setMode("hide");
    setConfirmText("");
    setError(null);
  }, [picked]);

  const template = templates.find((t) => (t.id || t.name) === picked) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (!template) {
    return createPortal(
      <div role="dialog" aria-modal="true" onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center" }}>
        <div style={{ background: "var(--surface, #fff)", padding: 20, borderRadius: 14 }}>No Meta templates on the Bulk Msgs list.</div>
      </div>,
      document.body,
    );
  }
  const name = template.id || template.name;
  const usedBy = template.used_by;
  const canSubmit = mode === "hide" || confirmText.trim() === name;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.whatsapp.deleteBulkTemplate(name, mode === "meta");
      onDone(name, mode === "meta");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const option = (key: "hide" | "meta", disabled: boolean): React.CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "22px 1fr",
    gap: 10,
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    font: "inherit",
    color: "var(--text)",
    background: mode === key ? (key === "meta" ? "rgba(220, 38, 38, 0.07)" : "rgba(18, 140, 126, 0.08)") : "transparent",
    border: `1.5px solid ${mode === key ? (key === "meta" ? "#dc2626" : "#128c7e") : "var(--border)"}`,
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete template"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div style={{ width: "min(520px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Trash2 size={18} style={{ color: "#dc2626" }} />
          <b style={{ fontSize: 15 }}>Delete template</b>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" }}>
            Template
            <select className="input" value={picked} onChange={(e) => setPicked(e.target.value)} style={{ height: 36 }}>
              {templates.map((t) => (
                <option key={t.id || t.name} value={t.id || t.name}>
                  {t.id || t.name} · {(t.category || "").toLowerCase()} · {(t.status || "").toLowerCase()}
                  {t.used_by ? " · protected" : ""}
                </option>
              ))}
            </select>
          </label>

          <button type="button" style={option("hide", false)} onClick={() => setMode("hide")}>
            <EyeOff size={18} style={{ color: "#128c7e", marginTop: 1 }} />
            <span>
              <b style={{ fontSize: 13.5 }}>Remove from Bulk Msgs</b>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                Hides it from this list. It stays in Meta and keeps working everywhere else.
              </span>
            </span>
          </button>

          <button type="button" style={option("meta", !!usedBy)} onClick={() => !usedBy && setMode("meta")} disabled={!!usedBy}>
            <Trash2 size={18} style={{ color: "#dc2626", marginTop: 1 }} />
            <span>
              <b style={{ fontSize: 13.5 }}>Delete permanently from Meta</b>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                {usedBy ? (
                  <><ShieldCheck size={12} style={{ verticalAlign: -2 }} /> Protected: used by {usedBy}.</>
                ) : (
                  <>Removes it from your WhatsApp account. Cannot be undone, and the same name can't be reused for about 30 days.</>
                )}
              </span>
            </span>
          </button>

          {mode === "meta" && (
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--text-2)" }}>
              <span><AlertTriangle size={13} style={{ color: "#dc2626", verticalAlign: -2 }} /> Type <b>{name}</b> to confirm</span>
              <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={name} autoFocus />
            </label>
          )}

          {error && <div style={{ color: "var(--danger, #dc2626)", fontSize: 12.5 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !canSubmit}
            onClick={submit}
            style={{ background: mode === "meta" ? "#dc2626" : "#128c7e", color: "#fff", border: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === "meta" ? "Delete from Meta" : "Remove from Bulk Msgs"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
