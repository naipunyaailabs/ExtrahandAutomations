import {
  BarChart3,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Globe,
  ImageIcon,
  MapPin,
  PartyPopper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useBranding } from "../branding";
import { useToast } from "./ui";
import { FestivalPosterCard, posterDesign } from "./FestivalPosterCard";
import type { CityEvent, CitySummary, FestivalFinderStatus, PosterAgentStatus, PosterScanStatus } from "../types";

/*
 * Advertisement agent UI.
 *  - Marketing Radar (dashboard): festival and poster metrics.
 *  - States & Cities: a KPI card for All-India and each city.
 *  - Region calendar page: click a date to register a festival (name, description, coupon code);
 *    the poster agent then designs its poster, shown beside the calendar.
 *  - All-India only: "Find Festivals" reads Drik Panchang, Groq GPT-OSS-20B picks the major festivals,
 *    and each one waits for the admin to approve (published + poster) or reject it.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REGION_TYPE_LABEL: Record<string, string> = { national: "National", state: "State", union_territory: "UT", city: "City" };

/** Calendar page of a region (All-India or a city). */
export const regionCalendarPath = (name: string) => `/advertisement/regions/${encodeURIComponent(name)}`;

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isNational = (c: CitySummary) => c.is_national || c.region_type === "national";
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isPending = (ev: CityEvent) => ev.status === "Pending Review";
/** Approved festival whose last day is before today: shown greyed out with its poster, no regenerate / edit. */
const isCompleted = (ev: CityEvent, today: string) => !isPending(ev) && (ev.date_end || ev.date_start || "") < today;
const coversDate = (ev: CityEvent, date: string) => !!ev.date_start && date >= ev.date_start && date <= (ev.date_end || ev.date_start);

// ---- shared styles ------------------------------------------------------------
const card: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  boxSizing: "border-box",
};
const btnLight: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, padding: "7px 13px",
  background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "8px", color: "#334155", cursor: "pointer",
};
const btnDark: CSSProperties = { ...btnLight, background: "#0f172a", border: "1px solid #0f172a", color: "#ffffff" };
const fieldLabel: CSSProperties = { display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", fontWeight: 600, color: "#0f172a" };
const field: CSSProperties = {
  fontSize: "13px", fontWeight: 500, border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px 11px",
  color: "#0f172a", background: "#ffffff", fontFamily: "inherit",
};
const smallHeading: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" };
const emptyBox: CSSProperties = {
  border: "1px dashed #cbd5e1", background: "#f8fafc", borderRadius: "12px", padding: "20px 16px",
  textAlign: "center", color: "#64748b", fontSize: "13px", lineHeight: 1.5,
};

/** Agent 1 → Agent 2 pipeline for one festival: what Agent 1 learnt and the prompt it gave Agent 2. */
function ResearchPanel({ event, posterReady }: { event: CityEvent; posterReady: boolean }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const k = event.knowledge || {};
  // The full poster prompt Agent 1 wrote for the current poster (saved with the poster's design)
  const posterPrompt = posterDesign(event).poster_prompt_used || "";
  const list = (items?: string[]) => (items && items.length ? items.slice(0, 6).join(", ") : "");
  const rows: [string, string][] = [
    ["Meaning", k.significance || ""],
    ["Honours", list(k.figures)],
    ["Symbols", list(k.symbols)],
    ["Celebrated at", list(k.places)],
    ["Greeting", k.greeting || ""],
    ["Avoid", list(k.imagery_avoid)],
  ];
  const step = (label: string, done: boolean, color: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700,
      color: done ? color : "#94a3b8" }}>
      {done ? <CheckCircle2 size={12} /> : <RefreshCw size={11} className="spin" />}
      {label}
    </span>
  );
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "12px 14px", background: "#f8fafc",
      display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {step("Agent 1 · Festival research", true, "#2563eb")}
        <span style={{ color: "#cbd5e1" }}>→</span>
        {step("Agent 2 · Poster", posterReady, "#16a34a")}
        {k.religion && (
          <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, color: "#1e40af", background: "#dbeafe",
            borderRadius: "999px", padding: "2px 9px" }}>
            {k.religion}
          </span>
        )}
      </div>
      <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.5 }}>{k.summary}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: "10px", rowGap: "3px", fontSize: "12px", lineHeight: 1.45 }}>
        {rows.filter(([, v]) => v).map(([label, v]) => (
          <div key={label} style={{ display: "contents" }}>
            <span style={{ color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
            <span style={{ color: label === "Avoid" ? "#b91c1c" : "#334155" }}>{v}</span>
          </div>
        ))}
      </div>
      {posterPrompt && (
        <div>
          <button type="button" onClick={() => setShowPrompt((v) => !v)}
            style={{ background: "transparent", border: "none", padding: 0, color: "#2563eb", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
            {showPrompt ? "Hide" : "Show"} the poster prompt Agent 1 wrote for Agent 2
          </button>
          {showPrompt && (
            <div style={{ marginTop: "6px", fontSize: "11.5px", color: "#334155", background: "#ffffff", border: "1px solid #e2e8f0",
              borderRadius: "8px", padding: "8px 10px", lineHeight: 1.5 }}>
              {posterPrompt}
            </div>
          )}
        </div>
      )}
      <div style={{ fontSize: "10.5px", color: "#94a3b8" }}>
        Researched by {k.model || "the text model"}{k.learned_at ? ` on ${k.learned_at.slice(0, 10)}` : ""}. Check the details before publishing.
      </div>
    </div>
  );
}

export function AdvertisementView({ mode = "dashboard" }: { mode?: "dashboard" | "regions" }) {
  const toast = useToast();
  const branding = useBranding();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { region: regionParam } = useParams<{ region?: string }>();

  // Older links (?region= / ?city=) open the region's calendar page
  const legacyRegion = searchParams.get("region") || searchParams.get("city");
  useEffect(() => {
    if (legacyRegion && !regionParam) navigate(regionCalendarPath(legacyRegion), { replace: true });
  }, [legacyRegion, regionParam]);

  const selectedCity = mode === "regions" ? regionParam ?? "" : "";
  const isIndiaSelected = sameName(selectedCity, "All-India");

  // ---- regions ---------------------------------------------------------------
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const fetchCities = async () => {
    setLoadingCities(true);
    try {
      setCities(await api.advestiment.cities());
    } catch (err: unknown) {
      toast.error("Could not load regions", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setLoadingCities(false);
    }
  };
  useEffect(() => {
    fetchCities();
  }, []);

  const cityRegions = useMemo(() => cities.filter((c) => !isNational(c)), [cities]);
  const allEvents = useMemo(() => cities.flatMap((c) => c.events ?? []), [cities]);
  const stateNames = useMemo(
    () => Array.from(new Set(cityRegions.map((c) => c.state).filter(Boolean))).sort(),
    [cityRegions]
  );

  // ---- calendar --------------------------------------------------------------
  const todayIso = isoDate(new Date());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [selectedDateStr, setSelectedDateStr] = useState(todayIso);
  const [events, setEvents] = useState<CityEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const fetchEvents = async (keepDate?: string) => {
    if (!selectedCity) return;
    setLoadingEvents(true);
    try {
      const data = await api.advestiment.events(selectedCity, calYear, calMonth + 1);
      setEvents(data);
      const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-`;
      setSelectedDateStr((current) => {
        if (keepDate) return keepDate;
        if (current.startsWith(monthPrefix)) return current;
        return data[0]?.date_start?.startsWith(monthPrefix) ? data[0].date_start : todayIso.startsWith(monthPrefix) ? todayIso : `${monthPrefix}01`;
      });
    } catch (err: unknown) {
      toast.error("Could not load the calendar", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setLoadingEvents(false);
    }
  };
  useEffect(() => {
    fetchEvents();
  }, [selectedCity, calYear, calMonth]);
  useEffect(() => {
    if (selectedCity) window.scrollTo({ top: 0 });
  }, [selectedCity]);

  const shiftMonth = (delta: number) => {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  };
  const goToday = () => {
    const now = new Date();
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth());
    setSelectedDateStr(todayIso);
  };

  const calendarDays = useMemo(() => {
    const first = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrev = new Date(calYear, calMonth, 0).getDate();
    const cells: { dayNumber: number; dateStr: string; events: CityEvent[] }[] = [];
    for (let i = first - 1; i >= 0; i--) cells.push({ dayNumber: daysInPrev - i, dateStr: "", events: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = isoDate(new Date(calYear, calMonth, d));
      cells.push({ dayNumber: d, dateStr, events: events.filter((ev) => coversDate(ev, dateStr)) });
    }
    for (let n = 1; cells.length % 7 !== 0; n++) cells.push({ dayNumber: n, dateStr: "", events: [] });
    return cells;
  }, [calYear, calMonth, events]);

  // ---- selected day: register / edit / poster -------------------------------
  const dayEvents = useMemo(() => events.filter((ev) => coversDate(ev, selectedDateStr)), [events, selectedDateStr]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const dayEvent = dayEvents.find((e) => e.id === selectedEventId) || dayEvents[0] || null;
  const dayCompleted = !!dayEvent && isCompleted(dayEvent, todayIso);

  const emptyForm = { title: "", description: "", code: "" };
  const [form, setForm] = useState(emptyForm);
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => {
    setForm(emptyForm);
    setFormMode("closed");
  }, [selectedDateStr, selectedCity]);

  const reloadAfterChange = async (date: string) => {
    await Promise.all([fetchEvents(date), fetchCities()]);
  };

  const openEdit = (ev: CityEvent) => {
    setSelectedEventId(ev.id);
    setForm({ title: ev.title, description: ev.description || "", code: ev.discount_code || "" });
    setFormMode("edit");
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    const code = form.code.trim();
    if (!title || !code) {
      toast.error("Missing Details", "Event name and coupon code are required.");
      return;
    }
    const payload = { title, description: form.description.trim(), discount_code: code };
    setSaving(true);
    try {
      const ev =
        formMode === "edit" && dayEvent
          ? await api.advestiment.updateRegisteredEvent(dayEvent.id, payload)
          : await api.advestiment.registerEvent({ city: selectedCity, date: selectedDateStr, ...payload });
      toast.success(formMode === "edit" ? "Event Updated" : "Event Registered", `${ev.title} · ${ev.date_start}. The poster agent is creating its poster.`);
      setSelectedEventId(ev.id);
      setPosterStatus({ status: "running" });
      await reloadAfterChange(ev.date_start);
      setForm(emptyForm);
      setFormMode("closed");
    } catch (err: unknown) {
      toast.error("Could not save event", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (ev: CityEvent) => {
    if (!window.confirm(`Delete "${ev.title}" from ${ev.date_start}?`)) return;
    setDeletingId(ev.id);
    try {
      await api.advestiment.deleteEvent(ev.id);
      toast.info("Event Deleted", `${ev.title} was removed from the calendar.`);
      setFormMode("closed");
      await reloadAfterChange(ev.date_start);
    } catch (err: unknown) {
      toast.error("Could not delete event", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  // ---- All-India festival finder ------------------------------------------------
  const [finder, setFinder] = useState<FestivalFinderStatus | null>(null);
  const [startingFinder, setStartingFinder] = useState(false);
  const loadFinder = () =>
    api.advestiment.finderStatus().then(setFinder).catch(() => setFinder(null));
  useEffect(() => {
    if (isIndiaSelected) loadFinder();
  }, [isIndiaSelected]);
  // While a run is going, poll it; when it ends, refresh the calendar and report the result
  useEffect(() => {
    if (!finder?.running) return;
    const timer = setTimeout(async () => {
      try {
        const st = await api.advestiment.finderStatus();
        setFinder(st);
        if (!st.running) {
          await Promise.all([fetchEvents(), fetchCities()]);
          if (st.last_run) {
            if (st.last_run.status === "success") toast.success("Festival Search Finished", st.last_run.summary);
            else toast.error("Festival Search Failed", st.last_run.summary);
          }
        }
      } catch {
        /* try again on the next tick */
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [finder]);

  // ---- Poster agent scan: this month and the next two --------------------------
  const [scan, setScan] = useState<PosterScanStatus | null>(null);
  const [startingScan, setStartingScan] = useState(false);
  const loadScan = () =>
    api.advestiment.posterScanStatus().then(setScan).catch(() => setScan(null));
  useEffect(() => {
    if (selectedCity) loadScan();
  }, [selectedCity, events]);
  useEffect(() => {
    if (!scan?.running) return;
    const timer = setTimeout(async () => {
      try {
        const st = await api.advestiment.posterScanStatus();
        setScan(st);
        if (!st.running) {
          await Promise.all([fetchEvents(), fetchCities()]);
          if (st.last) toast.success("Posters Ready", st.last.summary);
        }
      } catch {
        /* try again on the next tick */
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [scan]);

  const startScan = async () => {
    setStartingScan(true);
    try {
      const st = await api.advestiment.startPosterScan();
      setScan(st);
      toast.info(
        "Poster Agent Started",
        st.total
          ? `Creating ${st.total} poster${st.total === 1 ? "" : "s"} for ${st.window_start} to ${st.window_end} with Seedream 5.0 Flash.`
          : "Checking this month and the next two for festivals without a poster."
      );
    } catch (err: unknown) {
      toast.error("Could not start the poster agent", err instanceof Error ? err.message : "Please try again.");
      loadScan();
    } finally {
      setStartingScan(false);
    }
  };

  const startFinder = async () => {
    setStartingFinder(true);
    try {
      setFinder(await api.advestiment.startFinder());
      toast.info("Festival Search Started", "Reading Drik Panchang and choosing the major festivals. This takes about a minute.");
    } catch (err: unknown) {
      toast.error("Could not start the festival search", err instanceof Error ? err.message : "Please try again.");
      loadFinder();
    } finally {
      setStartingFinder(false);
    }
  };

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const decide = async (ev: CityEvent, approve: boolean) => {
    setDecidingId(ev.id);
    try {
      if (approve) {
        await api.advestiment.approveEvent(ev.id);
        toast.success("Festival Approved", `${ev.title} is published. The poster agent is creating its poster.`);
        setPosterStatus({ status: "running" });
      } else {
        await api.advestiment.rejectEvent(ev.id);
        toast.info("Festival Rejected", `${ev.title} was removed and will not be suggested again.`);
      }
      await reloadAfterChange(ev.date_start);
    } catch (err: unknown) {
      toast.error("Could not save the decision", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setDecidingId(null);
    }
  };

  // Poster agent progress for the selected event (polled while it is designing)
  const [posterStatus, setPosterStatus] = useState<PosterAgentStatus | null>(null);
  const autoStarted = useRef<Set<string>>(new Set());
  const posterEventId = dayEvent?.id ?? null;
  useEffect(() => {
    if (!posterEventId) {
      setPosterStatus(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        let st = await api.advestiment.posterStatus(posterEventId);
        // Event without a poster: start the poster agent once, automatically
        if (st.status === "none" && !dayCompleted && !autoStarted.current.has(posterEventId)) {
          autoStarted.current.add(posterEventId);
          st = await api.advestiment.restartPosterAgent(posterEventId);
        }
        if (stopped) return;
        setPosterStatus(st);
        if (st.status === "running") timer = setTimeout(check, 4000);
        // A regenerate failed but the previous poster is still there: keep showing it and tell the admin why
        else if (st.status === "failed" && st.poster_url)
          toast.error("New poster could not be created", `${st.error || "The poster agent failed."} The previous poster is kept.`);
        // Poster finished: reload the festival when its poster is new (first poster, or a regenerated one with a
        // new address such as ...poster?v=13), otherwise the page would keep showing the previous poster
        else if (st.status === "ready" && st.poster_url !== events.find((x) => x.id === posterEventId)?.poster_url)
          fetchEvents(selectedDateStr);
      } catch {
        if (!stopped) timer = setTimeout(check, 8000);
      }
    };
    check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [posterEventId, posterStatus?.status === "running"]);

  const retryPoster = async (ev: CityEvent) => {
    try {
      setPosterStatus(await api.advestiment.restartPosterAgent(ev.id));
    } catch (err: unknown) {
      toast.error("Poster agent did not start", err instanceof Error ? err.message : "Please try again.");
    }
  };

  // ---- add city ---------------------------------------------------------------
  const [showAddCity, setShowAddCity] = useState(false);
  const [newCity, setNewCity] = useState({ name: "", state: "" });
  const [addingCity, setAddingCity] = useState(false);
  const addCity = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCity.name.trim() || !newCity.state.trim()) {
      toast.error("Missing Details", "Enter the city and its state.");
      return;
    }
    setAddingCity(true);
    try {
      const created = await api.advestiment.addCity(newCity.name.trim(), newCity.state.trim());
      toast.success("City Added", `${created.city_name} (${created.state}) now has its own festival calendar.`);
      setShowAddCity(false);
      setNewCity({ name: "", state: "" });
      await fetchCities();
      navigate(regionCalendarPath(created.city_name));
    } catch (err: unknown) {
      toast.error("Could not add city", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setAddingCity(false);
    }
  };

  // ---- States & Cities grid -----------------------------------------------------
  const [regionQuery, setRegionQuery] = useState("");
  const regionGroups = useMemo(() => {
    const q = regionQuery.trim().toLowerCase();
    const match = (c: CitySummary) => !q || c.city_name.toLowerCase().includes(q) || (c.state || "").toLowerCase().includes(q);
    const groups: { title: string; subtitle: string; items: CitySummary[] }[] = [];
    const national = cities.filter((c) => isNational(c) && match(c));
    if (national.length) groups.push({ title: "India", subtitle: "National festivals & holidays", items: national });
    const byState = new Map<string, CitySummary[]>();
    cityRegions.filter(match).forEach((c) => {
      const key = c.state || "Other";
      byState.set(key, [...(byState.get(key) ?? []), c]);
    });
    [...byState.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([state, items]) =>
        groups.push({
          title: state,
          subtitle: `${items.length} ${items.length === 1 ? "city" : "cities"}`,
          items: [...items].sort((a, b) => a.city_name.localeCompare(b.city_name)),
        })
      );
    return groups;
  }, [cities, cityRegions, regionQuery]);

  // ---- dashboard metrics -----------------------------------------------------
  const monthLabel = `${MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const postersReady = allEvents.filter((e) => e.poster_url).length;
  const topDiscount = allEvents.reduce((m, e) => Math.max(m, e.suggested_discount || 0), 0);
  const upcoming = useMemo(
    () => [...allEvents].sort((a, b) => a.date_start.localeCompare(b.date_start)).slice(0, 6),
    [allEvents]
  );
  const byRegion = useMemo(
    () =>
      cities
        .map((c) => ({ name: isNational(c) ? "All-India" : c.city_name, count: c.upcoming_events_count }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count),
    [cities]
  );
  const maxRegionCount = Math.max(1, ...byRegion.map((r) => r.count));

  const regionLabel = isIndiaSelected ? "All-India" : selectedCity;
  const selectedRegion = cities.find((c) => sameName(c.city_name, selectedCity));

  // ==========================================================================
  const kpi = (icon: JSX.Element, tint: string, label: string, value: string, sub: string, onClick?: () => void) => (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={onClick}
      role={onClick ? "link" : undefined}
      style={{ ...card, borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px", cursor: onClick ? "pointer" : "default" }}
    >
      <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: `${tint}14`, border: `1px solid ${tint}33`, color: tint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>{label}</span>
        <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", lineHeight: 1.15, marginTop: "2px" }}>{value}</div>
        <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, marginTop: "2px", display: "block" }}>{sub}</span>
      </div>
    </motion.div>
  );

  const regionCard = (c: CitySummary) => {
    const national = isNational(c);
    const kind = c.region_type || (national ? "national" : "city");
    return (
      <motion.button
        key={c.city_name}
        type="button"
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate(regionCalendarPath(c.city_name))}
        style={{
          textAlign: "left", padding: "11px 13px", borderRadius: "11px", cursor: "pointer",
          border: national ? "1px solid #bfdbfe" : "1px solid #e2e8f0", background: national ? "#f8fbff" : "#ffffff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: "7px", minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            {national ? <Globe size={14} style={{ color: "#2563eb", flexShrink: 0 }} /> : <MapPin size={14} style={{ color: "#64748b", flexShrink: 0 }} />}
            <span title={c.city_name} style={{ fontSize: "12.5px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {national ? "India" : c.city_name}
            </span>
          </span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: national ? "#1d4ed8" : "#475569", background: national ? "#dbeafe" : "#f1f5f9", borderRadius: "6px", padding: "1px 6px", flexShrink: 0 }}>
            {REGION_TYPE_LABEL[kind] ?? kind}
          </span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "#64748b", fontWeight: 500 }}>
          <CalendarIcon size={12} />
          <b style={{ color: "#0f172a" }}>{c.upcoming_events_count}</b> upcoming {c.upcoming_events_count === 1 ? "festival" : "festivals"}
        </span>
      </motion.button>
    );
  };

  // ---- right panel of the calendar page ----------------------------------------
  const showPoster =
    formMode === "closed" && !!dayEvent && !isPending(dayEvent) && !!dayEvent.poster_url && posterStatus?.status !== "running";

  const dayPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {dayEvents.map((ev) => {
        const selected = dayEvent?.id === ev.id;
        const done = isCompleted(ev, todayIso);
        return (
          <div
            key={ev.id}
            onClick={() => setSelectedEventId(ev.id)}
            style={{
              border: done ? (selected ? "1.5px solid #94a3b8" : "1px solid #e2e8f0") : isPending(ev) ? (selected ? "1.5px solid #facc15" : "1px solid #fde68a") : selected ? "1.5px solid #86efac" : "1px solid #bbf7d0",
              background: done ? "#f8fafc" : isPending(ev) ? "#fefce8" : "#f0fdf4", borderRadius: "10px",
              padding: "10px 12px", display: "flex", gap: "10px", alignItems: "flex-start", cursor: dayEvents.length > 1 ? "pointer" : "default",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{ev.title}</div>
              {ev.description && (
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{ev.description}</div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
                <span style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.04em", borderRadius: "6px", padding: "2px 8px",
                  ...(done
                    ? { color: "#64748b", background: "#f1f5f9", border: "1px dashed #cbd5e1", textDecoration: "line-through" }
                    : { color: "#15803d", background: "#dcfce7", border: "1px dashed #86efac" }) }}>
                  {ev.discount_code}
                </span>
                {done && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: "#475569", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "2px 8px" }}>
                    <CheckCircle2 size={11} /> Completed
                  </span>
                )}
                {isPending(ev) && (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#a16207", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "6px", padding: "2px 8px" }}>
                    Awaiting approval
                  </span>
                )}
              </div>
              {ev.source === "drik_panchang" && (
                <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "6px", lineHeight: 1.45 }}>
                  {ev.source_url ? (
                    <a href={ev.source_url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                      Drik Panchang <ExternalLink size={10} />
                    </a>
                  ) : (
                    "Drik Panchang"
                  )}
                  {ev.admin_notes ? ` · ${ev.admin_notes}` : ""}
                </div>
              )}
              {isPending(ev) && (
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      decide(ev, true);
                    }}
                    disabled={decidingId === ev.id}
                    style={{ ...btnDark, background: "#16a34a", border: "1px solid #16a34a", padding: "6px 12px" }}
                  >
                    {decidingId === ev.id ? <RefreshCw size={12} className="spin" /> : <CheckCircle2 size={13} />}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      decide(ev, false);
                    }}
                    disabled={decidingId === ev.id}
                    style={{ ...btnLight, color: "#dc2626", border: "1px solid #fecaca", padding: "6px 12px" }}
                  >
                    <XCircle size={13} />
                    Reject
                  </button>
                </div>
              )}
            </div>
            {!done && <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(ev);
              }}
              aria-label={`Edit ${ev.title}`}
              style={{ ...btnLight, padding: "5px 10px", color: "#2563eb", border: "1px solid #bfdbfe", flexShrink: 0 }}
            >
              <Edit3 size={12} />
              Edit
            </button>}
          </div>
        );
      })}

      {formMode !== "closed" || (dayEvents.length === 0 && selectedDateStr >= todayIso) ? (
        <form onSubmit={submitForm} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {formMode === "edit" && <span style={smallHeading}>Edit event</span>}
          <label style={fieldLabel}>
            Event Name
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Diwali Mega Sale"
              required
              maxLength={160}
              style={field}
            />
          </label>
          <label style={fieldLabel}>
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is the festival and what offer do customers get?"
              rows={4}
              style={{ ...field, resize: "vertical" }}
            />
          </label>
          <label style={fieldLabel}>
            Coupon Code
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
              placeholder="e.g. DIWALI30"
              required
              maxLength={40}
              style={{ ...field, fontWeight: 700, letterSpacing: "0.05em" }}
            />
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            {formMode !== "closed" && (
              <button type="button" onClick={() => setFormMode("closed")} disabled={saving} style={{ ...btnLight, padding: "9px 14px", fontSize: "13px" }}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={saving} style={{ ...btnDark, flex: 1, justifyContent: "center", padding: "9px 16px", fontSize: "13px", fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
              {saving ? <RefreshCw size={13} className="spin" /> : <CheckCircle2 size={14} />}
              {saving ? "Saving…" : formMode === "edit" ? "Save Changes" : `Submit · Register for ${selectedDateStr}`}
            </button>
          </div>
          {formMode === "edit" && dayEvent && (
            <button
              type="button"
              onClick={() => deleteEvent(dayEvent)}
              disabled={deletingId === dayEvent.id}
              style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "5px", background: "transparent", border: "none", padding: 0, color: "#dc2626", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              {deletingId === dayEvent.id ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />}
              Delete this event
            </button>
          )}
        </form>
      ) : dayEvents.length === 0 ? (
        <div style={emptyBox}>{selectedDateStr} has passed. Pick today or a future date to register a festival.</div>
      ) : dayEvent && isPending(dayEvent) ? (
        <div style={{ ...emptyBox, border: "1px dashed #fde68a", background: "#fefce8", color: "#854d0e" }}>
          <b style={{ display: "block", marginBottom: "4px" }}>Approval needed</b>
          Approve {dayEvent.title} to publish it; the poster agent then creates its poster. Rejected festivals are removed.
        </div>
      ) : showPoster ? null : dayEvent && dayCompleted ? (
        <div style={emptyBox}>
          <b style={{ display: "block", marginBottom: "4px" }}>{dayEvent.title} is completed</b>
          No poster was created for this festival.
        </div>
      ) : dayEvent && (posterStatus?.status === "failed" || posterStatus?.status === "none") ? (
        <div style={posterStatus.status === "failed" ? { ...emptyBox, border: "1px dashed #fecaca", background: "#fef2f2", color: "#991b1b" } : emptyBox}>
          <b style={{ display: "block", marginBottom: "4px" }}>
            {posterStatus.status === "failed" ? "The poster agent could not create the poster" : `No poster yet for ${dayEvent.title}`}
          </b>
          {posterStatus.error && <span style={{ fontSize: "12px" }}>{posterStatus.error}</span>}
          <div>
            <button type="button" onClick={() => retryPoster(dayEvent)} style={{ ...btnDark, marginTop: "10px" }}>
              <RefreshCw size={12} /> {posterStatus.status === "failed" ? "Try Again" : "Create Poster"}
            </button>
          </div>
        </div>
      ) : dayEvent ? (
        <div style={{ ...emptyBox, border: "1px dashed #bfdbfe", background: "#eff6ff", color: "#1e40af", padding: "28px 16px" }}>
          <RefreshCw size={22} className="spin" style={{ color: "#2563eb", marginBottom: "8px" }} />
          <b style={{ display: "block", fontSize: "14px", marginBottom: "2px" }}>
            {dayEvent.knowledge?.summary ? "Agent 2 is creating the poster" : "Agent 1 is researching the festival"}
          </b>
          {dayEvent.knowledge?.summary
            ? `for ${dayEvent.title} from Agent 1's prompt. It appears here when ready (usually under a minute).`
            : `${dayEvent.title}: its meaning, religion and traditions, then writes the poster prompt for Agent 2.`}
        </div>
      ) : null}

      {/* Agent 1 output: structured festival details + the image prompt handed to Agent 2 */}
      {formMode === "closed" && dayEvent?.knowledge?.summary && (
        <ResearchPanel event={dayEvent} posterReady={Boolean(dayEvent.poster_url) && posterStatus?.status !== "running"} />
      )}

      {formMode === "closed" && dayEvents.length > 0 && selectedDateStr >= todayIso && (
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setFormMode("create");
          }}
          style={{ ...btnLight, alignSelf: "flex-start", color: "#2563eb", border: "1px dashed #93c5fd", background: "transparent" }}
        >
          <Plus size={12} /> Add another festival for this day
        </button>
      )}
    </div>
  );

  // ==========================================================================
  return (
    <div style={{ padding: mode === "regions" && selectedCity ? 0 : "0 0 5rem", maxWidth: "1560px", margin: "0 auto", boxSizing: "border-box", background: "#ffffff", color: "#0f172a" }}>
      {/* ===================== MARKETING RADAR (dashboard) ===================== */}
      {mode === "dashboard" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.6rem", flexWrap: "wrap", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#fffbeb", border: "1px solid #fef3c7", display: "flex", alignItems: "center", justifyContent: "center", color: "#d97706", flexShrink: 0 }}>
                <PartyPopper size={22} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {branding.company_name} Marketing &amp; Advertisement Dashboard
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "#64748b", fontWeight: 500 }}>
                  Festivals are registered by hand for All-India and each city; the poster agent designs a poster for each one.
                </p>
              </div>
            </div>
            <button type="button" onClick={fetchCities} disabled={loadingCities} style={btnLight}>
              <RefreshCw size={12} className={loadingCities ? "spin" : ""} />
              Refresh
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "14px", marginBottom: "1.8rem" }}>
            {kpi(<MapPin size={20} />, "#2563eb", "States & Cities", `${cityRegions.length} Cities`, "+ All-India calendar", () => navigate("/advertisement/regions"))}
            {kpi(<CalendarIcon size={20} />, "#d97706", "Upcoming Festivals", `${allEvents.length}`, `From ${monthLabel}`)}
            {kpi(<ImageIcon size={20} />, "#16a34a", "Posters Ready", `${postersReady}`, `${allEvents.length - postersReady} still to design`)}
            {kpi(<Tag size={20} />, "#7c3aed", "Top Discount", topDiscount > 0 ? `${topDiscount}% OFF` : "—", "Across registered coupons")}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "18px" }}>
            <div style={{ ...card, padding: "22px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <CalendarIcon size={17} style={{ color: "#ea580c" }} />
                Next Festivals
              </h3>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>The next festivals registered across all regions</span>
              {upcoming.length === 0 ? (
                <p style={{ margin: "14px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                  No festivals yet. Open States &amp; Cities, pick a region and click a date to register one.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }}>
                  {upcoming.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => navigate(regionCalendarPath(e.city))}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "9px 12px", background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: "8px", cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: "12.5px", fontWeight: 650, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                        <span style={{ fontSize: "11.5px", color: "#64748b" }}>{e.date_start} · {e.city}</span>
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: "6px", padding: "2px 8px", flexShrink: 0 }}>{e.discount_code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...card, padding: "22px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <BarChart3 size={17} style={{ color: "#2563eb" }} />
                Festivals by Region
              </h3>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>Upcoming festivals registered per region</span>
              {byRegion.length === 0 ? (
                <p style={{ margin: "14px 0 0", fontSize: "12.5px", color: "#64748b" }}>No festivals yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
                  {byRegion.map((r) => (
                    <div key={r.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", fontWeight: 650, marginBottom: "5px" }}>
                        <span>{r.name}</span>
                        <span>{r.count}</span>
                      </div>
                      <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "5px", overflow: "hidden" }}>
                        <div style={{ width: `${(r.count / maxRegionCount) * 100}%`, height: "100%", background: "#2563eb", borderRadius: "5px" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== STATES & CITIES (KPI cards) ===================== */}
      {mode === "regions" && !selectedCity && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#eff6ff", border: "1px solid #dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MapPin size={20} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>States &amp; Cities</h1>
                <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b", fontWeight: 500 }}>
                  All-India and {cityRegions.length} cities. Click a card to open its festival calendar and register festivals.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "6px 10px", background: "#ffffff" }}>
                <Search size={13} style={{ color: "#94a3b8" }} />
                <input
                  type="search"
                  value={regionQuery}
                  onChange={(e) => setRegionQuery(e.target.value)}
                  placeholder="Search city or state"
                  aria-label="Search cities and states"
                  style={{ border: "none", outline: "none", fontSize: "12.5px", width: "160px", background: "transparent", color: "#0f172a" }}
                />
              </label>
              <button type="button" onClick={() => setShowAddCity(true)} style={btnDark}>
                <Plus size={13} />
                Add City
              </button>
              <button type="button" onClick={fetchCities} disabled={loadingCities} title="Reload" aria-label="Reload regions" style={{ ...btnLight, padding: "7px 10px" }}>
                <RefreshCw size={12} className={loadingCities ? "spin" : ""} />
              </button>
            </div>
          </div>

          {loadingCities && cities.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: "#64748b" }}>Loading regions…</p>
          ) : regionGroups.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: "#64748b" }}>No city or state matches “{regionQuery}”.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              {regionGroups.map((g) => (
                <section key={g.title}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ ...smallHeading, letterSpacing: "0.06em" }}>{g.title}</span>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>{g.subtitle}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: "10px" }}>
                    {g.items.map(regionCard)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================== REGION CALENDAR PAGE ===================== */}
      {mode === "regions" && selectedCity && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "calc(100vh - 118px)", minHeight: "560px", marginBottom: "-56px" }}>
          <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", padding: "8px 12px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 320px" }}>
              <button type="button" onClick={() => navigate("/advertisement/regions")} title="All States & Cities" aria-label="Back to all states and cities" style={{ ...btnLight, padding: "6px 8px" }}>
                <ChevronLeft size={15} />
              </button>
              <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: "#eff6ff", border: "1px solid #dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {isIndiaSelected ? <Globe size={16} /> : <MapPin size={16} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, whiteSpace: "nowrap" }}>{regionLabel} Festival Calendar</h2>
                  <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: "10.5px", fontWeight: 650, padding: "2px 8px", borderRadius: "12px", whiteSpace: "nowrap" }}>
                    {isIndiaSelected ? "National" : selectedRegion?.state || "City"}
                  </span>
                </div>
                <div
                  title={isIndiaSelected && finder?.last_run ? finder.last_run.summary : undefined}
                  style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {isIndiaSelected && finder
                    ? finder.running
                      ? `Festival search running · ${finder.step || "starting"}…`
                      : !finder.configured
                      ? "Find Festivals needs OPENROUTER_API_KEY in backend/.env."
                      : finder.last_run
                      ? `Last search ${finder.last_run.ran_at.slice(0, 10)}: ${finder.last_run.summary}${finder.next_due ? ` Next due ${finder.next_due}.` : ""}`
                      : `Searches ${finder.source} for ${finder.window.join(", ")} with ${finder.model}. Every result needs your approval.`
                    : "Click a date to register a festival (name, description and coupon code)."}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              {isIndiaSelected && (
                <button
                  type="button"
                  onClick={startFinder}
                  disabled={!finder?.configured || finder.running || startingFinder}
                  title={
                    finder?.configured
                      ? `Read ${finder.source} for ${finder.window.join(", ")}; ${finder.model} picks the major festivals for your approval`
                      : "Add OPENROUTER_API_KEY to backend/.env to enable"
                  }
                  style={{
                    ...btnDark,
                    background: finder?.due ? "#2563eb" : "#0f172a",
                    border: finder?.due ? "1px solid #2563eb" : "1px solid #0f172a",
                    opacity: !finder?.configured ? 0.55 : 1,
                    cursor: finder?.running || startingFinder ? "wait" : !finder?.configured ? "not-allowed" : "pointer",
                  }}
                >
                  {finder?.running || startingFinder ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
                  {finder?.running ? "Searching…" : "Find Festivals"}
                </button>
              )}
              <button
                type="button"
                onClick={startScan}
                disabled={scan?.running || startingScan}
                title={
                  scan
                    ? `Poster agent: create a poster for every approved festival from ${scan.window_start} to ${scan.window_end} that has none (${scan.image_model})`
                    : "Create posters for this month and the next two"
                }
                style={{
                  ...btnDark,
                  background: scan && scan.waiting > 0 ? "#7c3aed" : "#0f172a",
                  border: scan && scan.waiting > 0 ? "1px solid #7c3aed" : "1px solid #0f172a",
                  cursor: scan?.running || startingScan ? "wait" : "pointer",
                }}
              >
                {scan?.running || startingScan ? <RefreshCw size={13} className="spin" /> : <ImageIcon size={13} />}
                {scan?.running
                  ? `Posters ${scan.done}/${scan.total}…`
                  : `Create Posters${scan && scan.waiting > 0 ? ` (${scan.waiting})` : ""}`}
              </button>
              <button type="button" onClick={goToday} style={btnLight}>Today</button>
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={{ ...btnLight, padding: "6px 9px" }}>
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontWeight: 700, fontSize: "14px", minWidth: "125px", textAlign: "center" }}>
                {MONTH_NAMES[calMonth]} {calYear}
              </span>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={{ ...btnLight, padding: "6px 9px" }}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Calendar and day panel fill the rest of the screen: no page scroll */}
          <div style={{ display: "grid", gridTemplateColumns: showPoster ? "minmax(0, 1fr) minmax(0, 1.2fr)" : "minmax(0, 1.4fr) minmax(0, 0.8fr)", gap: "12px", flex: 1, minHeight: 0 }}>
            <div style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px" }}>
                  <CalendarIcon size={16} style={{ color: "#2563eb" }} />
                  {MONTH_NAMES[calMonth]} {calYear} Schedule
                  {loadingEvents && <RefreshCw size={12} className="spin" style={{ color: "#2563eb" }} />}
                </span>
                <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "12px" }}>
                  {isIndiaSelected && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#fef9c3", border: "1px solid #fde68a" }} />
                      Awaiting approval
                    </span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#dcfce7", border: "1px solid #bbf7d0" }} />
                    {isIndiaSelected ? "Approved" : "Registered"}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#e2e8f0", border: "1px solid #cbd5e1" }} />
                    Completed
                  </span>
                  <span>Selected: <b style={{ color: "#0f172a" }}>{selectedDateStr}</b></span>
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "5px", marginBottom: "6px", textAlign: "center" }}>
                {WEEKDAY_NAMES.map((d) => (
                  <div key={d} style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", padding: "4px 0", background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: "6px" }}>
                    {d}
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridAutoRows: "minmax(0, 1fr)", gap: "5px", flex: 1, minHeight: 0 }}>
                {calendarDays.map((cell, idx) => {
                  const inMonth = !!cell.dateStr;
                  const selected = inMonth && cell.dateStr === selectedDateStr;
                  const isToday = cell.dateStr === todayIso;
                  const cellDone = cell.events.length > 0 && cell.events.every((ev) => isCompleted(ev, todayIso));
                  return (
                    <div
                      key={idx}
                      onClick={() => inMonth && setSelectedDateStr(cell.dateStr)}
                      style={{
                        minWidth: 0, overflow: "hidden", boxSizing: "border-box", borderRadius: "8px", padding: "4px 6px",
                        display: "flex", flexDirection: "column", gap: "2px",
                        background: !inMonth ? "#fcfcfc" : selected ? (cellDone ? "#f1f5f9" : "#f0fdf4") : cellDone ? "#f8fafc" : "#ffffff",
                        border: selected ? (cellDone ? "1.5px solid #64748b" : "1.5px solid #16a34a") : isToday ? "1px solid #93c5fd" : "1px solid #f1f5f9",
                        opacity: inMonth ? 1 : 0.35,
                        cursor: inMonth ? "pointer" : "default",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 650, color: cellDone ? "#64748b" : selected ? "#15803d" : isToday ? "#2563eb" : "#0f172a" }}>{cell.dayNumber}</span>
                        {cellDone && (
                          <span title="Completed" style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "9.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            <CheckCircle2 size={10} /> Done
                          </span>
                        )}
                      </span>
                      {cell.events.map((ev) => {
                        const done = isCompleted(ev, todayIso);
                        return (
                        <span
                          key={ev.id}
                          title={`${ev.title}${done ? " · completed" : isPending(ev) ? " · awaiting approval" : ""}`}
                          style={{
                            background: done ? "#e2e8f0" : isPending(ev) ? "#fef9c3" : "#dcfce7",
                            color: done ? "#475569" : isPending(ev) ? "#a16207" : "#15803d",
                            border: done ? "1px solid #cbd5e1" : isPending(ev) ? "1px solid #fde68a" : "1px solid #bbf7d0",
                            borderRadius: "4px", padding: "2px 5px", fontSize: "10px", fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        >
                          {done ? `✓ ${ev.title}` : ev.title}
                        </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", gap: "8px", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={16} style={{ color: "#d97706" }} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                      {(showPoster || dayCompleted) && dayEvent ? dayEvent.title : "Register Festival"}
                      {dayCompleted && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: "#475569", background: "#e2e8f0", borderRadius: "999px", padding: "2px 9px" }}>
                          <CheckCircle2 size={11} /> Completed
                        </span>
                      )}
                    </h3>
                    <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500 }}>{regionLabel} · {dayCompleted ? "festival is over · poster kept for reference" : showPoster ? "poster and offer" : "festival for this day"}</span>
                  </div>
                </div>
                <span style={{ background: "#f8fafc", border: "1px solid #e2e8f0", fontWeight: 650, fontSize: "11.5px", padding: "3px 10px", borderRadius: "12px", whiteSpace: "nowrap" }}>
                  {selectedDateStr}
                </span>
              </div>
              {showPoster && dayEvent ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: "14px", flex: 1, minHeight: 0 }}>
                  <div style={{ minHeight: 0, minWidth: 0 }}>
                    <FestivalPosterCard
                      event={dayEvent}
                      selectedCity={regionLabel}
                      selectedDateStr={selectedDateStr}
                      isIndiaSelected={isIndiaSelected}
                      fill
                      completed={dayCompleted}
                      onRegenerate={() => retryPoster(dayEvent)}
                    />
                  </div>
                  <div style={{ minHeight: 0, minWidth: 0, overflowY: "auto", paddingRight: "2px" }}>{dayPanel}</div>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "2px" }}>{dayPanel}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== ADD CITY ===================== */}
      <AnimatePresence>
        {showAddCity && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", backdropFilter: "blur(4px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <motion.form
              onSubmit={addCity}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ ...card, maxWidth: "420px", width: "100%", padding: "22px", display: "flex", flexDirection: "column", gap: "14px", boxShadow: "0 20px 50px rgba(0,0,0,0.15)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Add City</h3>
                <button type="button" onClick={() => setShowAddCity(false)} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b" }}>
                  <X size={18} />
                </button>
              </div>
              <label style={fieldLabel}>
                City
                <input
                  value={newCity.name}
                  onChange={(e) => setNewCity((c) => ({ ...c, name: e.target.value }))}
                  placeholder="e.g. Khammam"
                  autoFocus
                  required
                  style={field}
                />
              </label>
              <label style={fieldLabel}>
                State
                <input
                  value={newCity.state}
                  onChange={(e) => setNewCity((c) => ({ ...c, state: e.target.value }))}
                  placeholder="e.g. Telangana"
                  list="advert-state-names"
                  required
                  style={field}
                />
                <datalist id="advert-state-names">
                  {stateNames.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" onClick={() => setShowAddCity(false)} style={btnLight}>Cancel</button>
                <button type="submit" disabled={addingCity} style={btnDark}>
                  {addingCity ? <RefreshCw size={12} className="spin" /> : <Plus size={13} />}
                  {addingCity ? "Adding…" : "Add City"}
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
