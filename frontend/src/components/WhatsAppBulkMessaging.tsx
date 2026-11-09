import React, { useState, useRef, useMemo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CheckCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import { countryDigits, fillTemplate, toE164, useBranding } from "../branding";
import { useToast, WhatsAppIcon } from "./ui";
import { ChannelActiveButton } from "./WhatsAppChannelToggle";
import type {
  BulkMessageResponse,
  BulkRecipient,
  WhatsAppStatus,
} from "../types";

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
  bulkActive?: boolean;
  onToggleBulk?: () => void;
  isTogglingChannel?: string | null;
}

export function WhatsAppBulkMessaging({
  status,
  onRefreshStatus,
  bulkActive = true,
  onToggleBulk,
  isTogglingChannel,
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
  const [messageText, setMessageText] = useState<string>(() =>
    fillTemplate(branding.bulk_message_template, globalVariables)
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [bubbleMode, setBubbleMode] = useState<"edit" | "preview">("edit");

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

    let text = messageText;
    text = text.replace(/\{name\}/g, sampleName);
    text = text.replace(/\{phone\}/g, samplePhone);

    Object.entries(globalVariables).forEach(([key, val]) => {
      const regex = new RegExp(`\\{${key}\\}`, "g");
      text = text.replace(regex, val);
    });

    return text;
  }, [messageText, validContacts, globalVariables]);

  // Dispatch Bulk Messages Trigger
  const handleSendMessages = async () => {
    if (!bulkActive) {
      toast.error(
        "Bulk Messaging Inactive",
        "WhatsApp Bulk Messaging is currently turned OFF. Toggle Bulk Msgs to Active at the top to send messages."
      );
      return;
    }
    if (validContacts.length === 0) {
      toast.error("No Valid Contacts", "Please enter or upload at least one valid phone number.");
      return;
    }
    if (!messageText.trim()) {
      toast.error("Message Empty", "Please write or select a message template to send.");
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
        template_id: undefined,
        variables: globalVariables,
      });

      setDispatchProgress(100);
      setDispatchResult(res);

      const sentCount = (res.sent_count || 0) + (res.simulated_count || 0);
      const failedCount = res.failed_count || 0;
      setSessionSent((prev) => prev + sentCount);
      setSessionFailed((prev) => prev + failedCount);

      if (sentCount > 0) {
        toast.success(
          "Broadcast Dispatched!",
          `Successfully sent ${sentCount} messages (${failedCount} failed).`
        );
      } else {
        toast.error("Broadcast Failed", `All ${failedCount} messages failed delivery.`);
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
            {/* Individual Active / Deactivated Button for Bulk Messaging */}
            <ChannelActiveButton
              channelName="Bulk Messaging"
              isActive={bulkActive}
              onToggle={onToggleBulk}
              isLoading={isTogglingChannel === "bulk"}
            />

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
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: "#25D366",
                    display: "grid",
                    placeItems: "center",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "13px",
                  }}
                >
                  EH
                </div>
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
              {bubbleMode === "edit" ? (
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
                color: bulkActive ? "#15803d" : "#dc2626",
                background: bulkActive ? "rgba(37, 211, 102, 0.1)" : "rgba(239, 68, 68, 0.1)",
                border: bulkActive ? "1px solid rgba(37, 211, 102, 0.25)" : "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "9999px",
                padding: "2px 10px",
              }}
            >
              <span className="live-dot" style={{ background: bulkActive ? "#25D366" : "#ef4444" }} />
              <span>{bulkActive ? "Cloud Gateway Active" : "Bulk Channel Deactivated"}</span>
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

          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", color: bulkActive ? "#15803d" : "#dc2626" }}>
            <span className="live-dot" style={{ background: bulkActive ? "#25D366" : "#ef4444" }} />
            <span>{bulkActive ? "Ready for WhatsApp Cloud dispatch" : "Sending currently paused"}</span>
          </span>
        </div>

        {/* Warning banner when Bulk Messaging is Deactivated */}
        {!bulkActive && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "9px 14px",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1.5px solid rgba(239, 68, 68, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "8px",
              fontSize: "12.5px",
              color: "#991b1b",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={16} style={{ color: "#ef4444", flexShrink: 0 }} />
              <span>
                <strong>Bulk Messaging is DEACTIVATED:</strong> Messages cannot be sent right now. Click the red <strong>Deactivated</strong> button at top right to activate.
              </span>
            </div>
            {onToggleBulk && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onToggleBulk}
                style={{
                  fontSize: "11.5px",
                  padding: "3px 10px",
                  background: "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Turn On Bulk
              </button>
            )}
          </div>
        )}

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
          disabled={isDispatching || validContacts.length === 0 || !messageText.trim() || !bulkActive}
          onClick={handleSendMessages}
          style={{
            width: "100%",
            height: "48px",
            fontSize: "15px",
            fontWeight: 700,
            background: bulkActive ? "#25D366" : "#f87171",
            borderColor: bulkActive ? "#25D366" : "#f87171",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            boxShadow: bulkActive ? "0 4px 14px rgba(37, 211, 102, 0.35)" : "none",
            cursor:
              isDispatching || validContacts.length === 0 || !messageText.trim() || !bulkActive
                ? "not-allowed"
                : "pointer",
          }}
        >
          <WhatsAppIcon size={20} />
          <span>
            {!bulkActive
              ? `🚫 Cannot Send: Bulk Messaging is Deactivated (Click Active button at top right)`
              : isDispatching
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
