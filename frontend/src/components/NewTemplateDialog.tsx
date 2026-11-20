import { Loader2, Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";

const VAR_HINT: Record<string, string> = {
  "1": "customer name",
  "2": "offer / message",
  "3": "link or location",
};
const SAMPLE: Record<string, string> = { "1": "Ravi", "2": "₹100 OFF on Home Cleaning", "3": "https://extrahand.in" };
const DEFAULT_BODY = "Hi {{1}} 👋\n\n{{2}}\n\nBook now: {{3}}";

/** Meta language codes offered for templates (the template text must be written in this language). */
const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "te", label: "Telugu (తెలుగు)" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "ta", label: "Tamil (தமிழ்)" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { code: "ml", label: "Malayalam (മലയാളം)" },
  { code: "mr", label: "Marathi (मराठी)" },
  { code: "bn", label: "Bengali (বাংলা)" },
  { code: "gu", label: "Gujarati (ગુજરાતી)" },
  { code: "ur", label: "Urdu (اردو)" },
];

/** Best guess of the language from the script used in the text. */
function detectLanguage(text: string): string {
  if (/[ఀ-౿]/.test(text)) return "te";
  if (/[஀-௿]/.test(text)) return "ta";
  if (/[ಀ-೿]/.test(text)) return "kn";
  if (/[ഀ-ൿ]/.test(text)) return "ml";
  if (/[ঀ-৿]/.test(text)) return "bn";
  if (/[઀-૿]/.test(text)) return "gu";
  if (/[؀-ۿ]/.test(text)) return "ur";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return "en";
}

type HeaderChoice = "none" | "brand" | "banner";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
  /** Message to start from (e.g. the custom message being edited in Bulk Msgs). */
  initialBody?: string;
  /** Server file name of the banner uploaded in Bulk Msgs, offered as the header image. */
  bannerFilename?: string;
  bannerPreviewUrl?: string;
}

/** Creates a MARKETING template and submits it to Meta for approval (Bulk Msgs). */
export function NewTemplateDialog({ open, onClose, onCreated, initialBody, bannerFilename, bannerPreviewUrl }: Props) {
  const [name, setName] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [language, setLanguage] = useState("en");
  const [header, setHeader] = useState<HeaderChoice>("brand");
  const [footer, setFooter] = useState("ExtraHand");
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the latest message / banner each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const start = initialBody?.trim() ? initialBody : DEFAULT_BODY;
    setBody(start);
    setLanguage(detectLanguage(start));
    setHeader(bannerFilename ? "banner" : "brand");
    setError(null);
  }, [open, initialBody, bannerFilename]);

  const vars = useMemo(
    () => [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b),
    [body],
  );
  const namedTags = useMemo(() => [...new Set([...body.matchAll(/(?<!\{)\{\s*([a-zA-Z_]+)\s*\}(?!\})/g)].map((m) => m[0]))], [body]);
  const slug = name.trim().toLowerCase().replace(/\s+/g, "_");
  const detected = detectLanguage(body);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.whatsapp.createBulkTemplate({
        name: slug,
        body,
        footer: footer.trim() || undefined,
        examples: vars.map((v) => examples[v] ?? SAMPLE[v] ?? ""),
        language,
        header_image: header,
        banner_filename: header === "banner" ? bannerFilename : undefined,
      });
      onCreated(res.name);
      setName("");
      setExamples({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" };
  const hint: React.CSSProperties = { fontWeight: 400, color: "var(--muted)" };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Submit template to Meta"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <div style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", background: "var(--surface, #fff)", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Megaphone size={18} style={{ color: "#6250d6" }} />
          <b style={{ fontSize: 15 }}>Submit template to Meta</b>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 14 }}>
          <label style={field}>
            Template name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. hyderabad_launch_te" />
            {slug && <small style={hint}>Saved as <code>{slug}</code> (lowercase, numbers, underscores)</small>}
          </label>

          <label style={field}>
            Language
            <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            {detected !== language && (
              <small style={{ fontWeight: 400, color: "#b45309" }}>
                The message looks like {LANGUAGES.find((l) => l.code === detected)?.label ?? detected}. Meta may reject a template whose text doesn't match its language.
              </small>
            )}
          </label>

          <label style={field}>
            Header image
            <select className="input" value={header} onChange={(e) => setHeader(e.target.value as HeaderChoice)}>
              <option value="brand">ExtraHand header (default image)</option>
              {bannerFilename && <option value="banner">My uploaded poster / banner</option>}
              <option value="none">No image (text only)</option>
            </select>
            <small style={hint}>
              {header === "none"
                ? "Text-only template. Banners can't be added to it later."
                : "This image is the sample Meta reviews. When sending you can still use any poster; without one the ExtraHand header is used."}
            </small>
            {header === "banner" && bannerPreviewUrl && (
              <img src={bannerPreviewUrl} alt="Header sample" style={{ maxHeight: 120, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
            )}
          </label>

          <label style={field}>
            Message
            <textarea className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical", fontFamily: "inherit", padding: 10, height: "auto" }} />
            <small style={hint}>
              Bulk Msgs fills <code>{"{{1}}"}</code> = name, <code>{"{{2}}"}</code> = offer / message, <code>{"{{3}}"}</code> = link.
            </small>
            {namedTags.length > 0 && (
              <small style={{ fontWeight: 400, color: "#dc2626" }}>
                Meta doesn't accept {namedTags.join(", ")}. Replace with <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, <code>{"{{3}}"}</code> or plain text.
              </small>
            )}
          </label>

          {vars.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" }}>Sample values (Meta needs these to review)</span>
              {vars.map((v) => (
                <label key={v} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span><code>{`{{${v}}}`}</code> <small style={{ color: "var(--muted)" }}>{VAR_HINT[v] ?? ""}</small></span>
                  <input className="input" value={examples[v] ?? SAMPLE[v] ?? ""} onChange={(e) => setExamples({ ...examples, [v]: e.target.value })} />
                </label>
              ))}
            </div>
          )}

          <label style={field}>
            Footer (optional)
            <input className="input" value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} />
          </label>

          {error && <div style={{ color: "var(--danger, #dc2626)", fontSize: 12.5 }}>{error}</div>}
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
            Submitted to Meta as <b>Marketing</b>. It appears in the Format list as “Pending approval” and can be sent once Meta approves it
            (usually minutes to a few hours). Use the ⟳ button to refresh the status.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || !slug || !body.trim() || namedTags.length > 0}
            onClick={submit}
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Submit to Meta
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
