import { motion } from "framer-motion";
import {
  ArrowRightLeft,
  AudioLines,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Gauge,
  Info,
  Loader2,
  Play,
  PhoneCall,
  RefreshCw,
  Square,
  TriangleAlert,
  User,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { itemVariants, Stagger } from "../components/motion";
import { Button, Card, ErrorNote, Pill, SkeletonRows, Tabs, useToast } from "../components/ui";
import { CallingAgentToggle } from "../components/CallingAgentToggle";
import { usePoll, useUrlState } from "../hooks";
import type { CheckStatus, ScriptStep, Ticket, VoiceCheck, VoiceScript, VoiceStatus } from "../types";

const ICONS: Record<CheckStatus, LucideIcon> = { ok: CheckCircle2, warn: TriangleAlert, fail: XCircle, info: Info };
const RANK: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2, info: 3 };
/** Problems first, so the thing to fix is never buried among the green rows. */
const bySeverity = (checks: VoiceCheck[]) => [...checks].sort((a, b) => RANK[a.status] - RANK[b.status]);
const PURPOSES = [
  { key: "dispatch", label: "Job offer", who: "helper" },
  { key: "followup", label: "Reminder", who: "helper" },
  { key: "feedback", label: "Rating call", who: "customer" },
] as const;

export default function VoiceIvr() {
  const [tab, setTab] = useUrlState<string>("tab", "setup", { push: true });
  const status = usePoll<VoiceStatus>(api.voiceStatus, 30000);

  return (
    <Stagger className="page">
      <motion.div className="page-head" variants={itemVariants}>
        <h1>Voice &amp; IVR</h1>
        <p className="muted">
          Whether the phone line is ready, exactly what each call says, and how it sounds. Helpers and customers hear Telugu,
          spoken by Maya's voice.
        </p>
      </motion.div>

      <motion.div variants={itemVariants}>
        <CallingAgentToggle variant="banner" />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "setup", label: "Setup", count: status.data ? status.data.summary.fail + status.data.summary.warn : undefined },
            { key: "scripts", label: "What it says" },
            { key: "golive", label: "Go-live checklist" },
          ]}
        />
      </motion.div>

      {tab === "setup" && <SetupTab status={status.data} error={status.error} onChanged={status.refresh} />}
      {tab === "scripts" && <ScriptsTab />}
      {tab === "golive" && <GoLiveTab status={status.data} />}
    </Stagger>
  );
}

/* ------------------------------------------------------------------------------------------------------ setup */

function Hero({ status }: { status: VoiceStatus }) {
  const bad = status.summary.fail;
  const simulated = status.provider !== "vobiz";
  const tone = simulated ? "neutral" : bad ? "danger" : status.summary.warn ? "warn" : "success";
  const Icon = simulated ? Info : bad ? XCircle : status.summary.warn ? TriangleAlert : CheckCircle2;
  const title = simulated
    ? "Calls are simulated"
    : bad
      ? `Not ready for real calls: ${bad} thing${bad > 1 ? "s" : ""} to fix`
      : status.summary.warn
        ? "Ready, with a few things worth a look"
        : "Ready for real calls";
  const sub = simulated
    ? "Nobody is dialled. Helpers are played by you in the simulator. Set TELEPHONY_PROVIDER=vobiz to place real calls."
    : `${status.summary.ok} checks passed${status.summary.warn ? `, ${status.summary.warn} to look at` : ""}${bad ? `, ${bad} failing` : ""}.`;
  return (
    <div className={`vx-hero vx-${tone}`}>
      <span className="vx-hero-icon"><Icon size={22} /></span>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="vx-hero-pills">
        <Pill value={status.environment} label={status.environment === "production" ? "Production" : "Development"} tone={status.environment === "production" ? "success" : "warn"} />
        <Pill value={status.provider} label={status.provider === "vobiz" ? "Vobiz" : status.provider === "twilio" ? "Twilio" : "Simulator"} tone="neutral" />
      </div>
    </div>
  );
}

function CheckRow({ c }: { c: VoiceCheck }) {
  const Icon = ICONS[c.status];
  return (
    <li className={`vx-check vx-${c.status}`}>
      <Icon size={17} className="vx-check-icon" />
      <div className="vx-check-body">
        <b>{c.label}</b>
        <span>{c.detail}</span>
        {c.fix && c.status !== "ok" && c.status !== "info" && <em>{c.fix}</em>}
      </div>
      {c.ms != null && <span className="vx-ms tabular">{c.ms} ms</span>}
    </li>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      /* clipboard blocked: the value is still on screen to select */
    }
  };
  return (
    <div className="vx-copy">
      <div>
        <span className="vx-copy-label">{label}</span>
        <code className="mono">{value}</code>
      </div>
      <Button size="sm" icon={Copy} onClick={copy} aria-label={`Copy ${label}`}>Copy</Button>
    </div>
  );
}

function SetupTab({ status, error, onChanged }: { status: VoiceStatus | null; error: string | null; onChanged: () => void }) {
  const [live, setLive] = useState<VoiceCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setLiveError(null);
    try {
      setLive((await api.voiceChecks()).checks);
      onChanged();
    } catch (e) {
      setLiveError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (!status) return error ? <ErrorNote error={error} /> : <Card><SkeletonRows rows={5} /></Card>;
  const t = status.timing;

  return (
    <>
      <motion.div variants={itemVariants}><Hero status={status} /></motion.div>

      <Card title="Setup checks" icon={ClipboardCheck}>
        <ul className="vx-checks">{bySeverity(status.checks).map((c) => <CheckRow key={c.id} c={c} />)}</ul>
      </Card>

      <Card
        title="Live checks"
        icon={Gauge}
        actions={<Button size="sm" variant="primary" icon={running ? undefined : RefreshCw} loading={running} onClick={run}>Run live checks</Button>}
      >
        <p className="muted vx-lede">
          Asks Vobiz and Sarvam to answer, then downloads a test clip from this server's own public address. It tells you
          how long a caller would wait for the first word. Takes a few seconds.
        </p>
        <ErrorNote error={liveError} />
        {live ? <ul className="vx-checks">{bySeverity(live).map((c) => <CheckRow key={c.id} c={c} />)}</ul> : !running && <p className="muted small">Not run yet.</p>}
      </Card>

      {status.urls && (
        <Card title="Enter these in the Vobiz console" icon={PhoneCall}>
          <p className="muted vx-lede">
            On the IVR number's application, so that a helper who calls the number back hears a short message, and calls
            are reported to this server.
          </p>
          <CopyLine label="Inbound call URL (answer URL of the IVR number)" value={status.urls.inbound} />
          <p className="muted small vx-foot">
            Outgoing calls carry their own answer, hangup and hand-off addresses; nothing else needs setting up there.
          </p>
        </Card>
      )}

      <Card title="How a call behaves" icon={AudioLines}>
        <dl className="vx-facts">
          <div><dt>Message plays</dt><dd>up to {t.max_prompts} times</dd></div>
          <div><dt>Waits for a key</dt><dd>{t.key_wait_seconds} s after the message</dd></div>
          <div><dt>Rings for</dt><dd>{t.ring_seconds} s</dd></div>
          <div><dt>Maya's call</dt><dd>up to {t.handoff_limit_seconds} s</dd></div>
          <div><dt>Waits for Maya to pick up</dt><dd>{t.handoff_ring_seconds} s</dd></div>
          <div><dt>Missed reminder</dt><dd>tried again after {t.retry_after_minutes} min</dd></div>
          <div><dt>Saved audio</dt><dd>{status.audio.files} files, {status.audio.megabytes} MB</dd></div>
        </dl>
        <p className="muted small vx-foot">These are set in the server's environment file and need a restart to change.</p>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------------------------------------------- scripts */

function PlayButton({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const run = useRef(0); // which press is current: one that was stopped, or whose step changed, must not start playing

  const release = () => {
    run.current += 1;
    const a = audio.current;
    if (a) {
      a.onended = null; // detach first: freeing the audio below would otherwise raise a second, misleading error
      a.onerror = null;
      a.pause();
    }
    audio.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => release, []);
  useEffect(() => { release(); setState("idle"); setError(null); }, [url]);

  const toggle = async () => {
    if (state === "loading") return;
    if (state === "playing") {
      release();
      setState("idle");
      return;
    }
    release();
    const mine = run.current;
    // Made inside the click, before the audio is fetched, so browsers that only allow sound after a tap still allow it.
    const a = new Audio();
    audio.current = a;
    setState("loading");
    setError(null);
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { msg = (await res.json()).detail ?? msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (mine !== run.current) return;
      objectUrl.current = URL.createObjectURL(blob);
      a.onended = () => { release(); setState("idle"); };
      a.onerror = () => { release(); setState("idle"); setError("The browser could not play this audio."); };
      a.src = objectUrl.current;
      await a.play();
      if (mine === run.current) setState("playing");
    } catch (e) {
      if (mine !== run.current) return;
      release();
      setState("idle");
      setError((e as Error).name === "NotAllowedError" ? "Your browser blocked the sound. Press Play again." : (e as Error).message);
    }
  };

  return (
    <div className="vx-play">
      <Button size="sm" variant={state === "playing" ? "primary" : "secondary"} onClick={toggle} aria-label={`${state === "playing" ? "Stop" : "Play"}: ${label}`}
        icon={state === "loading" ? Loader2 : state === "playing" ? Square : Play}>
        {state === "playing" ? "Stop" : state === "loading" ? "Making audio…" : "Play"}
      </Button>
      {error && <span className="vx-play-error" role="alert">{error}</span>}
    </div>
  );
}

function StepCard({ step, purpose, ticketId }: { step: ScriptStep; purpose: string; ticketId?: string }) {
  return (
    <li className={`vx-step ${step.handoff ? "vx-step-handoff" : ""}`}>
      <div className="vx-step-head">
        <div>
          <b>{step.handoff && <ArrowRightLeft size={14} className="vx-inline-icon" />}{step.title}</b>
          <span className="muted small">{step.when}</span>
        </div>
        {step.parts.length > 0 && <PlayButton url={api.voicePreviewUrl(purpose, step.key, ticketId)} label={step.title} />}
      </div>
      {step.parts.length > 0 && (
        <p className="vx-say" lang="te">
          {step.parts.map((p, i) => (
            <span key={i} className={p.personal ? "vx-part vx-personal" : "vx-part"} title={p.personal ? "Made fresh for each call" : undefined}>
              {p.personal && <User size={11} className="vx-person" aria-label="made for each call" />}
              {p.text}
            </span>
          ))}
        </p>
      )}
      {step.note && <p className="vx-note small">{step.note}</p>}
    </li>
  );
}

function ScriptsTab() {
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]["key"]>("dispatch");
  const [ticketId, setTicketId] = useState("");
  const tickets = usePoll<Ticket[]>(() => api.tickets(), 60000);
  const script = usePoll<VoiceScript>(() => api.voiceScript(purpose, ticketId || undefined), 600000, [purpose, ticketId]);
  const s = script.data;

  return (
    <>
      <Card flat>
        <div className="vx-controls">
          <div className="vx-seg" role="tablist" aria-label="Kind of call">
            {PURPOSES.map((p) => (
              <button key={p.key} role="tab" aria-selected={purpose === p.key} className={purpose === p.key ? "on" : ""} onClick={() => setPurpose(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="vx-select">
            <span className="muted small">Example</span>
            <select value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
              <option value="">A made-up job</option>
              {(tickets.data ?? []).slice(0, 40).map((t) => (
                <option key={t.id} value={t.id}>{t.title ?? t.id} · {t.category ?? "service"}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small vx-foot">
          <User size={11} className="vx-person" /> marks the parts made fresh for every call (a name, area, time or address).
          Everything else is recorded once and reused. Press <b>Play</b> to hear a step as the caller would.
        </p>
      </Card>

      {!s ? <Card><SkeletonRows rows={4} /></Card> : (
        <>
          <Card title="Keys" icon={AudioLines}>
            <ul className="vx-keys">
              {s.keys.map((k) => (
                <li key={k.digit}>
                  <kbd>{k.digit}</kbd>
                  <span>{k.label}</span>
                  {k.handoff && <Pill value="handoff" label="Maya takes over" tone="info" />}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Step by step" icon={PhoneCall}>
            <ol className="vx-steps">
              {s.steps.map((step) => <StepCard key={step.key} step={step} purpose={purpose} ticketId={ticketId || undefined} />)}
            </ol>
          </Card>
        </>
      )}
      <ErrorNote error={script.error} />
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------- go-live */

const STORAGE_KEY = "voice_golive_v1";

const LIVEKIT_SUPPORT_NOTE =
  "Hello, please enable enforcement of the allowed_addresses field on SIP inbound trunks for our LiveKit Cloud project. " +
  "We have set the trunk's allowed_addresses to the SIP signaling addresses published by our carrier, Vobiz " +
  "(https://www.vobiz.ai/docs/concepts/ip-whitelisting), and want calls from any other address refused. Thank you.";

function GoLiveTab({ status }: { status: VoiceStatus | null }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")); } catch { /* storage blocked */ }
  }, []);
  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };

  const groups: { title: string; items: { id: string; text: string; body?: React.ReactNode }[] }[] = [
    {
      title: "Phone line (Vobiz)",
      items: [
        { id: "inbound", text: "The IVR number's inbound URL is set in the Vobiz console",
          body: status?.urls ? <CopyLine label="Inbound call URL" value={status.urls.inbound} /> : <p className="muted small">Set PUBLIC_BASE_URL first.</p> },
        { id: "a2p", text: "The number is registered for automated calls (the TRAI A2P declaration), and its caller name is approved",
          body: <p className="muted small">Until this is done, call only your own team's phones.</p> },
      ],
    },
    {
      title: "Hand-off to Maya (LiveKit)",
      items: [
        { id: "trunk", text: "The inbound SIP trunk and dispatch rule exist",
          body: <CopyLine label="Run once, from the voice-handoff folder" value="python setup_livekit.py --vobiz-addresses --sip-uri sip:<your-id>.sip.livekit.cloud" /> },
        { id: "enforce", text: "LiveKit support has switched on enforcement of the address list",
          body: <CopyLine label="Message to send LiveKit support" value={LIVEKIT_SUPPORT_NOTE} /> },
        { id: "agent", text: "The hand-off agent is running and shows as registered in its log" },
      ],
    },
    {
      title: "Test calls to your own phone",
      items: [
        { id: "t-offer1", text: "Job offer, press 1: you hear the address, and the ticket becomes assigned" },
        { id: "t-offer2", text: "Job offer, press 2: the ticket goes on to the next helper or to customer care" },
        { id: "t-silent", text: "Job offer, press nothing: the message repeats, then the call ends as 'no input'" },
        { id: "t-hang", text: "Hang up in the middle of a message: the call shows 'hung up' with its length" },
        { id: "t-rem1", text: "Reminder, press 1: confirmed" },
        { id: "t-rem2", text: "Reminder, press 2: Maya answers within a couple of seconds, and her summary appears on the ticket" },
        { id: "t-rate5", text: "Rating call, press 5: thank-you line, rating saved" },
        { id: "t-rate1", text: "Rating call, press 1: Maya takes the complaint, and customer care is alerted" },
        { id: "t-rate9", text: "Rating call, press 9: a call-back is made about two hours later" },
        { id: "t-speed", text: "The first word is heard within about two seconds of answering (see Live checks, audio download)" },
      ],
    },
  ];

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const finished = groups.reduce((n, g) => n + g.items.filter((i) => done[i.id]).length, 0);

  return (
    <>
      <Card flat>
        <div className="vx-progress">
          <b>{finished} of {total} done</b>
          <div className="vx-bar"><span style={{ width: `${(finished / total) * 100}%` }} /></div>
        </div>
        <p className="muted small vx-foot">
          The server-side items (login, database, addresses, keys) are checked for you on the Setup tab. These are the
          steps that only a person can confirm. Ticks are remembered in this browser only.
        </p>
      </Card>
      {groups.map((g) => (
        <Card key={g.title} title={g.title} icon={ClipboardCheck}>
          <ul className="vx-todo">
            {g.items.map((i) => (
              <li key={i.id} className={done[i.id] ? "done" : ""}>
                <label>
                  <input type="checkbox" checked={!!done[i.id]} onChange={() => toggle(i.id)} />
                  <span>{i.text}</span>
                </label>
                {i.body && <div className="vx-todo-body">{i.body}</div>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
