import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Hand, PartyPopper, PhoneOutgoing, Save, SearchX, UserX, UsersRound, Clock3, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Empty, Field, Phone, Pill, SkeletonRows, Toggle, useToastAction } from "../components/ui";
import { usePoll } from "../hooks";
import { fmtDateTime, fmtMoney, fmtRelative } from "../format";
import type { Escalation } from "../types";

const REASONS: Record<string, { label: string; icon: LucideIcon }> = {
  no_helper_accepted: { label: "No helper accepted", icon: UsersRound },
  no_eligible_helpers: { label: "No eligible helpers nearby", icon: SearchX },
  helper_cannot_attend: { label: "Helper cannot attend", icon: UserX },
  helper_unconfirmed: { label: "Helper did not confirm", icon: Clock3 },
};

export default function CustomerCare() {
  const [showResolved, setShowResolved] = useState(false);
  const { data, refresh } = usePoll(
    () => api.escalations(showResolved ? undefined : "open,in_progress"), 4000, [showResolved]);

  return (
    <div className="page">
      <motion.div className="page-head row" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Customer care</h1>
          <p className="muted">Tickets the calling agent could not place with a helper.</p>
        </div>
        <Toggle checked={showResolved} onChange={setShowResolved}>Show resolved</Toggle>
      </motion.div>
      {!data ? <SkeletonRows rows={3} /> : (
        <motion.div className="esc-list" layout>
          <AnimatePresence initial={true} mode="popLayout">
            {data.map((e, i) => (
              <motion.div key={e.id} layout initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0, transition: { type: "spring", stiffness: 320, damping: 32, delay: Math.min(i * 0.05, 0.3) } }}
                exit={{ opacity: 0, x: 40, scale: 0.98, transition: { duration: 0.25 } }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}>
                <EscalationCard esc={e} onChange={refresh} />
              </motion.div>
            ))}
          </AnimatePresence>
          {!data.length && <Empty icon={PartyPopper}>Nothing needs attention.</Empty>}
        </motion.div>
      )}
    </div>
  );
}

function EscalationCard({ esc, onChange }: { esc: Escalation; onChange: () => void }) {
  const t = esc.ticket;
  const [notes, setNotes] = useState(esc.notes ?? "");
  const [owner, setOwner] = useState(esc.assigned_to ?? "");
  const [celebrate, setCelebrate] = useState(false);
  const action = useToastAction();
  const reason = REASONS[esc.reason] ?? { label: esc.reason, icon: UsersRound };

  const update = (status?: Escalation["status"]) =>
    action.run(async () => {
      await api.updateEscalation(esc.id, { status, notes, assigned_to: owner });
      if (status === "resolved") {
        setCelebrate(true);
        setTimeout(onChange, 900);
      } else onChange();
    }, status === "resolved" ? "Escalation resolved" : status === "in_progress" ? "You're on it" : "Notes saved");

  return (
    <article className={`esc esc-${esc.status}`}>
      <header className="esc-head">
        <div className="esc-title">
          <span className="esc-icon"><reason.icon size={18} /></span>
          <div>
            <div className="esc-reason">{reason.label}</div>
            <div className="small muted">Raised {fmtRelative(esc.created_at)} · {fmtDateTime(esc.created_at)}</div>
          </div>
        </div>
        <Pill value={esc.status} />
      </header>
      {esc.details && <p className="esc-details">{esc.details}</p>}
      {t && (
        <dl className="fields cols">
          <Field label="Ticket"><Link to={`/tickets/${encodeURIComponent(t.id)}`}>{t.title ?? t.id}</Link></Field>
          <Field label="Service">{t.category ?? "—"} · {fmtMoney(t.budget)}</Field>
          <Field label="Scheduled">{fmtDateTime(t.scheduled_at)} <span className="small muted">({fmtRelative(t.scheduled_at)})</span></Field>
          <Field label="Customer">{t.customer.name ?? "—"} · <Phone value={t.customer.phone} /></Field>
          <Field label="Location">{t.address ?? "—"}{t.city ? `, ${t.city}` : ""}</Field>
          {t.assignee && <Field label="Helper">{t.assignee.name} · <Phone value={t.assignee.phone} /></Field>}
        </dl>
      )}
      {esc.status !== "resolved" ? (
        <div className="esc-form">
          <input placeholder="Handled by" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <textarea placeholder="Notes (what was done, who was called…)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="actions">
            {esc.status === "open" && <Button icon={Hand} disabled={action.busy} onClick={() => update("in_progress")}>Take it</Button>}
            <Button variant="primary" icon={PhoneOutgoing} disabled={action.busy}
              onClick={() => action.run(async () => { await api.redispatch(esc.id); onChange(); }, "Calling helpers again")}>
              Call helpers again
            </Button>
            <Button icon={Save} disabled={action.busy} onClick={() => update()}>Save notes</Button>
            <Button variant="success" icon={CheckCircle2} disabled={action.busy} onClick={() => update("resolved")}>Mark resolved</Button>
          </div>
        </div>
      ) : (
        <div className="small muted">Resolved {fmtRelative(esc.resolved_at)}{esc.assigned_to && ` by ${esc.assigned_to}`}{esc.notes && ` · ${esc.notes}`}</div>
      )}

      <AnimatePresence>
        {celebrate && (
          <motion.div className="outcome good" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="outcome-badge" initial={{ scale: 0.3 }} animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 14 }}>
              <CheckCircle2 size={30} />
            </motion.div>
            <div className="outcome-text">Resolved</div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
