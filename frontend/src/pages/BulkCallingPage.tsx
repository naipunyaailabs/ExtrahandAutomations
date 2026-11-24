import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Pause,
  PhoneForwarded,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import { useUrlState } from "../hooks";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Pill, Tabs, useToast } from "../components/ui";
import type { BulkCallItem, BulkCampaign, BulkContact } from "../types";
import "./bulk-calling.css";

// Quick Pre-built Voice Templates (Telugu & English)
const VOICE_TEMPLATES = [
  {
    id: "te_offer",
    name: "🌟 Service Offer (Telugu)",
    lang: "te-IN",
    text: "నమస్కారం! ఎక్స్‌ట్రా హ్యాండ్ నుండి ప్రత్యేక ఆఫర్. మీ ఇంటి పనులకు మరియు రిపేర్ సర్వీసులకు ఇప్పుడే బుక్ చేసుకోండి. మా వెరిఫైడ్ హెల్పర్స్ మీకు అందుబాటులో ఉన్నారు. ధన్యవాదాలు.",
  },
  {
    id: "te_helper_check",
    name: "🔔 Helper Availability (Telugu)",
    lang: "te-IN",
    text: "హలో, ఇది ఎక్స్‌ట్రా హ్యాండ్ టీమ్ నుండి. మీరు ఈరోజు కొత్త ఆర్డర్లు తీసుకోవడానికి అందుబాటులో ఉన్నారా? మీ యాప్‌లో లాగిన్ అయి వెంటనే ఆర్డర్లను చెక్ చేసుకోండి. ధన్యవాదాలు.",
  },
  {
    id: "te_feedback_reminder",
    name: "💬 Customer Care Followup (Telugu)",
    lang: "te-IN",
    text: "నమస్కారం! ఎక్స్‌ట్రా హ్యాండ్ సర్వీస్ ఎలా ఉందో తెలుసుకోవడానికి మేము కాల్ చేశాము. మీ విలువైన అభిప్రాయాన్ని మాకు తెలియజేయండి. ధన్యవాదాలు.",
  },
  {
    id: "en_announcement",
    name: "📢 Promo Announcement (English)",
    lang: "en-IN",
    text: "Hello! This is a special update from ExtraHand services. Verified helpers for cleaning, repairs, and home maintenance are now available near you. Book today on ExtraHand. Thank you.",
  },
];

export default function BulkCallingPage() {
  const toast = useToast();
  // Tab and open campaign live in the URL (?tab=monitor&campaign=12): reload keeps them, Back steps through tabs
  const [activeTab, setActiveTab] = useUrlState<"create" | "monitor">("tab", "create", { push: true });

  // -------------------------------------------------------------------------
  // Campaigns State & Polling
  // -------------------------------------------------------------------------
  const [campaigns, setCampaigns] = useState<BulkCampaign[]>([]);
  const [campaignParam, setCampaignParam] = useUrlState<string>("campaign", "");
  const selectedCampaignId = campaignParam ? Number(campaignParam) || null : null;
  const setSelectedCampaignId = (id: number | null) => setCampaignParam(id == null ? "" : String(id));
  const [activeCampaignDetail, setActiveCampaignDetail] = useState<BulkCampaign | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Check if any campaign is currently active
  const anyActiveCampaign = useMemo(() => {
    return campaigns.find((c) => c.status === "active") || (activeCampaignDetail?.status === "active" ? activeCampaignDetail : null);
  }, [campaigns, activeCampaignDetail]);

  const fetchCampaigns = async () => {
    setIsRefreshing(true);
    try {
      const data = await api.calling.bulk.listCampaigns();
      setCampaigns(data || []);
      if (!selectedCampaignId && data && data.length > 0) {
        setSelectedCampaignId(data[0].id);
      }
    } catch (err: any) {
      console.error("Failed to load campaigns:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchCampaignDetail = async (id: number) => {
    try {
      const data = await api.calling.bulk.getCampaign(id);
      setActiveCampaignDetail(data);
    } catch (err: any) {
      console.error("Failed to load campaign details:", err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchCampaigns();
  }, []);

  // Sync selected campaign detail
  useEffect(() => {
    if (selectedCampaignId) {
      fetchCampaignDetail(selectedCampaignId);
    } else {
      setActiveCampaignDetail(null);
    }
  }, [selectedCampaignId]);

  // Real-time polling when viewing or running an active campaign
  useEffect(() => {
    if (!selectedCampaignId) return;
    const shouldFastPoll = activeCampaignDetail?.status === "active" || campaigns.some((c) => c.status === "active");
    const intervalMs = shouldFastPoll ? 2500 : 10000;

    const timer = setInterval(() => {
      fetchCampaigns();
      if (selectedCampaignId) {
        fetchCampaignDetail(selectedCampaignId);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [selectedCampaignId, activeCampaignDetail?.status, campaigns]);

  // -------------------------------------------------------------------------
  // Form State: Create Campaign
  // -------------------------------------------------------------------------
  const [campaignTitle, setCampaignTitle] = useState("");
  const [scriptText, setScriptText] = useState(VOICE_TEMPLATES[0].text);
  const [voiceLanguage, setVoiceLanguage] = useState("te-IN");

  // Numbers Input Mode: 'manual' | 'excel'
  const [inputMode, setInputMode] = useState<"manual" | "excel">("manual");
  const [contacts, setContacts] = useState<BulkContact[]>([]);

  // Manual inputs
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [batchPasteText, setBatchPasteText] = useState("");
  const [showBatchBox, setShowBatchBox] = useState(false);

  // File upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Table search
  const [contactSearch, setContactSearch] = useState("");

  // Audio Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Number validation helper
  const normalizeLocalPhone = (raw: string): { isValid: boolean; formatted: string; reason: string } => {
    if (!raw || !raw.trim()) return { isValid: false, formatted: "", reason: "Empty phone number" };
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) {
      return { isValid: true, formatted: `+91${digits}`, reason: "Valid (IN)" };
    }
    if (digits.length === 12 && digits.startsWith("91")) {
      return { isValid: true, formatted: `+${digits}`, reason: "Valid (IN)" };
    }
    if (digits.length >= 10) {
      return { isValid: true, formatted: `+${digits}`, reason: "Valid (E.164)" };
    }
    return { isValid: false, formatted: raw.trim(), reason: "Invalid (less than 10 digits)" };
  };

  // Add single manual contact
  const handleAddSingleContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPhone.trim()) {
      toast.warning("Phone Required", "Please enter a phone number.");
      return;
    }
    const { isValid, formatted, reason } = normalizeLocalPhone(manualPhone);
    const newContact: BulkContact = {
      name: manualName.trim() || "Contact",
      phone: manualPhone.trim(),
      formatted: formatted,
      is_valid: isValid,
      reason: reason,
    };
    setContacts((prev) => [newContact, ...prev]);
    setManualPhone("");
    setManualName("");
    if (isValid) {
      toast.success("Recipient Added", `${formatted} added to the list.`);
    } else {
      toast.warning("Check Number Format", `Added but invalid: ${reason}`);
    }
  };

  // Add batch paste numbers
  const handleAddBatchPaste = () => {
    if (!batchPasteText.trim()) return;
    const lines = batchPasteText.split(/[\n,;]+/);
    const added: BulkContact[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let name = "Contact";
      let phone = trimmed;
      if (trimmed.includes(":") || trimmed.includes("=")) {
        const parts = trimmed.split(/[:=]/);
        name = parts[0].trim();
        phone = parts[1].trim();
      }
      const { isValid, formatted, reason } = normalizeLocalPhone(phone);
      added.push({
        name,
        phone,
        formatted,
        is_valid: isValid,
        reason,
      });
    });

    if (added.length > 0) {
      setContacts((prev) => [...added, ...prev]);
      toast.success("Batch Contacts Added", `Parsed ${added.length} recipients.`);
      setBatchPasteText("");
      setShowBatchBox(false);
    }
  };

  // Handle Excel / CSV File Upload
  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadedFileName(file.name);
    try {
      const res = await api.calling.bulk.parseFile(file);
      if (res && res.contacts) {
        setContacts((prev) => [...res.contacts, ...prev]);
        toast.success(
          "File Processed",
          `Imported ${res.total} recipients (${res.valid_count} valid, ${res.invalid_count} invalid).`
        );
      }
    } catch (err: any) {
      toast.error("Upload Failed", err.message || "Could not parse Excel/CSV file.");
    } finally {
      setIsUploading(false);
    }
  };

  // Download Sample CSV
  const handleDownloadSampleCsv = () => {
    const csvContent =
      "data:text/csv;charset=utf-8,Name,Phone\nSuresh Kumar,9876543210\nAnitha Reddy,+919123456789\nRamesh,8877665544\nKavitha,+919988776655\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "bulk_calling_sample_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Audio Preview via Sarvam TTS
  const handlePreviewAudio = async () => {
    if (!scriptText.trim()) {
      toast.warning("Empty Script", "Please enter some script text first.");
      return;
    }

    if (isPlayingAudio && audioRef.current) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
      return;
    }

    setIsPreviewLoading(true);
    try {
      const res = await fetch(api.calling.bulk.previewAudioUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptText, language: voiceLanguage }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server returned ${res.status}`);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => {
        setIsPlayingAudio(false);
        toast.error("Playback Error", "Failed to play voice preview audio.");
      };
      await audio.play();
      setIsPlayingAudio(true);
      toast.success("Playing Voice Preview", `Synthesized voice using Sarvam AI (${voiceLanguage}).`);
    } catch (err: any) {
      toast.error("Audio Preview Failed", err.message || "Failed to synthesize voice preview.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Submit / Create Campaign
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleCreateCampaign = async () => {
    const validContacts = contacts.filter((c) => c.is_valid);
    if (!scriptText.trim()) {
      toast.error("Missing Script", "Please enter the voice script text.");
      return;
    }
    if (validContacts.length === 0) {
      toast.error("No Valid Recipients", "Please add at least one valid phone number before creating campaign.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title:
          campaignTitle.trim() || `Campaign ${new Date().toLocaleDateString("en-IN")} (${validContacts.length} calls)`,
        script: scriptText.trim(),
        language: voiceLanguage,
        contacts: validContacts.map((c) => ({
          name: c.name || "Contact",
          phone: c.formatted || c.phone,
        })),
      };

      const result = await api.calling.bulk.createCampaign(payload);
      toast.success("Campaign Created (INACTIVE)", "Campaign created safely in Inactive state. Ready for activation!");

      await fetchCampaigns();
      setSelectedCampaignId(result.id);
      setActiveTab("monitor");

      setCampaignTitle("");
      setContacts([]);
      setUploadedFileName(null);
    } catch (err: any) {
      toast.error("Failed to Create Campaign", err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Campaign Actions (Activate / Deactivate / Cancel / Delete)
  // -------------------------------------------------------------------------
  const handleActivateCampaign = async (id: number) => {
    setActionInProgress(`activate_${id}`);
    try {
      await api.calling.bulk.activateCampaign(id);
      toast.success("Agent Activated ▶", "Bulk Calling Agent is now calling contacts ONE BY ONE sequentially.");
      await fetchCampaignDetail(id);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Activation Failed", err.message || "Failed to start bulk calls.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeactivateCampaign = async (id: number) => {
    setActionInProgress(`deactivate_${id}`);
    try {
      await api.calling.bulk.deactivateCampaign(id);
      toast.warning("Agent Paused ⏸", "Bulk Calling Agent paused. The ongoing call will finish, then subsequent dials halt.");
      await fetchCampaignDetail(id);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Deactivation Failed", err.message || "Failed to pause agent.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancelCampaign = async (id: number) => {
    if (!window.confirm("Are you sure you want to cancel remaining calls for this campaign?")) return;
    setActionInProgress(`cancel_${id}`);
    try {
      await api.calling.bulk.cancelCampaign(id);
      toast.info("Campaign Cancelled", "Remaining calls marked as cancelled.");
      await fetchCampaignDetail(id);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Cancellation Failed", err.message || "Failed to cancel campaign.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleResetCampaign = async (id: number) => {
    setActionInProgress(`reset_${id}`);
    try {
      await api.calling.bulk.resetCampaign(id);
      toast.success("Campaign Reset", "All contacts reset to pending. Click 'Activate Agent' to re-dial.");
      await fetchCampaignDetail(id);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Reset Failed", err.message || "Failed to reset campaign.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRetryFailed = async (id: number) => {
    setActionInProgress(`retry_${id}`);
    try {
      const res = await api.calling.bulk.retryFailed(id);
      toast.success("Failed Contacts Reset", `${res.retried_count} failed contacts reset to pending. Click 'Activate Agent' to re-dial.`);
      await fetchCampaignDetail(id);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Retry Failed", err.message || "Failed to reset failed contacts.");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteCampaign = async (id: number) => {
    if (!window.confirm("Permanently delete this campaign and call records?")) return;
    setActionInProgress(`delete_${id}`);
    try {
      await api.calling.bulk.deleteCampaign(id);
      toast.success("Campaign Deleted", "Campaign removed successfully.");
      setSelectedCampaignId(null);
      await fetchCampaigns();
    } catch (err: any) {
      toast.error("Delete Failed", err.message || "Failed to delete campaign.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Contacts stats for create view
  const validContactsCount = useMemo(() => contacts.filter((c) => c.is_valid).length, [contacts]);
  const invalidContactsCount = contacts.length - validContactsCount;

  // Filtered contacts in create view
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) => (c.name && c.name.toLowerCase().includes(q)) || c.phone.includes(q) || (c.formatted && c.formatted.includes(q))
    );
  }, [contacts, contactSearch]);

  // Selected Campaign Metrics
  const campaignMetrics = useMemo(() => {
    if (!activeCampaignDetail) return { total: 0, completed: 0, failed: 0, calling: 0, pending: 0, percent: 0 };
    const items = activeCampaignDetail.contacts || [];
    const total = activeCampaignDetail.total_contacts || items.length;
    const completed = items.filter((i) => i.status === "completed").length;
    const failed = items.filter((i) => ["failed", "busy", "no_answer"].includes(i.status)).length;
    const calling = items.filter((i) => i.status === "calling").length;
    const pending = items.filter((i) => i.status === "pending").length;
    const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
    return { total, completed, failed, calling, pending, percent };
  }, [activeCampaignDetail]);

  const scriptWords = scriptText.split(/\s+/).filter(Boolean).length;
  const scriptSecs = Math.round(scriptWords / 2.5);
  const steps = [
    { n: 1, label: "Details & voice", done: campaignTitle.trim().length > 0 },
    { n: 2, label: "Voice script", done: scriptText.trim().length > 0 },
    { n: 3, label: "Recipients", done: validContactsCount > 0 },
  ];
  const readyToCreate = !isSubmitting && validContactsCount > 0 && !!scriptText.trim();

  return (
    <Stagger className="page bc-page">
      {/* Header: title, engine status and refresh in one band */}
      <motion.section variants={itemVariants} className={`bc-hero ${anyActiveCampaign ? "is-live" : ""}`}>
        <div className="bc-hero-icon">
          {anyActiveCampaign ? <PhoneOutgoing size={24} className="animate-pulse" /> : <PhoneForwarded size={24} />}
          {anyActiveCampaign && <span className="bc-hero-ping" />}
        </div>
        <div className="bc-hero-text">
          <div className="bc-hero-title">
            <h1>Bulk Calling Agent</h1>
            <span className={`bc-status ${anyActiveCampaign ? "is-on" : ""}`}>
              <i />
              {anyActiveCampaign ? "Dialing one by one" : "Idle"}
            </span>
          </div>
          <p>
            {anyActiveCampaign ? (
              <>Now calling for <strong>"{anyActiveCampaign.title}"</strong>. Each call plays your Sarvam voice message, then moves to the next number.</>
            ) : (
              <>Voice broadcasts in Telugu or English. Write a script, add numbers or an Excel file, and the agent dials them one by one. Separate from automatic dispatch: no calls go out until you activate a campaign.</>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            fetchCampaigns();
            if (selectedCampaignId) fetchCampaignDetail(selectedCampaignId);
          }}
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} /> Refresh
        </Button>
      </motion.section>

      {/* Main Tabs Navigation */}
      <motion.div variants={itemVariants}>
        <Tabs
          value={activeTab}
          onChange={(val) => setActiveTab(val as "create" | "monitor")}
          items={[
            { key: "create", label: "Create New Campaign" },
            { key: "monitor", label: "Live Dialing & Campaigns", count: campaigns.length },
          ]}
        />
      </motion.div>

      {/* =========================================================================
          TAB 1: CREATE NEW CAMPAIGN
         ========================================================================= */}
      {activeTab === "create" && (
        <motion.div key="create_view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          className="bc-create">
          {/* Progress through the three steps */}
          <ol className="bc-steps">
            {steps.map((st, i) => (
              <li key={st.n} className={st.done ? "is-done" : ""}>
                <span className="bc-step-dot">{st.done ? <Check size={14} /> : st.n}</span>
                <span>{st.label}</span>
                {i < steps.length - 1 && <span className="bc-step-line" />}
              </li>
            ))}
          </ol>

          <div className="bc-grid">
            {/* Left: details + script */}
            <div className="bc-col">
              <section className="bc-card">
                <header className="bc-card-head">
                  <span className={`bc-num ${steps[0].done ? "is-done" : ""}`}>{steps[0].done ? <Check size={14} /> : 1}</span>
                  <div>
                    <h3>Campaign details &amp; voice</h3>
                    <p>Name the campaign and pick the voice language.</p>
                  </div>
                </header>

                <label className="bc-field">
                  <span>Campaign title</span>
                  <input type="text" className="input" placeholder="e.g. Special Service Offer – Hyderabad Helpers"
                    value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} />
                </label>

                <div className="bc-field">
                  <span>Voice language</span>
                  <div className="bc-lang">
                    {[
                      { v: "te-IN", glyph: "అ", title: "Telugu", sub: "Sarvam Bulbul AI" },
                      { v: "en-IN", glyph: "A", title: "English", sub: "Indian accent" },
                    ].map((l) => (
                      <button key={l.v} type="button" className={`bc-lang-opt ${voiceLanguage === l.v ? "is-active" : ""}`}
                        onClick={() => setVoiceLanguage(l.v)} aria-pressed={voiceLanguage === l.v}>
                        <span className="bc-lang-glyph">{l.glyph}</span>
                        <span><b>{l.title}</b><small>{l.sub}</small></span>
                        {voiceLanguage === l.v && <Check size={15} className="bc-lang-check" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bc-mode">
                  <Volume2 size={15} />
                  <span><b>Broadcast IVR</b> · plays your message, then hangs up</span>
                </div>
              </section>

              <section className="bc-card">
                <header className="bc-card-head">
                  <span className={`bc-num ${steps[1].done ? "is-done" : ""}`}>{steps[1].done ? <Check size={14} /> : 2}</span>
                  <div>
                    <h3>Voice script</h3>
                    <p>Start from a template or write your own message.</p>
                  </div>
                </header>

                <div className="bc-templates">
                  {VOICE_TEMPLATES.map((tmpl) => {
                    const [emoji, ...rest] = tmpl.name.split(" ");
                    const active = scriptText === tmpl.text;
                    return (
                      <button key={tmpl.id} type="button" className={`bc-tmpl ${active ? "is-active" : ""}`}
                        onClick={() => {
                          setScriptText(tmpl.text);
                          setVoiceLanguage(tmpl.lang);
                          toast.info("Template loaded", `Loaded "${rest.join(" ")}".`);
                        }}>
                        <span className="bc-tmpl-emoji">{emoji}</span>
                        <span className="bc-tmpl-name">{rest.join(" ").replace(/\s*\((Telugu|English)\)/, "")}</span>
                        <span className="bc-tmpl-lang">{tmpl.lang === "te-IN" ? "Telugu" : "English"}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="bc-script">
                  <textarea rows={6} className="input" placeholder="What should the agent say when the person answers?"
                    value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
                  <div className="bc-script-foot">
                    <span>{scriptText.length} characters</span>
                    <span>≈ {scriptSecs}s spoken</span>
                  </div>
                </div>

                <div className={`bc-preview ${isPlayingAudio ? "is-playing" : ""}`}>
                  <div className="bc-wave" aria-hidden>
                    {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
                  </div>
                  <div className="bc-preview-text">
                    <b>Hear it first</b>
                    <span>Sarvam AI reads your script in the chosen voice.</span>
                  </div>
                  <Button size="sm" variant={isPlayingAudio ? "danger" : "primary"}
                    disabled={isPreviewLoading || !scriptText.trim()} onClick={handlePreviewAudio}>
                    {isPreviewLoading ? (<><Loader2 size={14} className="animate-spin" /> Preparing…</>)
                      : isPlayingAudio ? (<><Square size={14} /> Stop</>)
                      : (<><Play size={14} /> Preview audio</>)}
                  </Button>
                </div>
              </section>
            </div>

            {/* Right: recipients + summary */}
            <div className="bc-col">
              <section className="bc-card">
                <header className="bc-card-head">
                  <span className={`bc-num ${steps[2].done ? "is-done" : ""}`}>{steps[2].done ? <Check size={14} /> : 3}</span>
                  <div>
                    <h3>Recipients</h3>
                    <p>Type numbers, paste a list, or upload Excel / CSV.</p>
                  </div>
                </header>

                <div className="bc-seg" role="tablist">
                  <button type="button" role="tab" aria-selected={inputMode === "manual"} className={inputMode === "manual" ? "is-active" : ""}
                    onClick={() => setInputMode("manual")}>
                    <Plus size={15} /> Type or paste
                  </button>
                  <button type="button" role="tab" aria-selected={inputMode === "excel"} className={inputMode === "excel" ? "is-active" : ""}
                    onClick={() => setInputMode("excel")}>
                    <FileSpreadsheet size={15} /> Excel / CSV
                  </button>
                </div>

                {inputMode === "manual" && (
                  <div className="bc-manual">
                    <form onSubmit={handleAddSingleContact} className="bc-add">
                      <label className="bc-field">
                        <span>Name</span>
                        <input type="text" className="input" placeholder="e.g. Ramesh" value={manualName}
                          onChange={(e) => setManualName(e.target.value)} />
                      </label>
                      <label className="bc-field">
                        <span>Phone number</span>
                        <div className="bc-phone">
                          <span>+91</span>
                          <input type="tel" className="input" placeholder="98765 43210" value={manualPhone}
                            onChange={(e) => setManualPhone(e.target.value)} />
                        </div>
                      </label>
                      <Button type="submit" variant="primary" size="md"><Plus size={16} /> Add</Button>
                    </form>

                    {!showBatchBox ? (
                      <button type="button" className="bc-link" onClick={() => setShowBatchBox(true)}>
                        <Plus size={13} /> Paste many numbers at once
                      </button>
                    ) : (
                      <div className="bc-batch">
                        <span>One per line or comma separated. Add a name after the number if you like.</span>
                        <textarea rows={4} className="input" placeholder={"9876543210\n9988776655, Suresh\n+919123456789"}
                          value={batchPasteText} onChange={(e) => setBatchPasteText(e.target.value)} />
                        <div className="bc-batch-actions">
                          <Button size="sm" variant="ghost" onClick={() => setShowBatchBox(false)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={handleAddBatchPaste}>Add all</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {inputMode === "excel" && (
                  <div className="bc-manual">
                    <div className={`bc-drop ${isUploading ? "is-busy" : ""}`} role="button" tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("is-over"); }}
                      onDragLeave={(e) => e.currentTarget.classList.remove("is-over")}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("is-over");
                        if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                      }}>
                      <input ref={fileInputRef} type="file" accept=".xlsx, .xls, .csv, .txt" style={{ display: "none" }}
                        onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
                      <span className="bc-drop-icon">{isUploading ? <Loader2 size={24} className="animate-spin" /> : <FileSpreadsheet size={24} />}</span>
                      <b>{isUploading ? "Reading your file…" : "Drop your Excel or CSV here"}</b>
                      <span>or click to browse · .xlsx, .xls, .csv with "Name" and "Phone" columns</span>
                    </div>
                    <div className="bc-drop-foot">
                      <span>{uploadedFileName ? <>Last file: <b>{uploadedFileName}</b></> : "No file chosen"}</span>
                      <button type="button" className="bc-link" onClick={handleDownloadSampleCsv}>
                        <Download size={13} /> Sample template
                      </button>
                    </div>
                  </div>
                )}

                <div className="bc-stats">
                  <div><b>{contacts.length}</b><span>Added</span></div>
                  <div className="is-good"><b>{validContactsCount}</b><span>Valid (+91)</span></div>
                  <div className={invalidContactsCount > 0 ? "is-bad" : ""}><b>{invalidContactsCount}</b><span>Invalid</span></div>
                  {contacts.length > 0 && (
                    <button type="button" className="bc-clear" onClick={() => setContacts([])} title="Remove all numbers">
                      <Trash2 size={14} /> Clear
                    </button>
                  )}
                </div>

                {contacts.length > 0 ? (
                  <div className="bc-list-wrap">
                    <div className="bc-search">
                      <Search size={14} />
                      <input type="text" className="input" placeholder="Search added numbers…" value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)} />
                    </div>
                    <ul className="bc-list">
                      {filteredContacts.slice(0, 100).map((c, idx) => (
                        <li key={`${c.phone}_${idx}`} className={c.is_valid ? "" : "is-invalid"}>
                          <span className="bc-avatar">{(c.name || "#").trim().charAt(0).toUpperCase()}</span>
                          <span className="bc-who">
                            <b>{c.name || "Contact"}</b>
                            <span className="mono">{c.formatted || c.phone}</span>
                          </span>
                          <Pill value={c.is_valid ? "valid" : "invalid"} label={c.is_valid ? "Valid" : (c.reason || "Invalid")}
                            tone={c.is_valid ? "success" : "danger"} />
                          <button type="button" className="bc-remove" aria-label={`Remove ${c.name || c.phone}`}
                            onClick={() => setContacts((prev) => prev.filter((x) => x !== c))}>
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {filteredContacts.length > 100 && <p className="bc-more">Showing 100 of {filteredContacts.length}. Search to find others.</p>}
                  </div>
                ) : (
                  <div className="bc-empty">
                    <span className="bc-empty-icon"><PhoneOff size={22} /></span>
                    <b>No numbers yet</b>
                    <span>Add a number above, paste a list, or upload an Excel file.</span>
                  </div>
                )}
              </section>

              {/* Summary + create */}
              <section className={`bc-card bc-summary ${readyToCreate ? "is-ready" : ""}`}>
                <div className="bc-summary-top">
                  <div>
                    <span className="bc-eyebrow">Campaign summary</span>
                    <h3>{campaignTitle.trim() || "Untitled campaign"}</h3>
                  </div>
                  <div className="bc-summary-count">
                    <b>{validContactsCount}</b>
                    <span>calls</span>
                  </div>
                </div>
                <dl className="bc-summary-facts">
                  <div><dt>Voice</dt><dd>{voiceLanguage === "te-IN" ? "Telugu" : "English"}</dd></div>
                  <div><dt>Message</dt><dd>≈ {scriptSecs}s</dd></div>
                  <div><dt>Starts as</dt><dd>Inactive</dd></div>
                </dl>
                <Button variant="primary" size="md" className="bc-create-btn" disabled={!readyToCreate} onClick={handleCreateCampaign}>
                  {isSubmitting ? (<><Loader2 size={18} className="animate-spin" /> Creating campaign…</>)
                    : (<><Check size={18} /> Create campaign</>)}
                </Button>
                <p className="bc-note">
                  {validContactsCount === 0
                    ? "Add at least one valid number to create the campaign."
                    : <>Nothing is dialed yet. Start it from <b>Live Dialing &amp; Campaigns</b> when you are ready.</>}
                </p>
              </section>
            </div>
          </div>
        </motion.div>
      )}

      {/* =========================================================================
          TAB 2: CAMPAIGNS & LIVE SEQUENTIAL DIALING MONITOR
         ========================================================================= */}
      {activeTab === "monitor" && (
        <motion.div
          key="monitor_view"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" }}
        >
          {/* Left Column: Campaigns List */}
          <div
            className="card"
            style={{ borderRadius: 12, padding: "18px 20px", maxHeight: "80vh", overflowY: "auto" }}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>
              Campaigns History ({campaigns.length})
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {campaigns.length === 0 ? (
                <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 13 }}>
                  No bulk campaigns created yet. Click "Create New Campaign" to start.
                </div>
              ) : (
                campaigns.map((c) => {
                  const isSelected = selectedCampaignId === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCampaignId(c.id)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: isSelected
                          ? "1px solid rgba(59, 130, 246, 0.6)"
                          : "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                        background: isSelected
                          ? "rgba(59, 130, 246, 0.08)"
                          : "rgba(255, 255, 255, 0.02)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: isSelected ? "#93c5fd" : "inherit" }}>
                          {c.title}
                        </div>
                        <Pill
                          value={c.status}
                          label={c.status.toUpperCase()}
                          tone={
                            c.status === "active"
                              ? "live"
                              : c.status === "completed"
                              ? "success"
                              : c.status === "paused"
                              ? "warn"
                              : "neutral"
                          }
                        />
                      </div>

                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                        {c.created_at ? new Date(c.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "Recent"}
                        {" • "}
                        {c.language}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
                        <span>
                          {c.completed_calls} / {c.total_contacts} completed
                        </span>
                        <span>{c.total_contacts > 0 ? Math.round((c.completed_calls / c.total_contacts) * 100) : 0}%</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active Campaign Detail & Real-Time Sequential Dialing */}
          {activeCampaignDetail ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Campaign Header & Master Actions */}
              <div className="card" style={{ borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{activeCampaignDetail.title}</h2>
                        <Pill
                          value={activeCampaignDetail.status}
                          label={
                            activeCampaignDetail.status === "active"
                              ? "DIALING ONE-BY-ONE"
                              : activeCampaignDetail.status.toUpperCase()
                          }
                          tone={
                            activeCampaignDetail.status === "active"
                              ? "live"
                              : activeCampaignDetail.status === "completed"
                              ? "success"
                              : activeCampaignDetail.status === "paused"
                              ? "warn"
                              : "neutral"
                          }
                        />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        Created: {activeCampaignDetail.created_at ? new Date(activeCampaignDetail.created_at).toLocaleString() : "N/A"}
                        {" • "}Language: <strong>{activeCampaignDetail.language}</strong>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {activeCampaignDetail.status === "active" ? (
                        <Button
                          variant="danger"
                          size="md"
                          disabled={actionInProgress === `deactivate_${activeCampaignDetail.id}`}
                          onClick={() => handleDeactivateCampaign(activeCampaignDetail.id)}
                          style={{ fontWeight: 600 }}
                        >
                          <Pause size={16} style={{ marginRight: 6 }} /> Deactivate / Pause Agent
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="md"
                          disabled={
                            actionInProgress === `activate_${activeCampaignDetail.id}` ||
                            activeCampaignDetail.status === "completed" ||
                            activeCampaignDetail.status === "cancelled"
                          }
                          onClick={() => handleActivateCampaign(activeCampaignDetail.id)}
                          style={{
                            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                            borderColor: "#10b981",
                            color: "#fff",
                            fontWeight: 600,
                          }}
                        >
                          <Play size={16} style={{ marginRight: 6 }} /> Activate Agent / Start Dialing
                        </Button>
                      )}

                      {activeCampaignDetail.status !== "completed" && activeCampaignDetail.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="md"
                          disabled={actionInProgress === `cancel_${activeCampaignDetail.id}`}
                          onClick={() => handleCancelCampaign(activeCampaignDetail.id)}
                          title="Cancel remaining calls"
                        >
                          <XCircle size={16} color="#ef4444" />
                        </Button>
                      )}

                      {campaignMetrics.failed > 0 && activeCampaignDetail.status !== "active" && (
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={actionInProgress === `retry_${activeCampaignDetail.id}`}
                          onClick={() => handleRetryFailed(activeCampaignDetail.id)}
                          style={{ fontWeight: 600, borderColor: "#f87171", color: "#ef4444" }}
                          title="Re-dial only the contacts that failed or couldn't connect"
                        >
                          <RefreshCw size={15} style={{ marginRight: 6 }} /> Retry Failed ({campaignMetrics.failed})
                        </Button>
                      )}

                      {(activeCampaignDetail.status === "completed" || activeCampaignDetail.status === "cancelled") && (
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={actionInProgress === `reset_${activeCampaignDetail.id}`}
                          onClick={() => handleResetCampaign(activeCampaignDetail.id)}
                          style={{ fontWeight: 600 }}
                          title="Reset contacts back to pending to re-dial"
                        >
                          <RefreshCw size={15} style={{ marginRight: 6 }} /> Reset & Re-dial
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="md"
                        disabled={actionInProgress === `delete_${activeCampaignDetail.id}`}
                        onClick={() => handleDeleteCampaign(activeCampaignDetail.id)}
                        title="Delete campaign"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                      <span>
                        Calling Progress: <strong>{campaignMetrics.completed + campaignMetrics.failed}</strong> of{" "}
                        <strong>{campaignMetrics.total}</strong> recipients finished
                      </span>
                      <span style={{ fontWeight: 700 }}>{campaignMetrics.percent}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 10,
                        background: "rgba(255, 255, 255, 0.08)",
                        borderRadius: 6,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${campaignMetrics.percent}%`,
                          height: "100%",
                          background:
                            activeCampaignDetail.status === "active"
                              ? "linear-gradient(90deg, #3b82f6, #10b981)"
                              : "#3b82f6",
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                  </div>

                  {/* BIG KPI METRIC CARDS (Requested by User) */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(5, 1fr)",
                      gap: 12,
                      marginTop: 4,
                    }}
                  >
                    {/* Card 1: Total */}
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                        Total Contacts
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#3b82f6" }}>
                        {campaignMetrics.total}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>In campaign</div>
                    </div>

                    {/* Card 2: Calling Now */}
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        background:
                          campaignMetrics.calling > 0 ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.03)",
                        border:
                          campaignMetrics.calling > 0
                            ? "1px solid rgba(16, 185, 129, 0.4)"
                            : "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                        Calling Now
                      </div>
                      <div
                        style={{
                          fontSize: 24,
                          fontWeight: 700,
                          marginTop: 4,
                          color: campaignMetrics.calling > 0 ? "#10b981" : "inherit",
                        }}
                      >
                        {campaignMetrics.calling}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {campaignMetrics.calling > 0 ? "Line connected" : "Idle"}
                      </div>
                    </div>

                    {/* Card 3: Completed */}
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                        Completed
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#10b981" }}>
                        {campaignMetrics.completed}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Spoken &amp; finished</div>
                    </div>

                    {/* Card 4: Failed */}
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                        Failed / Busy
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#ef4444" }}>
                        {campaignMetrics.failed}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>No answer / unreachable</div>
                    </div>

                    {/* Card 5: Pending */}
                    <div
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                        Pending Queue
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#f59e0b" }}>
                        {campaignMetrics.pending}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Next in sequence</div>
                    </div>
                  </div>

                  {/* Script Excerpt */}
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "var(--muted)", marginRight: 6 }}>Voice Script:</span>
                    <span style={{ fontStyle: "italic" }}>"{activeCampaignDetail.script}"</span>
                  </div>
                </div>
              </div>

              {/* Sequential Recipient Calls Table */}
              <div className="card" style={{ borderRadius: 12, padding: "18px 20px" }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Live Sequential Dialing Queue</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "rgba(255, 255, 255, 0.03)", textAlign: "left", color: "var(--muted)" }}>
                        <th style={{ padding: "10px 14px", width: 40 }}>#</th>
                        <th style={{ padding: "10px 14px" }}>Recipient Name</th>
                        <th style={{ padding: "10px 14px" }}>Phone Number</th>
                        <th style={{ padding: "10px 14px" }}>Status</th>
                        <th style={{ padding: "10px 14px" }}>Duration</th>
                        <th style={{ padding: "10px 14px" }}>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeCampaignDetail.contacts || []).map((item: BulkCallItem, index: number) => {
                        const isCalling = item.status === "calling";
                        return (
                          <tr
                            key={item.id}
                            style={{
                              borderTop: "1px solid var(--border, rgba(255, 255, 255, 0.05))",
                              background: isCalling ? "rgba(16, 185, 129, 0.08)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "10px 14px", color: "var(--muted)", fontFamily: "monospace" }}>
                              {index + 1}
                            </td>
                            <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                              {item.name || "Contact"}
                            </td>
                            <td style={{ padding: "10px 14px", fontFamily: "monospace" }}>
                              {item.phone}
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <Pill
                                value={item.status}
                                label={
                                  item.status === "calling"
                                    ? "Dialing Now..."
                                    : item.status === "completed"
                                    ? "Completed"
                                    : item.status === "pending"
                                    ? "Waiting in Queue"
                                    : item.status.toUpperCase()
                                }
                                tone={
                                  item.status === "calling"
                                    ? "live"
                                    : item.status === "completed"
                                    ? "success"
                                    : item.status === "pending"
                                    ? "neutral"
                                    : "danger"
                                }
                              />
                              {item.error_message && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#ef4444",
                                    marginTop: 4,
                                    maxWidth: 280,
                                    wordBreak: "break-word",
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {item.error_message}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px 14px", color: "var(--muted)" }}>
                              {item.duration_seconds !== null && item.duration_seconds !== undefined
                                ? `${item.duration_seconds}s`
                                : isCalling
                                ? "In progress..."
                                : "—"}
                            </td>
                            <td style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 12 }}>
                              {item.called_at ? new Date(item.called_at).toLocaleTimeString() : "Pending"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ borderRadius: 12, textAlign: "center", padding: 40 }}>
              <div style={{ color: "var(--muted)", fontSize: 14 }}>Select a campaign on the left to monitor live dialing.</div>
            </div>
          )}
        </motion.div>
      )}
    </Stagger>
  );
}
