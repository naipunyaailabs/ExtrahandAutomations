import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, BellRing, DollarSign, Globe, Plug, Plus, Save, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../components/Layout";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Card, Field, Toggle, useToastAction } from "../components/ui";
import { fmtOffset } from "../format";
import type { RuntimeSettings } from "../types";

export default function Settings() {
  const config = useConfig()!;
  const [form, setForm] = useState<RuntimeSettings>(config.runtime);
  const [newOffset, setNewOffset] = useState("");
  const [emergencyActive, setEmergencyActive] = useState<boolean>(!!config.runtime.emergency_stop_calls);
  const [stopping, setStopping] = useState(false);
  const action = useToastAction();

  // Config is re-polled; only reset the form when the saved values actually change
  const savedKey = JSON.stringify(config.runtime);
  useEffect(() => {
    setForm(config.runtime);
    setEmergencyActive(!!config.runtime.emergency_stop_calls);
  }, [savedKey]);

  const addOffset = () => {
    const m = parseInt(newOffset, 10);
    if (!m || m <= 0) return;
    setForm({ ...form, followup_offsets_minutes: [...new Set([...form.followup_offsets_minutes, m])].sort((a, b) => b - a) });
    setNewOffset("");
  };

  const handleToggleEmergency = async () => {
    try {
      setStopping(true);
      const nextState = !emergencyActive;
      const res = await api.toggleEmergencyStop(nextState);
      setEmergencyActive(res.emergency_stop_calls);
      setForm((prev) => ({ ...prev, emergency_stop_calls: res.emergency_stop_calls }));
      action.run(async () => {}, nextState ? "⚠️ EMERGENCY STOP ACTIVATED: All automated calls paused" : "Emergency stop lifted: Normal operations resumed");
    } catch (err: any) {
      alert("Failed to toggle emergency stop: " + (err?.message || err));
    } finally {
      setStopping(false);
    }
  };

  const save = () => action.run(async () => setForm(await api.saveSettings(form)), "Settings saved");

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "1.5rem" }}>
      <Stagger className="page narrow">
        <motion.div className="page-head" variants={itemVariants}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.8rem" }}>⚙️</span>
          <h1 style={{ margin: 0, fontSize: "1.7rem", fontWeight: 800, color: "var(--blue-main, #2563eb)" }}>
            Automation Settings & Controls
          </h1>
        </div>
        <p style={{ margin: "0.25rem 0 0 0", color: "var(--text-muted, #78716c)", fontSize: "0.95rem" }}>
          Configure emergency kill switch, multilingual voice calling, contact hours, and dispatch algorithms.
        </p>
      </motion.div>

      {/* EMERGENCY STOP BANNER */}
      <motion.div variants={itemVariants}>
        <div
          style={{
            background: emergencyActive
              ? "linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(185, 28, 28, 0.15))"
              : "rgba(239, 68, 68, 0.05)",
            border: `2px solid ${emergencyActive ? "#ef4444" : "rgba(239, 68, 68, 0.3)"}`,
            borderRadius: "14px",
            padding: "1.25rem 1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
            boxShadow: emergencyActive ? "0 0 25px rgba(239, 68, 68, 0.35)" : "none",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: emergencyActive ? "#ef4444" : "rgba(239, 68, 68, 0.15)",
                color: emergencyActive ? "#fff" : "#ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AlertOctagon size={28} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: emergencyActive ? "#dc2626" : "inherit" }}>
                {emergencyActive ? "EMERGENCY STOP ACTIVE (CALLS PAUSED)" : "Emergency Calling Kill Switch"}
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted, #78716c)" }}>
                {emergencyActive
                  ? "All automated outbound dispatch calls and customer feedback calls are paused."
                  : "Instantly halt all automated outbound helper calls and customer feedback calls with one click."}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={stopping}
            onClick={handleToggleEmergency}
            style={{
              padding: "0.6rem 1.25rem",
              borderRadius: "8px",
              background: emergencyActive ? "#10b981" : "#ef4444",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: stopping ? "not-allowed" : "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            {stopping ? "Processing..." : emergencyActive ? "RESUME AUTOMATED CALLS" : "EMERGENCY STOP CALLS"}
          </button>
        </div>
      </motion.div>

      {/* WORKFLOW AUTOMATION SWITCHES */}
      <Card title="Active Automation Workflows" icon={SlidersHorizontal}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <Toggle
            checked={form.workflow_helper_dispatch_enabled ?? true}
            onChange={(v) => setForm({ ...form, workflow_helper_dispatch_enabled: v })}
          >
            <strong>Automated Helper Cascading Calling</strong> – Automatically call nearby helpers one-by-one for unassigned bookings.
          </Toggle>

          <Toggle
            checked={form.workflow_customer_feedback_enabled ?? true}
            onChange={(v) => setForm({ ...form, workflow_customer_feedback_enabled: v })}
          >
            <strong>Post-Service Customer Feedback Calling</strong> – Automatically place post-service calls to collect CSAT ratings and complaints.
          </Toggle>

          <Toggle
            checked={form.auto_dispatch}
            onChange={(v) => setForm({ ...form, auto_dispatch: v })}
          >
            Automatically start calling helpers for new tasks (no click needed).
          </Toggle>

          <label className="set-lead">
            <span>
              <strong>Start calls &amp; IVR</strong>
              <small>hours before the task's scheduled time. Tasks with no time are called right away.</small>
            </span>
            <span className="set-lead-input">
              <input
                type="number"
                min={0.5}
                max={168}
                step={0.5}
                value={form.dispatch_lead_hours ?? 6}
                onChange={(e) => setForm({ ...form, dispatch_lead_hours: Number(e.target.value) || 6 })}
              />
              <em>hours before</em>
            </span>
          </label>
        </div>
      </Card>

      {/* MULTILINGUAL & CALLING HOURS */}
      <Card title="Voice Calling Hours & Multilingual Settings" icon={Globe}>
        <p className="muted small" style={{ marginBottom: "1rem" }}>
          ExtraHand AI calling agent supports Telugu, Hindi, and English. Calls are only permitted within configured contact hours.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Preferred Voice Language
            </label>
            <select
              value={form.preferred_language || "te"}
              onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
              }}
            >
              <option value="te">Telugu (తెలుగు) - Default in AP / Telangana</option>
              <option value="hi">Hindi (हिंदी) - Pan-India</option>
              <option value="en">English - Universal</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Calling Hours Window
            </label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="time"
                value={form.calling_hours_start ?? ""}
                onChange={(e) => setForm({ ...form, calling_hours_start: e.target.value })}
                style={{
                  padding: "0.45rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-subtle, #d1d5db)",
                  background: "var(--input-bg, #fff)",
                  color: "inherit",
                }}
              />
              <span>to</span>
              <input
                type="time"
                value={form.calling_hours_end ?? ""}
                onChange={(e) => setForm({ ...form, calling_hours_end: e.target.value })}
                style={{
                  padding: "0.45rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-subtle, #d1d5db)",
                  background: "var(--input-bg, #fff)",
                  color: "inherit",
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Delay Before Feedback Call (min)
            </label>
            <input
              type="number"
              min={0}
              max={1440}
              value={form.feedback_call_delay_minutes ?? ""}
              onChange={(e) => setForm({ ...form, feedback_call_delay_minutes: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </Card>

      {/* HELPER DISPATCH ALGORITHM */}
      <Card title="Helper Matching & Radius Cascade" icon={SlidersHorizontal}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Max Helpers to Contact per Ticket
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.max_helpers_per_ticket}
              onChange={(e) => setForm({ ...form, max_helpers_per_ticket: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Search Radius (km)
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.match_radius_km}
              onChange={(e) => setForm({ ...form, match_radius_km: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </Card>

      {/* COST CONFIGURATION */}
      <Card title="Operational Cost Parameters (INR ₹)" icon={DollarSign}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Voice Telephony Rate (₹ per minute)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.10"
              value={form.cost_per_call_minute ?? 1.2}
              onChange={(e) => setForm({ ...form, cost_per_call_minute: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              WhatsApp Message Rate (₹ per template)
            </label>
            <input
              type="number"
              step="0.05"
              min="0.05"
              value={form.cost_per_whatsapp_msg ?? 0.4}
              onChange={(e) => setForm({ ...form, cost_per_whatsapp_msg: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle, #d1d5db)",
                background: "var(--input-bg, #fff)",
                color: "inherit",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </Card>

      {/* REMINDER OFFSETS */}
      <Card title="Reminder Calls Before Scheduled Service" icon={BellRing}>
        <p className="muted small">The assigned helper receives an automated reminder call at each interval before service begins.</p>
        <motion.div className="chips" layout>
          <AnimatePresence initial={false}>
            {form.followup_offsets_minutes.map((m) => (
              <motion.span
                key={m}
                layout
                className="chip big"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
              >
                {fmtOffset(m)} before
                <button
                  aria-label={`Remove ${fmtOffset(m)}`}
                  onClick={() =>
                    setForm({ ...form, followup_offsets_minutes: form.followup_offsets_minutes.filter((x) => x !== m) })
                  }
                >
                  <X size={13} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <motion.span layout className="actions">
            <input
              type="number"
              min={1}
              placeholder="minutes"
              value={newOffset}
              className="input-sm"
              onChange={(e) => setNewOffset(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOffset()}
            />
            <Button size="sm" icon={Plus} onClick={addOffset}>Add</Button>
          </motion.span>
        </motion.div>
      </Card>

      <motion.div variants={itemVariants} style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <Button variant="primary" icon={Save} loading={action.busy} onClick={save} style={{ minWidth: "160px" }}>
          Save Settings
        </Button>
      </motion.div>

      {/* INTEGRATION HEALTH STATUS */}
      <Card title="ExtraHand Platform API Integration Health" icon={Plug}>
        <dl className="fields">
          <Field label="Platform Source">{config.extrahand_mode === "live" ? "Live ExtraHand API (Authorized)" : "Mock ExtraHand Simulation (Demo mode)"}</Field>
          <Field label="Helper Matching">{config.matching_api_configured ? "ExtraHand Task Service matching API" : "Helper Directory + Location Geo-Radius filter"}</Field>
          <Field label="Assignment Mode">{config.assignment_enabled ? "Authorized Platform API (Automatic Remote Assignment)" : "In this app only (ExtraHand is not updated)"}</Field>
          <Field label="Telephony Engine">{config.telephony_provider === "twilio" ? "Twilio Voice Webhooks" : "Simulator / In-browser Engine"}</Field>
          <Field label="Max Prompt Retries">{config.ivr_max_prompts} times per call</Field>
          <Field label="Background Sync Cycle">every {Math.round(config.sync_interval_seconds / 60)} minutes</Field>
        </dl>
      </Card>
    </Stagger>
  </div>
  );
}
