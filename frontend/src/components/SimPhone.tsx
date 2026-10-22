import { AnimatePresence, motion } from "framer-motion";
import { Check, Hand, PhoneIncoming, PhoneMissed, PhoneOff, Volume2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { humanize } from "../format";
import type { Call } from "../types";
import { Avatar, Button, Pill, useToast } from "./ui";

const POSITIVE = new Set(["accepted", "confirmed"]);

/**
 * One live call. For simulated calls this is the helper's handset: answer it,
 * press keys or stay silent, exactly like a real call would report back.
 */
export function SimPhone({ call, maxPrompts, onChange, onEnded }: {
  call: Call; maxPrompts: number; onChange: () => void; onEnded?: (c: Call) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [seq, setSeq] = useState(0); // bumps per action so the speech animation replays exactly once
  const simulated = call.provider === "simulator";
  const ended = call.status === "ended";

  const act = async (action: string, digit?: string) => {
    setBusy(true);
    try {
      const res = await api.simulate(call.id, action, digit);
      setSpoken(res.spoken);
      setSeq((n) => n + 1);
      if (res.call.status === "ended") onEnded?.(res.call);
      onChange();
    } catch (e) {
      toast.error("Call action failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const agentLine = spoken ?? (call.status === "in_progress" ? call.script : null);
  const isOffer = call.purpose === "dispatch";

  return (
    <div className={`phone phone-${call.status} ${ended ? (POSITIVE.has(call.outcome ?? "") ? "phone-good" : "phone-bad") : ""}`}>
      <div className="phone-head">
        <div className="phone-avatar">
          {call.status === "ringing" && (
            <>
              <span className="ripple" />
              <span className="ripple r2" />
              <span className="ripple r3" />
            </>
          )}
          <Avatar name={call.helper_name} size={44} />
        </div>
        <div className="phone-who">
          <div className="phone-name">{call.helper_name ?? "Helper"}</div>
          <div className="mono small muted">{call.phone}</div>
        </div>
        <div className="phone-tags">
          <Pill value={isOffer ? "new" : "scheduled"} label={isOffer ? "Task offer" : "Reminder"} />
          {call.status === "in_progress" ? <CallTimer since={call.answered_at} /> :
            <Pill value={ended ? call.outcome : call.status} label={call.status === "ringing" ? "Ringing" : undefined} />}
        </div>
      </div>

      <div className="small muted phone-ticket">
        <Link to={`/tickets/${encodeURIComponent(call.ticket_id)}`}>{call.ticket_title ?? call.ticket_id}</Link>
      </div>

      {call.status === "in_progress" && (
        <div className="prompt-count">
          Message played <b>{call.prompts_played}</b> of {maxPrompts}
          <span className="dots">
            {Array.from({ length: maxPrompts }, (_, i) => (
              <motion.i key={i} animate={{ scale: i < call.prompts_played ? 1 : 0.7 }}
                className={i < call.prompts_played ? "on" : ""} transition={{ type: "spring", stiffness: 500, damping: 18 }} />
            ))}
          </span>
        </div>
      )}

      {agentLine && !ended && (
        <div className="agent-line">
          {call.status === "in_progress" && <Waveform />}
          {call.status !== "in_progress" && <Volume2 size={14} className="muted" />}
          <Words key={spoken ? `s${seq}` : `p${call.prompts_played}`} text={agentLine} />
        </div>
      )}

      {!ended && simulated && (
        <div className="phone-actions">
          {call.status === "ringing" && (
            <>
              <Button variant="success" icon={PhoneIncoming} disabled={busy} onClick={() => act("answer")}>Answer</Button>
              <Button icon={PhoneMissed} disabled={busy} onClick={() => act("no_answer")}>Don't pick up</Button>
              <Button variant="ghost" disabled={busy} onClick={() => act("busy")}>Busy</Button>
            </>
          )}
          {call.status === "in_progress" && (
            <>
              <Key digit="1" tone="accept" disabled={busy} onPress={() => act("press", "1")}>{isOffer ? "Accept" : "Confirm"}</Key>
              <Key digit="2" tone="reject" disabled={busy} onPress={() => act("press", "2")}>{isOffer ? "Reject" : "Can't attend"}</Key>
              <Key digit="5" disabled={busy} onPress={() => act("press", "5")}>Wrong key</Key>
              <Button variant="ghost" size="sm" icon={Hand} disabled={busy} onClick={() => act("silence")}>Stay silent</Button>
              <Button variant="ghost" size="sm" icon={PhoneOff} disabled={busy} onClick={() => act("hangup")}>Hang up</Button>
            </>
          )}
        </div>
      )}
      {!ended && !simulated && <div className="small muted">Live {call.provider} call. Updates arrive from the phone network.</div>}

      <AnimatePresence>{ended && <Outcome outcome={call.outcome} />}</AnimatePresence>
    </div>
  );
}

function Key({ digit, tone, disabled, onPress, children }: {
  digit: string; tone?: "accept" | "reject"; disabled?: boolean; onPress: () => void; children: ReactNode;
}) {
  const [ripples, setRipples] = useState<number[]>([]);
  return (
    <motion.button className={`key ${tone ?? ""}`} disabled={disabled} whileHover={{ y: -1 }} whileTap={{ scale: 0.94 }}
      onClick={() => { setRipples((r) => [...r, Date.now()]); onPress(); }}>
      <span className="key-digit">{digit}</span>
      <span>{children}</span>
      {ripples.map((id) => (
        <motion.span key={id} className="key-ripple" initial={{ scale: 0, opacity: 0.45 }} animate={{ scale: 4, opacity: 0 }}
          transition={{ duration: 0.6 }} onAnimationComplete={() => setRipples((r) => r.filter((x) => x !== id))} />
      ))}
    </motion.button>
  );
}

function Waveform() {
  return (
    <span className="wave" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}
    </span>
  );
}

/** Agent speech revealed word by word; remounted (keyed) on each replay. */
function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <span className="words">
      {words.map((w, i) => (
        <motion.span key={i} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.035, 2.2), duration: 0.2 }}>
          {w}{" "}
        </motion.span>
      ))}
    </span>
  );
}

function CallTimer({ since }: { since: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)) : 0;
  return (
    <span className="pill tone-success live timer">
      <span className="pill-dot" />
      {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

function Outcome({ outcome }: { outcome: string | null }) {
  const good = POSITIVE.has(outcome ?? "");
  return (
    <motion.div className={`outcome ${good ? "good" : "bad"}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="outcome-badge" initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 14 }}>
        {good ? <Check size={28} strokeWidth={3} /> : <X size={28} strokeWidth={3} />}
      </motion.div>
      <div className="outcome-text">{humanize(outcome)}</div>
      {good && <Confetti />}
    </motion.div>
  );
}

const CONFETTI_COLORS = ["#10E39A", "#B8F35A", "#C3A6FF", "#E8875A", "#F2B544"];

function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 60 + Math.random() * 50;
      return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 20, r: Math.random() * 360, c: CONFETTI_COLORS[i % 5] };
    }));
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <motion.i key={i} style={{ background: p.c }} initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y + 40, opacity: 0, rotate: p.r }} transition={{ duration: 1.1, ease: "easeOut" }} />
      ))}
    </div>
  );
}
