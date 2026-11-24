import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  CheckCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import { countryDigits, toE164, useBranding } from "../branding";
import { useToast, WhatsAppIcon } from "./ui";
import { NewTemplateDialog } from "./NewTemplateDialog";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import type {
  BulkMessageResponse,
  BulkRecipient,
  WhatsAppStatus,
  WhatsAppTemplate,
} from "../types";

export interface CustomTemplate {
  id: string;
  name: string;
  text: string;
}

const DEFAULT_CUSTOM_TEMPLATES: CustomTemplate[] = [
  {
    id: "custom_festive_offer",
    name: "Festive Promotion & Discount",
    text: "Namaste {name}! 🎉 ExtraHand is offering an exclusive ₹200 discount on all home maintenance, plumbing, and electrical services this week. Book your expert partner now: {link}. Reply STOP to unsubscribe.",
  },
  {
    id: "custom_service_alert",
    name: "General Broadcast Announcement",
    text: "Hello {name}, this is an important service alert from ExtraHand: {message}. Please reach out if you have any questions or reply directly here. Thank you for choosing ExtraHand!",
  },
  {
    id: "custom_technician_nearby",
    name: "Nearby Available Helper Alert",
    text: "Hello {name}! 🛠️ Verified ExtraHand service partners are available in your area today for urgent repairs, cleaning, and maintenance. Reply YES or call us to book instantly!",
  },
];

export interface ContactEntry {
  id: string;
  name: string;
  phone: string;
  isValid: boolean;
  formattedPhone: string;
  reason?: string;
  source: "manual" | "excel";
}

interface WhatsAppBulkMessagingProps {
  status: WhatsAppStatus | null;
  onRefreshStatus?: () => void;
}

/** A custom message in Meta's template form: {name} → {{1}}, {message}/{discount}/{task} → {{2}}, {link} → {{3}}.
 *  {company} becomes plain text; {phone} is dropped. Numbers are kept in order, as Meta requires. */
function toMetaTemplateBody(text: string, globals: Record<string, string>): string {
  let out = text.replace(/\{\s*company\s*\}/gi, globals.company || "ExtraHand").replace(/\s*\{\s*phone\s*\}/gi, "");
  out = out.replace(/\{\s*name\s*\}/gi, "{{1}}").replace(/\{\s*(message|discount|task)\s*\}/gi, "{{2}}");
  // {{3}} is only valid when {{2}} is also used; otherwise write the link out as text.
  out = /\{\{2\}\}/.test(out)
    ? out.replace(/\{\s*link\s*\}/gi, "{{3}}")
    : out.replace(/\{\s*link\s*\}/gi, globals.link || "https://extrahand.in");
  return out;
}

export function WhatsAppBulkMessaging({
  status,
  onRefreshStatus,
}: WhatsAppBulkMessagingProps) {
  const toast = useToast();

  // Active Input Mode: 'manual' or 'excel'
  const [inputMode, setInputMode] = useState<"manual" | "excel">("manual");

  // Contacts State
  const [contacts, setContacts] = useState<ContactEntry[]>([]);

  // Manual Input fields
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [batchPasteText, setBatchPasteText] = useState("");
  const [showBatchPaste, setShowBatchPaste] = useState(false);

  // Excel / CSV upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search & Filter within Contacts Table
  const [searchQuery, setSearchQuery] = useState("");

  // Message Content
  const branding = useBranding();
  const cc = branding.default_country_code;
  const globalVariables: Record<string, string> = useMemo(
    () => ({ link: branding.offers_url, company: branding.company_name }),
    [branding.offers_url, branding.company_name]
  );
  // Custom Templates Preset State
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(() => {
    try {
      const stored = localStorage.getItem("extrahand_custom_templates");
      if (stored) return JSON.parse(stored);
    } catch (e) {
      // ignore
    }
    return DEFAULT_CUSTOM_TEMPLATES;
  });

  const [messageText, setMessageText] = useState<string>(() => DEFAULT_CUSTOM_TEMPLATES[0].text);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => DEFAULT_CUSTOM_TEMPLATES[0].id);

  // Meta Approved Templates
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);

  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  // Message the "Submit to Meta" dialog starts from (undefined = blank starter template).
  const [newTemplateBody, setNewTemplateBody] = useState<string | undefined>(undefined);
  const [deleteTemplateOpen, setDeleteTemplateOpen] = useState(false);

  // Bulk is marketing: only the bulk template list (3 ExtraHand marketing templates + ones created here)
  const loadTemplates = React.useCallback(() => {
    api.whatsapp
      .bulkTemplates()
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch((err) => console.warn("Failed to load templates", err));
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const isMetaTemplate = useMemo(() => {
    return templates.some((t) => (t.id || t.name) === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  const isCustomTemplate = !isMetaTemplate;

  // Values for a Meta template's blanks ({{2}}, {{3}}, ...); {{1}} is always each recipient's name
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const selectedMeta = useMemo(
    () => (isMetaTemplate ? templates.find((t) => (t.id || t.name) === selectedTemplateId) : undefined),
    [isMetaTemplate, templates, selectedTemplateId],
  );
  const templateSlots = useMemo(() => {
    const fromBody = [...(selectedMeta?.template ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]);
    return [...new Set(fromBody)].filter((n) => n !== "1").sort((a, b) => +a - +b);
  }, [selectedMeta]);
  /** Meta rejects blanks with new-lines, tabs or 4+ spaces (#132018); the backend cleans them the same way. */
  const cleanVar = (v: string) => v.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, " ").trim();
  const slotLabel = (n: string) => (n === "2" ? "Offer / update" : n === "3" ? "Link" : `Value ${n}`);

  const handleSelectTemplate = (tmplId: string) => {
    setSelectedTemplateId(tmplId);
    if (!tmplId || tmplId === "custom_new") {
      setMessageText("");
      return;
    }
    const custom = customTemplates.find((t) => t.id === tmplId);
    if (custom) {
      setMessageText(custom.text);
      return;
    }
    const t = templates.find((x) => x.id === tmplId || x.name === tmplId);
    if (t && t.template) {
      setMessageText(t.template);
      setTemplateVars({ "3": branding.offers_url || "https://extrahand.in" });
    }
  };

  const handleInsertTag = (tag: string) => {
    if (!textareaRef.current) {
      setMessageText((prev) => `${prev} ${tag}`);
      return;
    }
    const el = textareaRef.current;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const next = messageText.substring(0, start) + tag + messageText.substring(end);
    setMessageText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  const handleSaveCustomTemplate = () => {
    const name = window.prompt("Enter a name for this custom template:", "My Custom Campaign");
    if (!name || !name.trim()) return;
    const newTmpl: CustomTemplate = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      text: messageText,
    };
    const updated = [newTmpl, ...customTemplates];
    setCustomTemplates(updated);
    try {
      localStorage.setItem("extrahand_custom_templates", JSON.stringify(updated));
    } catch (e) {
      // ignore
    }
    setSelectedTemplateId(newTmpl.id);
    toast.success("Template Saved", `"${name.trim()}" saved to Custom Templates.`);
  };

  const handleDeleteCustomTemplate = (id: string) => {
    if (!window.confirm("Are you sure you want to delete this custom template?")) return;
    const updated = customTemplates.filter((t) => t.id !== id);
    setCustomTemplates(updated);
    try {
      localStorage.setItem("extrahand_custom_templates", JSON.stringify(updated));
    } catch (e) {
      // ignore
    }
    setSelectedTemplateId("custom_new");
    setMessageText("");
    toast.info("Template Deleted", "Custom template removed.");
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [bubbleMode, setBubbleMode] = useState<"edit" | "preview">("edit");
  const [bannerImageUrl, setBannerImageUrl] = useState<string>("");
  const [bannerMediaId, setBannerMediaId] = useState<string>("");
  const [bannerFileName, setBannerFileName] = useState<string>("");
  const [bannerServerFile, setBannerServerFile] = useState<string>("");
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingBanner(true);
    setBannerFileName(file.name);
    try {
      const res = await api.whatsapp.uploadBanner(file);
      if (res) {
        setBannerImageUrl(res.preview_url || res.url);
        setBannerServerFile(res.filename);
        if (res.meta_media_id) {
          setBannerMediaId(res.meta_media_id);
        }
        toast.success("Image Uploaded", `Poster "${file.name}" uploaded successfully.`);
      }
    } catch (err: any) {
      toast.error("Upload Failed", err.message || "Could not upload banner image.");
    } finally {
      setIsUploadingBanner(false);
      if (bannerFileInputRef.current) bannerFileInputRef.current.value = "";
    }
  };

  const handleClearBanner = () => {
    setBannerImageUrl("");
    setBannerMediaId("");
    setBannerFileName("");
    setBannerServerFile("");
    toast.info("Image Removed", "Campaign banner removed.");
  };

  // Execution & Dispatch State
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState(0);
  const [dispatchResult, setDispatchResult] = useState<BulkMessageResponse | null>(null);
  const [sessionSent, setSessionSent] = useState<number>(0);
  const [sessionFailed, setSessionFailed] = useState<number>(0);

  // Contact Validation helper
  const validatePhone = (raw: string): { isValid: boolean; formatted: string; reason: string } => {
    if (!raw || !raw.trim()) {
      return { isValid: false, formatted: "", reason: "Phone number is required" };
    }
    const clean = raw.trim();
    const formatted = toE164(branding, clean);
    if (formatted) {
      const local = formatted.startsWith(`+${countryDigits(branding)}`);
      return { isValid: true, formatted, reason: local ? `Valid (${cc})` : "Valid (E.164)" };
    }
    return {
      isValid: false,
      formatted: clean,
      reason: `Invalid phone number (${clean.replace(/\D/g, "").length} digits)`,
    };
  };

  // Add Single Contact
  const handleAddManualContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPhone.trim()) {
      toast.error("Phone Required", "Please enter a recipient phone number.");
      return;
    }

    const { isValid, formatted, reason } = validatePhone(manualPhone);
    const newEntry: ContactEntry = {
      id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: manualName.trim() || "",
      phone: manualPhone.trim(),
      formattedPhone: formatted,
      isValid,
      reason,
      source: "manual",
    };

    setContacts((prev) => [newEntry, ...prev]);
    setManualPhone("");
    setManualName("");

    if (isValid) {
      toast.success("Contact Added", `${formatted} added to recipient list.`);
    } else {
      toast.warning("Check Number Format", `Added but marked invalid: ${reason}`);
    }
  };

  // Add Batch Pasted Numbers
  const handleBatchPasteSubmit = () => {
    if (!batchPasteText.trim()) return;

    const lines = batchPasteText.split(/[\n,;]+/);
    const newEntries: ContactEntry[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Check if line is "Name: Phone" or "Name, Phone"
      let name = "";
      let phone = trimmed;
      if (trimmed.includes(":") || trimmed.includes("=")) {
        const parts = trimmed.split(/[:=]/);
        name = parts[0].trim();
        phone = parts[1].trim();
      }

      const { isValid, formatted, reason } = validatePhone(phone);
      newEntries.push({
        id: `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name,
        phone,
        formattedPhone: formatted,
        isValid,
        reason,
        source: "manual",
      });
    });

    if (newEntries.length > 0) {
      setContacts((prev) => [...newEntries, ...prev]);
      toast.success("Batch Contacts Added", `Parsed ${newEntries.length} contacts.`);
      setBatchPasteText("");
      setShowBatchPaste(false);
    }
  };

  // Parse Excel / CSV File
  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadedFileName(file.name);

    try {
      const res = await api.whatsapp.parseContacts(file);
      if (res && res.contacts) {
        const importedEntries: ContactEntry[] = res.contacts.map((c, i) => ({
          id: `file_${Date.now()}_${i}`,
          name: c.name || "",
          phone: c.original_phone,
          formattedPhone: c.formatted_phone,
          isValid: c.is_valid,
          reason: c.reason || (c.is_valid ? "Valid" : "Invalid"),
          source: "excel",
        }));

        setContacts((prev) => [...importedEntries, ...prev]);
        toast.success(
          "Excel Contacts Loaded",
          `Found ${res.valid_count} valid and ${res.invalid_count} invalid contacts from ${file.name}.`
        );
      }
    } catch (err: any) {
      // Local fallback CSV parser if network or backend fails
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (text) {
            const rows = text.split("\n");
            const localEntries: ContactEntry[] = [];
            rows.forEach((r, idx) => {
              const cells = r.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
              if (idx === 0 && cells.some((c) => /phone|mobile|name/i.test(c))) return; // skip header
              if (cells.length === 0 || !cells[0]) return;

              let name = cells.length > 1 ? cells[0] : "";
              let phone = cells.length > 1 ? cells[1] : cells[0];
              if (!/\d/.test(phone) && /\d/.test(name)) {
                // swap if backwards
                const tmp = name;
                name = phone;
                phone = tmp;
              }

              const { isValid, formatted, reason } = validatePhone(phone);
              if (phone) {
                localEntries.push({
                  id: `local_csv_${Date.now()}_${idx}`,
                  name,
                  phone,
                  formattedPhone: formatted,
                  isValid,
                  reason,
                  source: "excel",
                });
              }
            });

            if (localEntries.length > 0) {
              setContacts((prev) => [...localEntries, ...prev]);
              toast.success("CSV Loaded Locally", `Imported ${localEntries.length} contacts.`);
            }
          }
        };
        reader.readAsText(file);
      } else {
        toast.error("File Upload Failed", err.message || "Failed to parse file.");
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Download Sample Contacts CSV
  const handleDownloadSample = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "Name,Phone,City,Notes\n" +
      `Full name,${cc} phone number,City,Optional note\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${branding.company_name.replace(/\W+/g, "_")}_Bulk_Contacts_Sample.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Remove single contact
  const handleRemoveContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  // Remove all invalid contacts
  const handleRemoveInvalid = () => {
    const invalidCount = contacts.filter((c) => !c.isValid).length;
    setContacts((prev) => prev.filter((c) => c.isValid));
    toast.success("Cleaned Contacts", `Removed ${invalidCount} invalid phone numbers.`);
  };

  // Clear all contacts
  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all recipients?")) {
      setContacts([]);
      setDispatchResult(null);
      toast.info("Cleared", "All recipients removed.");
    }
  };

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.formattedPhone.toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  const validContacts = useMemo(() => contacts.filter((c) => c.isValid), [contacts]);
  const invalidContacts = useMemo(() => contacts.filter((c) => !c.isValid), [contacts]);

  // Live Message Preview with First Contact or Sample Data
  const previewText = useMemo(() => {
    // With no contacts yet, the {name} and {phone} placeholders stay visible in the preview.
    const sampleName = validContacts.length > 0 && validContacts[0].name ? validContacts[0].name : "{name}";
    const samplePhone = validContacts.length > 0 ? validContacts[0].formattedPhone : "{phone}";

    if (isMetaTemplate) {
      const name = validContacts.length > 0 && validContacts[0].name ? validContacts[0].name : "Customer";
      return messageText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) =>
        n === "1" ? name : cleanVar(templateVars[n] ?? "") || `[${slotLabel(n)}]`,
      );
    }

    let text = messageText;
    text = text.replace(/\{name\}/g, sampleName);
    text = text.replace(/\{phone\}/g, samplePhone);

    Object.entries(globalVariables).forEach(([key, val]) => {
      const regex = new RegExp(`\\{${key}\\}`, "g");
      text = text.replace(regex, val);
    });

    return text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageText, validContacts, globalVariables, isMetaTemplate, templateVars]);

  // Dispatch Bulk Messages Trigger
  const handleSendMessages = async () => {
    if (validContacts.length === 0) {
      toast.error("No Valid Contacts", "Please enter or upload at least one valid phone number.");
      return;
    }
    if (!messageText.trim()) {
      toast.error("Message Empty", "Please write or select a message template to send.");
      return;
    }
    const missing = isMetaTemplate ? templateSlots.filter((n) => !cleanVar(templateVars[n] ?? "")) : [];
    if (missing.length > 0) {
      toast.error("Fill the template", `Please fill: ${missing.map(slotLabel).join(", ")}.`);
      return;
    }

    setIsDispatching(true);
    setDispatchProgress(10);
    setDispatchResult(null);

    const recipientsPayload: BulkRecipient[] = validContacts.map((c) => ({
      phone: c.formattedPhone,
      name: c.name || undefined,
    }));

    try {
      setDispatchProgress(35);
      const res = await api.whatsapp.sendBulk({
        recipients: recipientsPayload,
        message: messageText,
        template_id: isMetaTemplate ? selectedTemplateId : undefined,
        image_url: bannerMediaId || bannerImageUrl || undefined,
        variables: isMetaTemplate
          ? {
              ...globalVariables,
              ...Object.fromEntries(templateSlots.map((n) => [n, cleanVar(templateVars[n] ?? "")])),
            }
          : globalVariables,
      });

      setDispatchProgress(100);
      setDispatchResult(res);

      const sentCount = res.sent_count || 0;
      const simulatedCount = res.simulated_count || 0;
      const failedCount = res.failed_count || 0;
      setSessionSent((prev) => prev + sentCount);
      setSessionFailed((prev) => prev + failedCount);

      if (sentCount > 0) {
        toast.success(
          "Broadcast sent",
          `Sent ${sentCount} message(s).${failedCount ? ` ${failedCount} failed.` : ""}${simulatedCount ? ` ${simulatedCount} only simulated.` : ""}`
        );
      } else if (simulatedCount > 0) {
        toast.info("Test mode only", `${simulatedCount} message(s) were simulated. No real WhatsApp message was sent.`);
      } else {
        toast.error("Broadcast failed", `All ${failedCount} message(s) failed to send.`);
      }

      if (onRefreshStatus) onRefreshStatus();
    } catch (err: any) {
      setSessionFailed((prev) => prev + validContacts.length);
      toast.error("Dispatch Error", err.message || "Failed to send bulk messages.");
    } finally {
      setIsDispatching(false);
    }
  };

  // Cumulative Metrics for Sent and Not Sent
  const messagesTodayBase = status?.messages_today ?? 0;
  const totalSentCount = messagesTodayBase + sessionSent;
  const totalNotSentCount = sessionFailed + invalidContacts.length;

  return (
    <div className="wa-tasks-master-view">
      {/* SECTION HEADER */}
      <div className="wa-section-head" style={{ marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <WhatsAppIcon size={24} style={{ color: "#25D366" }} />
              <span>Bulk Messaging Module</span>
            </h1>
            <span
              className="badge"
              style={{
                background: "rgba(37, 211, 102, 0.12)",
                color: "#16a34a",
                border: "1px solid rgba(37, 211, 102, 0.3)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "12px",
              }}
            >
              Meta Cloud API Ready
            </span>
          </div>
          <p className="muted" style={{ margin: "6px 0 0 0" }}>
            Send bulk WhatsApp messages by manually inputting recipients or uploading an Excel/CSV contact list.
          </p>
        </div>

        <div className="wa-section-actions">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              className="pill tone-success"
              style={{
                height: "32px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "0 14px",
                borderRadius: "9999px",
                fontSize: "12px",
                fontWeight: 600,
                boxSizing: "border-box",
                background: "rgba(37, 211, 102, 0.12)",
                border: "1px solid rgba(37, 211, 102, 0.35)",
                color: "#15803d",
              }}
            >
              <span className="live-dot" style={{ background: "#25D366" }} />
              <span>Gateway: {status?.status === "WORKING" ? "Live Paired" : "Ready / Meta Cloud"}</span>
            </span>

            {onRefreshStatus && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRefreshStatus}
                title="Sync WhatsApp status"
                style={{
                  height: "32px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "0 12px",
                  borderRadius: "9999px",
                  background: "var(--raised, #f1f5f9)",
                  border: "1px solid var(--border)",
                  fontSize: "12px",
                  fontWeight: 600,
                  boxSizing: "border-box",
                }}
              >
                <RefreshCw size={13} />
                <span>Sync</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QUICK KPI STRIP */}
      <div
        className="whatsapp-kpi-bar"
        style={{
          marginTop: "0.25rem",
          marginBottom: "1.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        {/* Card 1: Total Recipients */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label">Total Recipients</span>
          <span className="whatsapp-kpi-num" style={{ color: "var(--brand)" }}>
            {contacts.length}
          </span>
          <span className="whatsapp-kpi-sub">{contacts.length === 0 ? "Add numbers below" : "In current queue"}</span>
        </div>

        {/* Card 2: Valid Numbers */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label">Valid Numbers</span>
          <span className="whatsapp-kpi-num" style={{ color: "#10b981" }}>
            {validContacts.length}
          </span>
          <span className="whatsapp-kpi-sub">Ready for broadcast</span>
        </div>

        {/* Card 3: Messages Sent */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <CheckCheck size={13} style={{ color: "#10b981" }} />
            <span>Messages Sent</span>
          </span>
          <span className="whatsapp-kpi-num" style={{ color: "#10b981" }}>
            {totalSentCount}
          </span>
          <span className="whatsapp-kpi-sub">
            {sessionSent > 0 ? `+${sessionSent} new this session` : `${messagesTodayBase} delivered today`}
          </span>
        </div>

        {/* Card 4: Not Sent / Failed */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <AlertCircle size={13} style={{ color: totalNotSentCount > 0 ? "#ef4444" : "var(--muted)" }} />
            <span>Not Sent / Failed</span>
          </span>
          <span
            className="whatsapp-kpi-num"
            style={{ color: totalNotSentCount > 0 ? "#ef4444" : "var(--muted)" }}
          >
            {totalNotSentCount}
          </span>
          <span className="whatsapp-kpi-sub">
            {sessionFailed > 0
              ? `${sessionFailed} failed API delivery`
              : invalidContacts.length > 0
              ? `${invalidContacts.length} invalid format`
              : "0 delivery failures"}
          </span>
        </div>

        {/* Card 5: Invalid Numbers */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label">Invalid Numbers</span>
          <span className="whatsapp-kpi-num" style={{ color: invalidContacts.length > 0 ? "#ef4444" : "var(--muted)" }}>
            {invalidContacts.length}
          </span>
          <span className="whatsapp-kpi-sub">
            {invalidContacts.length > 0 ? (
              <button
                type="button"
                onClick={handleRemoveInvalid}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "11px",
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                  fontWeight: 600,
                }}
              >
                Clean up invalid
              </button>
            ) : (
              "Format verified"
            )}
          </span>
        </div>

        {/* Card 6: Delivery Channel */}
        <div className="whatsapp-kpi-card">
          <span className="whatsapp-kpi-label">Delivery Channel</span>
          <span className="whatsapp-kpi-num" style={{ fontSize: "1.1rem", color: "#25D366", marginTop: "2px" }}>
            WhatsApp Cloud
          </span>
          <span className="whatsapp-kpi-sub">Delivery rate: {status?.delivery_rate || "not tracked"}</span>
        </div>
      </div>

      {/* 2-COLUMN SIDE-BY-SIDE GRID */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: "1.25rem",
          alignItems: "stretch",
          marginBottom: "1.25rem",
        }}
      >
        {/* =========================================================
            COLUMN 1 (LEFT): 1ST ONE IS WHATSAPP PREVIEW MSG & EDITABLE
            ========================================================= */}
        <div
          className="agent-box"
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            boxSizing: "border-box",
            gap: "12px",
          }}
        >
          {/* Card Header with Mode Switcher */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "36px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <WhatsAppIcon size={18} style={{ color: "#25D366" }} />
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>1. WhatsApp Message</h3>
            </div>
            <div style={{ display: "inline-flex", background: "var(--raised, #f1f5f9)", padding: "3px", borderRadius: "8px", gap: "4px" }}>
              <button
                type="button"
                className={`btn btn-sm ${bubbleMode === "edit" ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: "12px", height: "30px", padding: "0 10px" }}
                onClick={() => setBubbleMode("edit")}
              >
                <Edit3 size={13} style={{ marginRight: "4px" }} />
                <span>Edit Bubble</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${bubbleMode === "preview" ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: "12px", height: "30px", padding: "0 10px" }}
                onClick={() => setBubbleMode("preview")}
              >
                <Eye size={13} style={{ marginRight: "4px" }} />
                <span>Rendered Sample</span>
              </button>
            </div>
          </div>

          {/* Format / Template Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 10px",
              background: "var(--raised, #f8fafc)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              fontSize: "12px",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Format:
            </span>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="input"
              style={{
                height: "32px",
                fontSize: "12px",
                flex: 1,
                padding: "2px 8px",
                fontWeight: 600,
                color: isMetaTemplate ? "#16a34a" : "#0284c7",
              }}
            >
              <optgroup label="✨ Custom Templates (Compose your own)">
                <option value="custom_new">✏️ New Custom Template (Write your own)</option>
                {customTemplates.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    📝 {ct.name} (Custom)
                  </option>
                ))}
              </optgroup>
              <optgroup label="⚡ Meta Approved Templates (Delivers to Anyone)">
                {templates.map((t) => {
                  const approved = (t.status ?? "APPROVED") === "APPROVED";
                  const state = approved ? "Meta Approved" : t.status === "REJECTED" ? "Rejected by Meta" : "Pending approval";
                  return (
                    <option key={t.id || t.name} value={t.id || t.name} disabled={!approved}>
                      {approved ? "⚡" : "⏳"} {t.name || t.id} ({state})
                    </option>
                  );
                })}
              </optgroup>
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ fontSize: "12px", height: "32px", padding: "0 10px", whiteSpace: "nowrap" }}
              onClick={() => {
                setNewTemplateBody(undefined);
                setNewTemplateOpen(true);
              }}
              title="Create a new marketing template and submit it to Meta for approval"
            >
              <Plus size={13} style={{ marginRight: "4px" }} />
              <span>New Template</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ height: "32px", padding: "0 8px", color: "#dc2626" }}
              onClick={() => setDeleteTemplateOpen(true)}
              disabled={templates.length === 0}
              title="Remove a Meta template from Bulk Msgs or delete it from Meta"
              aria-label="Delete template"
            >
              <Trash2 size={14} />
            </button>
            <DeleteTemplateDialog
              open={deleteTemplateOpen}
              templates={templates}
              initial={isMetaTemplate ? selectedTemplateId : null}
              onClose={() => setDeleteTemplateOpen(false)}
              onDone={(name, fromMeta) => {
                setDeleteTemplateOpen(false);
                if (selectedTemplateId === name) {
                  setSelectedTemplateId("custom_new");
                  setMessageText("");
                }
                loadTemplates();
                toast.success(
                  fromMeta ? "Template deleted" : "Template removed",
                  fromMeta ? `"${name}" was deleted from Meta.` : `"${name}" no longer shows in Bulk Msgs. It still exists in Meta.`,
                );
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ height: "32px", padding: "0 8px" }}
              onClick={loadTemplates}
              title="Refresh templates (check Meta approval status)"
              aria-label="Refresh templates"
            >
              <RefreshCw size={13} />
            </button>
            <NewTemplateDialog
              open={newTemplateOpen}
              initialBody={newTemplateBody}
              bannerFilename={bannerServerFile || undefined}
              bannerPreviewUrl={bannerImageUrl || undefined}
              onClose={() => setNewTemplateOpen(false)}
              onCreated={(name) => {
                setNewTemplateOpen(false);
                loadTemplates();
                toast.success("Template submitted", `"${name}" was sent to Meta for approval. It can be used once approved.`);
              }}
            />
          </div>

          {/* Meta template blanks: {{1}} = recipient name, the rest typed here */}
          {isMetaTemplate && templateSlots.length > 0 && (
            <div
              style={{
                display: "grid",
                gap: "6px",
                padding: "8px 10px",
                background: "rgba(22, 163, 74, 0.05)",
                border: "1px dashed rgba(22, 163, 74, 0.35)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "var(--muted)" }}>
                Fill the template. <code>{"{{1}}"}</code> is each contact's name automatically.
              </span>
              {templateSlots.map((n) => (
                <label key={n} style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600 }}>
                    {slotLabel(n)} <code style={{ color: "var(--muted)" }}>{`{{${n}}}`}</code>
                  </span>
                  <input
                    className="input"
                    style={{ height: "30px", fontSize: "12.5px" }}
                    value={templateVars[n] ?? ""}
                    placeholder={n === "2" ? "e.g. ₹100 OFF on Home Cleaning this Diwali" : n === "3" ? "https://..." : ""}
                    onChange={(e) => setTemplateVars({ ...templateVars, [n]: e.target.value.replace(/[\r\n\t]+/g, " ") })}
                  />
                </label>
              ))}
            </div>
          )}

          {/* Custom Template Toolbar: Dynamic Variables & Preset Actions */}
          {isCustomTemplate && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(2, 132, 199, 0.05)",
                border: "1px solid rgba(2, 132, 199, 0.25)",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#0369a1", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Sparkles size={13} />
                  <span>Insert Variable Tag:</span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setNewTemplateBody(toMetaTemplateBody(messageText, globalVariables));
                      setNewTemplateOpen(true);
                    }}
                    disabled={!messageText.trim()}
                    style={{ fontSize: "11px", height: "26px", padding: "0 10px", background: "#16a34a", color: "#fff", fontWeight: 700, border: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}
                    title="Submit this message to Meta as a template so it can be delivered to any number"
                  >
                    <Send size={12} />
                    <span>Submit to Meta</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={handleSaveCustomTemplate}
                    style={{ fontSize: "11px", height: "24px", padding: "0 8px", color: "#0284c7", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                    title="Save current message as a custom template preset"
                  >
                    <BookmarkPlus size={12} />
                    <span>Save As Preset</span>
                  </button>
                  {selectedTemplateId?.startsWith("custom_") && selectedTemplateId !== "custom_new" && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleDeleteCustomTemplate(selectedTemplateId)}
                      style={{ fontSize: "11px", height: "24px", padding: "0 6px", color: "#dc2626" }}
                      title="Delete this custom template preset"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Tag Badges */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {["{name}", "{phone}", "{company}", "{link}", "{discount}", "{task}", "{message}"].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleInsertTag(tag)}
                    style={{
                      background: "#ffffff",
                      border: "1px solid rgba(2, 132, 199, 0.35)",
                      borderRadius: "4px",
                      padding: "2px 7px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#0284c7",
                      cursor: "pointer",
                      fontFamily: "monospace",
                    }}
                    title={`Click to insert ${tag} into message`}
                  >
                    + {tag}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: "10.5px", color: "#64748b", marginTop: "2px" }}>
                💡 <strong>Tip:</strong> Custom messages only reach contacts active within 24 hours. To reach any number, click <strong>Submit to Meta</strong>; once approved it appears under Meta Approved Templates. <strong>Save As Preset</strong> only saves it in this browser.
              </div>
            </div>
          )}

          {/* Campaign Poster / Header Image Upload */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              padding: "8px 12px",
              background: "var(--raised, #f8fafc)",
              borderRadius: "8px",
              border: "1px dashed rgba(37, 211, 102, 0.4)",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
              <ImageIcon size={16} style={{ color: "#25D366", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>Campaign Poster / Banner Image</span>
                  {bannerImageUrl && (
                    <span style={{ fontSize: "10px", color: "#16a34a", background: "rgba(22, 163, 74, 0.15)", padding: "1px 6px", borderRadius: "4px" }}>
                      ✓ Attached
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {bannerFileName ? bannerFileName : "Upload a photo or flyer to include in WhatsApp message header"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                ref={bannerFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerUpload}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => bannerFileInputRef.current?.click()}
                disabled={isUploadingBanner}
                style={{
                  fontSize: "11.5px",
                  height: "28px",
                  padding: "0 10px",
                  borderColor: "#25D366",
                  color: "#16a34a",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Upload size={12} />
                <span>{isUploadingBanner ? "Uploading..." : bannerImageUrl ? "Change Image" : "Upload Image"}</span>
              </button>

              {bannerImageUrl && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={handleClearBanner}
                  style={{
                    fontSize: "11.5px",
                    height: "28px",
                    padding: "0 8px",
                    color: "#dc2626",
                  }}
                  title="Remove banner image"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Authentic WhatsApp Phone Screen Preview & Editor Container */}
          <div
            style={{
              background: "#0d1f18",
              borderRadius: "12px",
              padding: "1rem",
              border: "1px solid rgba(37, 211, 102, 0.25)",
              boxShadow: "inset 0 2px 6px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              flex: 1,
            }}
          >
            {/* WhatsApp Header Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: "10px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img
                  src="/extrahand_app_icon_white_bg.png"
                  alt={`${branding.company_name} logo`}
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: "#ffffff",
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>{branding.company_name} Official</div>
                  <div style={{ color: "#25D366", fontSize: "11px" }}>Verified Business Account · Meta API</div>
                </div>
              </div>
              <span
                style={{
                  fontSize: "10px",
                  background: bubbleMode === "edit" ? "rgba(37, 211, 102, 0.2)" : "rgba(56, 189, 248, 0.2)",
                  color: bubbleMode === "edit" ? "#4ade80" : "#38bdf8",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  fontWeight: 600,
                }}
              >
                {bubbleMode === "edit" ? "✏️ Editable Bubble" : "👁️ Rendered Sample"}
              </span>
            </div>

            {/* Editable WhatsApp Green Message Bubble */}
            <div
              style={{
                background: "#16382a",
                borderRadius: "8px 8px 8px 0px",
                padding: "0.85rem 1rem",
                color: "#e6f4ea",
                fontSize: "13.5px",
                lineHeight: "1.55",
                borderLeft: "3.5px solid #25D366",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                display: "flex",
                flexDirection: "column",
                flex: 1,
              }}
            >
              {/* WhatsApp Message Header Image / Banner Preview */}
              {(bannerImageUrl || isMetaTemplate) && (
                <div
                  style={{
                    marginBottom: "10px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    background: "#0d281e",
                    position: "relative",
                  }}
                >
                  <img
                    src={bannerImageUrl || "/extrahand_whatsapp_header.jpg"}
                    alt="Template Header Banner"
                    style={{
                      width: "100%",
                      maxHeight: "150px",
                      objectFit: bannerImageUrl ? "cover" : "contain",
                      background: "#ffffff",
                      display: "block",
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/extrahand_whatsapp_header.jpg";
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "4px",
                      right: "6px",
                      fontSize: "9px",
                      background: "rgba(0,0,0,0.65)",
                      color: "#fff",
                      padding: "1px 5px",
                      borderRadius: "3px",
                    }}
                  >
                    {bannerImageUrl ? "Custom Uploaded Banner" : "ExtraHand Header (default)"}
                  </div>
                </div>
              )}

              {bubbleMode === "edit" && !isMetaTemplate ? (
                <textarea
                  ref={textareaRef}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type or customize your WhatsApp message here..."
                  style={{
                    width: "100%",
                    flex: 1,
                    minHeight: "190px",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#e6f4ea",
                    fontSize: "13.5px",
                    lineHeight: "1.6",
                    fontFamily: "inherit",
                    resize: "none",
                    padding: 0,
                  }}
                />
              ) : (
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, minHeight: "190px", lineHeight: "1.6" }}>
                  {previewText}
                </div>
              )}

              {/* WhatsApp Template Button Preview (Meta approved templates only) */}
              {isMetaTemplate && (
                <div
                  style={{
                    marginTop: "10px",
                    paddingTop: "8px",
                    borderTop: "1px solid rgba(255, 255, 255, 0.12)",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(37, 211, 102, 0.15)",
                      color: "#25D366",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid rgba(37, 211, 102, 0.3)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>🔗 View Task / Open ExtraHand</span>
                  </div>
                </div>
              )}

              {/* Timestamp & double checkmarks */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "4px",
                  marginTop: "8px",
                  fontSize: "11px",
                  color: "#86efac",
                }}
              >
                <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <CheckCheck size={14} style={{ color: "#38bdf8" }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", fontSize: "11px", color: "rgba(255, 255, 255, 0.6)" }}>
              <span>{messageText.length} characters · {messageText.trim().split(/\s+/).filter(Boolean).length} words</span>
              <span>
                {bubbleMode === "edit" ? "✏️ Type directly above to edit" : "👁️ Showing sample values"}
              </span>
            </div>
          </div>
        </div>

        {/* =========================================================
            COLUMN 2 (RIGHT): 2ND ONE IS RECIPIENTS INPUT SIDE-BY-SIDE
            ========================================================= */}
        <div
          className="agent-box"
          style={{
            background: "var(--card-bg, #ffffff)",
            padding: "1.25rem",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            boxSizing: "border-box",
            gap: "12px",
          }}
        >
          {/* Header & Mode Switcher */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: "36px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Users size={18} style={{ color: "var(--brand)" }} />
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>2. Recipients Input</h3>
            </div>

            {/* Mode Switcher Tabs */}
            <div style={{ display: "flex", background: "var(--raised, #f1f5f9)", padding: "3px", borderRadius: "8px", gap: "4px" }}>
              <button
                type="button"
                className={`btn btn-sm ${inputMode === "manual" ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: "12px", height: "30px", padding: "0 10px" }}
                onClick={() => setInputMode("manual")}
              >
                <UserPlus size={13} style={{ marginRight: "4px" }} />
                <span>Manual Entry</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inputMode === "excel" ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: "12px", height: "30px", padding: "0 10px" }}
                onClick={() => setInputMode("excel")}
              >
                <FileSpreadsheet size={13} style={{ marginRight: "4px" }} />
                <span>Excel / CSV Upload</span>
              </button>
            </div>
          </div>

          {/* TAB 1: MANUAL ENTRY */}
          {inputMode === "manual" && (
            <div>
              <form onSubmit={handleAddManualContact} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: "8px", alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                      Recipient Name (Optional)
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Full name"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      style={{ width: "100%", height: "36px" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                      Phone (with Country Code)
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        className="input"
                        placeholder={`Phone number (${cc} added if missing)`}
                        value={manualPhone}
                        onChange={(e) => setManualPhone(e.target.value)}
                        style={{ width: "100%", height: "36px", paddingRight: "28px" }}
                      />
                      {manualPhone.trim() && (
                        <span
                          style={{
                            position: "absolute",
                            right: "8px",
                            top: "50%",
                            transform: "translateY(-50%)",
                          }}
                        >
                          {validatePhone(manualPhone).isValid ? (
                            <CheckCircle2 size={15} style={{ color: "#10b981" }} />
                          ) : (
                            <AlertCircle size={15} style={{ color: "#ef4444" }} />
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-md"
                    style={{ height: "36px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Plus size={15} />
                    <span>Add</span>
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "2px" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                    💡 Tip: numbers without a country code get {cc}.
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "11px", padding: "2px 6px", height: "auto" }}
                    onClick={() => setShowBatchPaste(!showBatchPaste)}
                  >
                    {showBatchPaste ? "Hide Quick Paste" : "Paste Multiple Numbers..."}
                  </button>
                </div>

                {showBatchPaste && (
                  <div
                    style={{
                      background: "var(--raised, #f8fafc)",
                      padding: "8px",
                      borderRadius: "8px",
                      border: "1px dashed var(--border)",
                      marginTop: "2px",
                    }}
                  >
                    <label style={{ fontSize: "11px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                      Paste comma or newline-separated numbers, optionally as "Name: number":
                    </label>
                    <textarea
                      className="input"
                      rows={3}
                      placeholder={"Name: phone number\nName: phone number"}
                      value={batchPasteText}
                      onChange={(e) => setBatchPasteText(e.target.value)}
                      style={{ width: "100%", fontSize: "12px", fontFamily: "monospace" }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setBatchPasteText("");
                          setShowBatchPaste(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleBatchPasteSubmit}
                      >
                        Parse &amp; Add Numbers
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB 2: EXCEL / CSV UPLOAD */}
          {inputMode === "excel" && (
            <div>
              <div
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: "10px",
                  padding: "1.25rem",
                  textAlign: "center",
                  background: "var(--raised, #f8fafc)",
                  cursor: "pointer",
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls,.csv,.tsv,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />

                <div style={{ display: "inline-flex", padding: "10px", background: "rgba(37, 211, 102, 0.12)", borderRadius: "50%", marginBottom: "6px", color: "#25D366" }}>
                  <Upload size={20} />
                </div>

                <h4 style={{ margin: "0 0 2px 0", fontSize: "0.9rem", fontWeight: 700 }}>
                  {isUploading ? "Uploading and parsing contacts..." : "Upload Spreadsheet (.xlsx, .xls, .csv)"}
                </h4>
                <p className="text-xs muted" style={{ margin: "0 0 10px 0" }}>
                  Drag &amp; drop your Excel contact list or click to browse files.
                </p>

                <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    disabled={isUploading}
                  >
                    <FileSpreadsheet size={13} />
                    <span>{isUploading ? "Reading Rows..." : "Select Excel File"}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadSample();
                    }}
                  >
                    <Download size={13} />
                    <span>Sample CSV</span>
                  </button>
                </div>
              </div>

              {uploadedFileName && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: "8px",
                    padding: "6px 10px",
                    background: "rgba(16, 185, 129, 0.08)",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#059669", fontWeight: 500 }}>
                    <CheckCircle2 size={13} />
                    <span>Loaded: <b>{uploadedFileName}</b></span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 6px", height: "auto" }}
                    onClick={() => setUploadedFileName(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* RECIPIENT CONTACTS TABLE */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px", display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700 }}>
                  Recipient Contacts ({contacts.length})
                </span>
                {invalidContacts.length > 0 && (
                  <span className="badge" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: "10px" }}>
                    {invalidContacts.length} Invalid
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {contacts.length > 5 && (
                  <div style={{ position: "relative" }}>
                    <Search size={12} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                    <input
                      type="text"
                      className="input"
                      placeholder="Filter..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ height: "26px", fontSize: "11px", paddingLeft: "24px", width: "110px" }}
                    />
                  </div>
                )}

                {invalidContacts.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "11px", color: "#ef4444", height: "26px", padding: "0 6px" }}
                    onClick={handleRemoveInvalid}
                    title="Remove invalid phone numbers"
                  >
                    Clean Invalid
                  </button>
                )}

                {contacts.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "11px", height: "26px", padding: "0 6px" }}
                    onClick={handleClearAll}
                    title="Clear all contacts"
                  >
                    <Trash2 size={12} />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable contacts table */}
            <div
              style={{
                maxHeight: "310px",
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                background: "var(--bg)",
                flex: 1,
              }}
            >
              {filteredContacts.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
                  {searchQuery ? "No contacts match your filter." : "No recipients added yet. Add manually or upload an Excel file above."}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "var(--raised, #f8fafc)", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: "11px" }}>
                      <th style={{ padding: "6px 8px", width: "30px" }}>#</th>
                      <th style={{ padding: "6px 8px" }}>Name</th>
                      <th style={{ padding: "6px 8px" }}>Phone</th>
                      <th style={{ padding: "6px 8px" }}>Status</th>
                      <th style={{ padding: "6px 8px", width: "35px", textAlign: "center" }}>Act</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c, i) => (
                      <tr
                        key={c.id}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          background: c.isValid ? "transparent" : "rgba(239, 68, 68, 0.04)",
                        }}
                      >
                        <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{i + 1}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.name || <span className="muted">—</span>}</td>
                        <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{c.formattedPhone || c.phone}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {c.isValid ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: "rgba(16, 185, 129, 0.1)",
                                color: "#059669",
                                border: "1px solid rgba(16, 185, 129, 0.25)",
                                borderRadius: "9999px",
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              <CheckCircle2 size={11} />
                              <span>{c.reason || "Valid"}</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: "rgba(239, 68, 68, 0.1)",
                                color: "#dc2626",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                borderRadius: "9999px",
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              <AlertCircle size={11} />
                              <span>{c.reason || "Invalid"}</span>
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: "2px", height: "auto", color: "var(--muted)" }}
                            onClick={() => handleRemoveContact(c.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================
          SECTION 3: EXECUTION & DISPATCH
          ========================================================= */}
      <div
        className="agent-box"
        style={{
          background: "var(--card-bg, #ffffff)",
          padding: "1.25rem",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Send size={18} style={{ color: "#25D366" }} />
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>3. Execution &amp; Dispatch</h3>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#15803d",
                background: "rgba(37, 211, 102, 0.1)",
                border: "1px solid rgba(37, 211, 102, 0.25)",
                borderRadius: "9999px",
                padding: "2px 10px",
              }}
            >
              <span className="live-dot" style={{ background: "#25D366" }} />
              <span>Cloud Gateway Ready</span>
            </span>

            <span className="badge" style={{ fontSize: "11px" }}>
              Delivery: {status?.delivery_rate || "not tracked"}
            </span>
          </div>
        </div>

        {/* Pre-flight Checklist strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
            padding: "8px 12px",
            background: "var(--raised, #f8fafc)",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            marginBottom: "12px",
            fontSize: "12px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
            {validContacts.length > 0 ? (
              <CheckCircle2 size={14} style={{ color: "#10b981" }} />
            ) : (
              <AlertCircle size={14} style={{ color: "#ef4444" }} />
            )}
            <span>{validContacts.length} valid recipient numbers ready</span>
          </span>

          <span className="muted">·</span>

          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--muted)" }}>
            <CheckCircle2 size={14} style={{ color: messageText.trim() ? "#10b981" : "var(--muted)" }} />
            <span>Message drafted ({messageText.length} characters)</span>
          </span>

          <span className="muted">·</span>

          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: "#15803d" }}>
            <span className="live-dot" style={{ background: "#25D366" }} />
            <span>Ready for WhatsApp Cloud dispatch</span>
          </span>
        </div>

        {/* Progress bar during sending */}
        {isDispatching && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
              <span>Broadcasting messages...</span>
              <span>{dispatchProgress}%</span>
            </div>
            <div style={{ width: "100%", height: "6px", background: "var(--raised)", borderRadius: "3px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${dispatchProgress}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #25D366, #10b981)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* PRIMARY BROADCAST BUTTON */}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={isDispatching || validContacts.length === 0 || !messageText.trim()}
          onClick={handleSendMessages}
          style={{
            width: "100%",
            height: "48px",
            fontSize: "15px",
            fontWeight: 700,
            background: "#25D366",
            borderColor: "#25D366",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            boxShadow: "0 4px 14px rgba(37, 211, 102, 0.35)",
            cursor:
              isDispatching || validContacts.length === 0 || !messageText.trim()
                ? "not-allowed"
                : "pointer",
          }}
        >
          <WhatsAppIcon size={20} />
          <span>
            {isDispatching
              ? `Broadcasting to ${validContacts.length} Contacts...`
              : `Send Messages to (${validContacts.length}) Recipients`}
          </span>
        </button>

        {/* DISPATCH RESULT SUMMARY (If broadcast occurred) */}
        {dispatchResult && (
          <div
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              borderRadius: "10px",
              background: dispatchResult.failed_count === 0 ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.06)",
              border: `1px solid ${dispatchResult.failed_count === 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.2)"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontWeight: 700, fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                <CheckCircle2 size={16} style={{ color: "#10b981" }} />
                <span>Broadcast Complete</span>
              </span>
              <span className="badge" style={{ fontSize: "11px" }}>
                {dispatchResult.total} Total
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", textAlign: "center", margin: "8px 0" }}>
              <div style={{ background: "var(--card-bg, #ffffff)", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)" }}>Sent / Delivered</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#10b981" }}>{dispatchResult.sent_count}</div>
              </div>
              <div style={{ background: "var(--card-bg, #ffffff)", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)" }}>Simulated</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#3b82f6" }}>{dispatchResult.simulated_count}</div>
              </div>
              <div style={{ background: "var(--card-bg, #ffffff)", padding: "8px", borderRadius: "6px", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "10px", color: "var(--muted)" }}>Failed</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#ef4444" }}>{dispatchResult.failed_count}</div>
              </div>
            </div>

            {/* Delivery Logs List */}
            {dispatchResult.results && dispatchResult.results.length > 0 && (
              <div style={{ maxHeight: "150px", overflowY: "auto", borderTop: "1px solid var(--border)", paddingTop: "8px", marginTop: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>Delivery Receipts:</div>
                {dispatchResult.results.slice(0, 10).map((r, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "11px",
                      padding: "3px 0",
                      borderBottom: "1px dashed var(--border)",
                    }}
                  >
                    <span style={{ fontFamily: "monospace" }}>{r.phone} {r.name ? `(${r.name})` : ""}</span>
                    <span
                      className={`badge ${r.status === "sent" ? "tone-success" : r.status === "simulated" ? "tone-info" : "tone-danger"}`}
                      style={{ fontSize: "10px" }}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
                {dispatchResult.results.length > 10 && (
                  <div style={{ fontSize: "10px", color: "var(--muted)", textAlign: "center", marginTop: "4px" }}>
                    + {dispatchResult.results.length - 10} more delivery receipts recorded
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
