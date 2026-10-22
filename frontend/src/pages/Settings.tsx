import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Plug, Plus, Save, SlidersHorizontal, X } from "lucide-react";
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
  const action = useToastAction();

  // Config is re-polled; only reset the form when the saved values actually change
  const savedKey = JSON.stringify(config.runtime);
  useEffect(() => setForm(config.runtime), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addOffset = () => {
    const m = parseInt(newOffset, 10);
    if (!m || m <= 0) return;
    setForm({ ...form, followup_offsets_minutes: [...new Set([...form.followup_offsets_minutes, m])].sort((a, b) => b - a) });
    setNewOffset("");
  };

  const save = () => action.run(async () => setForm(await api.saveSettings(form)), "Settings saved");

  return (
    <Stagger className="page narrow">
      <motion.div className="page-head" variants={itemVariants}><h1>Settings</h1></motion.div>

      <Card title="Reminder calls before the task" icon={BellRing}>
        <p className="muted small">The assigned helper gets a call at each of these times before the task starts.</p>
        <motion.div className="chips" layout>
          <AnimatePresence initial={false}>
            {form.followup_offsets_minutes.map((m) => (
              <motion.span key={m} layout className="chip big" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
                {fmtOffset(m)} before
                <button aria-label={`Remove ${fmtOffset(m)}`} onClick={() =>
                  setForm({ ...form, followup_offsets_minutes: form.followup_offsets_minutes.filter((x) => x !== m) })}>
                  <X size={13} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <motion.span layout className="actions">
            <input type="number" min={1} placeholder="minutes" value={newOffset} className="input-sm"
              onChange={(e) => setNewOffset(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOffset()} />
            <Button size="sm" icon={Plus} onClick={addOffset}>Add</Button>
          </motion.span>
        </motion.div>
      </Card>

      <Card title="Helper calling" icon={SlidersHorizontal}>
        <Toggle checked={form.auto_dispatch} onChange={(v) => setForm({ ...form, auto_dispatch: v })}>
          Start calling helpers automatically for new unassigned tickets after each sync
        </Toggle>
        <div className="form-grid">
          <label>Helpers to try per ticket
            <input type="number" min={1} max={100} value={form.max_helpers_per_ticket}
              onChange={(e) => setForm({ ...form, max_helpers_per_ticket: Number(e.target.value) })} />
          </label>
          <label>Search radius (km)
            <input type="number" min={1} max={500} value={form.match_radius_km}
              onChange={(e) => setForm({ ...form, match_radius_km: Number(e.target.value) })} />
          </label>
        </div>
      </Card>

      <motion.div variants={itemVariants}>
        <Button variant="primary" icon={Save} loading={action.busy} onClick={save}>Save settings</Button>
      </motion.div>

      <Card title="Integration (from backend .env)" icon={Plug}>
        <dl className="fields">
          <Field label="ExtraHand data">{config.extrahand_mode === "live" ? "Live API" : "Mock data (EXTRAHAND_MODE=mock)"}</Field>
          <Field label="Helper matching">{config.matching_api_configured ? "Task Service matching API" : "Helper list + local location/service filter"}</Field>
          <Field label="Assign on ExtraHand">{config.assignment_enabled ? "Enabled" : "Disabled. Acceptances are only recorded here (EXTRAHAND_ALLOW_ASSIGNMENT)"}</Field>
          <Field label="Telephony">{config.telephony_provider === "twilio" ? "Twilio" : "Simulator (answer calls on the dashboard)"}</Field>
          <Field label="Message repeats">{config.ivr_max_prompts} times, then hang up</Field>
          <Field label="Sync interval">every {Math.round(config.sync_interval_seconds / 60)} min</Field>
        </dl>
      </Card>
    </Stagger>
  );
}
