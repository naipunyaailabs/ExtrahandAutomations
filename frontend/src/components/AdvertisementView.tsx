import {
  BarChart3,
  Bot,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  MapPin,
  MessageSquare,
  PartyPopper,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useToast } from "./ui";
import { FloatingAIAgent } from "./FloatingAIAgent";
import { FestivalPosterCard } from "./FestivalPosterCard";
import type { CityEvent, CitySummary, ScanResultResponse } from "../types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AdvertisementView() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const cityParam = searchParams.get("city");

  // Navigation View: "dashboard" (KPI cards, charts, city hubs) vs "city_calendar" (70% calendar, 30% day special)
  const [currentView, setCurrentView] = useState<"dashboard" | "city_calendar">(() =>
    cityParam ? "city_calendar" : "dashboard"
  );

  const [cities, setCities] = useState<CitySummary[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>(() => cityParam || "All-India");
  const [loadingCities, setLoadingCities] = useState(false);

  const [events, setEvents] = useState<CityEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Sync state when URL search param changes (e.g. user clicks sidebar cities)
  useEffect(() => {
    if (cityParam) {
      setSelectedCity(cityParam);
      setCurrentView("city_calendar");
    } else {
      setCurrentView("dashboard");
    }
  }, [cityParam]);

  // Selected date string (e.g. "2026-11-08") for the 30% Day Special panel
  const [selectedDateStr, setSelectedDateStr] = useState<string>("2026-11-08");

  // Add City Modal State (City Name + State + Min 2, Max 5 Data Sources)
  const [showAddCityModal, setShowAddCityModal] = useState(false);
  const [newCityName, setNewCityName] = useState("");
  const [newCityState, setNewCityState] = useState("Telangana");
  const [newDataSources, setNewDataSources] = useState<string[]>([
    "https://khammam.telangana.gov.in/",
    "https://www.ntnews.com/"
  ]);
  const [addingCity, setAddingCity] = useState(false);

  // Listen for sidebar "+" click or other triggers
  useEffect(() => {
    const handleOpenModal = () => setShowAddCityModal(true);
    window.addEventListener("open-add-city-modal", handleOpenModal);
    return () => window.removeEventListener("open-add-city-modal", handleOpenModal);
  }, []);

  const handleAddSource = () => {
    if (newDataSources.length < 5) {
      setNewDataSources((prev) => [...prev, ""]);
    }
  };

  const handleRemoveSource = (index: number) => {
    if (newDataSources.length > 2) {
      setNewDataSources((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSourceChange = (index: number, val: string) => {
    setNewDataSources((prev) => {
      const updated = [...prev];
      updated[index] = val;
      return updated;
    });
  };

  // Month Calendar Navigation State
  const [calYear, setCalYear] = useState<number>(2026);
  const [calMonth, setCalMonth] = useState<number>(10); // 10 = November (0-indexed)

  // AI Agent Event Scanner & Crawl Progress Modal
  const [scanning, setScanning] = useState(false);
  const [showCrawlModal, setShowCrawlModal] = useState<boolean>(false);
  const [crawlStep, setCrawlStep] = useState<number>(0);
  const [scanReport, setScanReport] = useState<ScanResultResponse | null>(null);

  // Multi-City Sequential Process State (One by One City)
  const ALL_MARKETING_CITIES = useMemo(() => [
    "Siddipet",
    "Warangal",
    "Mahabubnagar",
    "Karimnagar",
    "Kalwakurthy",
    "Nalgonda",
    "Jadcherla",
    "Nizamabad",
    "All-India",
  ], []);

  const [batchScanning, setBatchScanning] = useState(false);
  const [currentCityIndex, setCurrentCityIndex] = useState(0);
  const [currentBatchCity, setCurrentBatchCity] = useState("Siddipet");
  const stopRequestedRef = useRef(false);

  // Auto-start check when launched with ?start=true
  useEffect(() => {
    if (searchParams.get("start") === "true") {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("start");
        return next;
      });
      setTimeout(() => {
        handleStartProcess();
      }, 350);
    }
  }, [searchParams]);

  // Exact Monitored Data Source URLs for Selected City
  const selectedCitySources = useMemo<string[]>(() => {
    const c = cities.find((ci) => ci.city_name.toLowerCase() === selectedCity.toLowerCase());
    if (c?.data_sources && c.data_sources.length > 0) return c.data_sources;
    const defaults: Record<string, string[]> = {
      "Siddipet": [
        "https://siddipettimes.com/category/latest-news/",
        "https://siddipet.telangana.gov.in/"
      ],
      "Mahabubnagar": [
        "https://mahabubnagar.telangana.gov.in/",
        "https://www.mee24news.com/telangana/mahbubnagar"
      ],
      "Warangal": [
        "https://warangal.telangana.gov.in/",
        "https://www.warangaltimes.com/"
      ],
      "Karimnagar": [
        "https://karimnagar.telangana.gov.in/",
        "https://www.manamepaper.com/"
      ],
      "Kalwakurthy": [
        "https://nagarkurnool.telangana.gov.in/",
        "https://www.ntnews.com/"
      ],
      "Nalgonda": [
        "https://nalgonda.telangana.gov.in/",
        "https://www.manamepaper.com/"
      ],
      "Jadcherla": [
        "https://metronewsupdates.com/",
        "https://www.manamepaper.com/"
      ],
      "Nizamabad": [
        "https://nizamabad.telangana.gov.in/",
        "https://epaper.ntnews.com/Home/Index"
      ],
      "All-India": [
        "https://india.gov.in/calendar",
        "https://pib.gov.in/"
      ]
    };
    return defaults[selectedCity] || [
      `https://${selectedCity.toLowerCase()}.telangana.gov.in/`,
      "https://www.ntnews.com/"
    ];
  }, [cities, selectedCity]);

// Fetch Cities on Mount
  const fetchCities = async () => {
    setLoadingCities(true);
    try {
      const data = await api.advestiment.cities();
      setCities(data);
    } catch (err: unknown) {
      console.warn("Could not load cities:", err);
    } finally {
      setLoadingCities(false);
    }
  };

  useEffect(() => {
    fetchCities();
  }, []);

  // Fetch events whenever selectedCity changes
  const fetchEvents = async (city: string) => {
    setLoadingEvents(true);
    try {
      const data = await api.advestiment.events(city);
      setEvents(data);
      if (data.length > 0) {
        // Look for event in the currently viewed month
        const mStr = `-${String(calMonth + 1).padStart(2, "0")}-`;
        const yStr = `${calYear}-`;
        const inCurrentMonth = data.find(
          (e) => (e.date_start?.startsWith(yStr) && e.date_start?.includes(mStr)) || (e.date_end?.startsWith(yStr) && e.date_end?.includes(mStr))
        );
        if (inCurrentMonth?.date_start) {
          setSelectedDateStr(inCurrentMonth.date_start);
        } else {
          // If no event in current month, select upcoming event or the first available
          const todayIso = new Date().toISOString().slice(0, 10);
          const upcoming = data.find((e) => e.date_start >= todayIso) || data[0];
          if (upcoming?.date_start) {
            setSelectedDateStr(upcoming.date_start);
            const parts = upcoming.date_start.split("-");
            if (parts.length >= 2) {
              setCalYear(parseInt(parts[0], 10));
              setCalMonth(parseInt(parts[1], 10) - 1);
            }
          }
        }
      }
    } catch (err: unknown) {
      console.warn("Could not load city events:", err);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (selectedCity) {
      fetchEvents(selectedCity);
    }
  }, [selectedCity]);

  // Open dedicated calendar page for a clicked city (or India)
  const openCityCalendar = (cityName: string) => {
    setSelectedCity(cityName);
    setCurrentView("city_calendar");
    setSearchParams({ city: cityName });
    fetchEvents(cityName);
  };

  // Add a new city with data sources (Min 2, Max 5)
  const handleAddCity = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCityName.trim();
    if (!trimmed) {
      toast.error("City Name Required", "Please enter the city name.");
      return;
    }

    const validSources = newDataSources.map((s) => s.trim()).filter((s) => s.length > 0);
    if (validSources.length < 2) {
      toast.error("Data Sources Required", "Please provide at least 2 data sources (minimum 2, maximum 5).");
      return;
    }
    if (validSources.length > 5) {
      toast.error("Maximum 5 Sources", "You can specify at most 5 data sources.");
      return;
    }

    setAddingCity(true);
    try {
      const stateToSave = newCityState.trim() || "Telangana";
      const created = await api.advestiment.addCity(trimmed, stateToSave, validSources);
      setCities((prev) => [...prev, created]);
      setSelectedCity(created.city_name);
      setNewCityName("");
      setNewCityState("Telangana");
      setNewDataSources([
        "District Tourism & Festival Portal",
        "Regional Daily News & Community Bulletins"
      ]);
      setShowAddCityModal(false);
      window.dispatchEvent(new CustomEvent("city-added", { detail: created }));
      toast.success(
        "City Added",
        `${created.city_name} (${created.state}) saved to database with ${validSources.length} verified data sources!`
      );
      openCityCalendar(created.city_name);
    } catch (err: unknown) {
      toast.error("Failed to add city", (err as Error).message);
    } finally {
      setAddingCity(false);
    }
  };

  // Trigger Autonomous AI Agent across all cities one by one
  const handleStartProcess = async () => {
    stopRequestedRef.current = false;
    setBatchScanning(true);
    setScanning(true);
    setShowCrawlModal(true);
    toast.info("Process Started", "Autonomous Marketing Agent is scanning all cities one by one...");

    for (let i = 0; i < ALL_MARKETING_CITIES.length; i++) {
      if (stopRequestedRef.current) break;
      const city = ALL_MARKETING_CITIES[i];
      setCurrentCityIndex(i);
      setCurrentBatchCity(city);
      setSelectedCity(city);
      setCrawlStep(1);

      await new Promise((r) => setTimeout(r, 600));
      if (stopRequestedRef.current) break;
      setCrawlStep(2);

      try {
        const result = await api.advestiment.scan({
          city,
          use_openrouter: true,
        });
        if (stopRequestedRef.current) break;
        setCrawlStep(3);
        setScanReport(result);
        await new Promise((r) => setTimeout(r, 600));
        setCrawlStep(4);

        if (result.events_discovered && result.events_discovered.length > 0) {
          setEvents(result.events_discovered);
          setSelectedDateStr(result.events_discovered[0].date_start);
        }

        toast.success(
          `Scanned ${city} (${i + 1}/${ALL_MARKETING_CITIES.length})`,
          `Discovered ${result.events_discovered?.length || 0} festival event(s) & prepared WhatsApp promotions.`
        );
      } catch (err: any) {
        console.warn(`Scan for ${city} warning:`, err);
      }

      await fetchCities();
      await new Promise((r) => setTimeout(r, 700));
    }

    if (stopRequestedRef.current) {
      toast.warning("Process Stopped", "Autonomous sequential scanning was stopped.");
    } else {
      toast.success(
        "Autonomous Process Completed",
        `All ${ALL_MARKETING_CITIES.length} cities successfully processed one by one!`
      );
    }

    setBatchScanning(false);
    setScanning(false);
  };

  const handleStopProcess = () => {
    stopRequestedRef.current = true;
    setBatchScanning(false);
    setScanning(false);
    toast.warning("Process Stopped", "Autonomous sequential scanning has been halted.");
  };

  // Trigger Autonomous AI Agent to sequentially read city news and district websites one by one
  const handleTriggerScan = async () => {
    setScanning(true);
    setShowCrawlModal(true);
    setCrawlStep(1); // Reading source 1

    const timer1 = setTimeout(() => {
      if (selectedCitySources.length > 1) {
        setCrawlStep(2);
      }
    }, 850);

    const timer2 = setTimeout(() => {
      setCrawlStep(3); // Analyzing festival demand & generating WhatsApp promos
    }, 1700);

    try {
      const result = await api.advestiment.scan({
        city: selectedCity,
        use_openrouter: true,
      });
      clearTimeout(timer1);
      clearTimeout(timer2);
      setScanReport(result);
      setCrawlStep(4); // Complete
      if (result.events_discovered && result.events_discovered.length > 0) {
        setEvents(result.events_discovered);
        setSelectedDateStr(result.events_discovered[0].date_start);
      }
      toast.success(
        "Autonomous Crawl Complete",
        `Read all websites for ${selectedCity}. Discovered ${result.events_discovered.length} event(s) and prepared targeted customer promos.`
      );
      fetchCities();
    } catch (err: unknown) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      toast.error("Scan Failed", (err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  // Month navigation handlers (Dynamically syncs events & selected date)
  const handlePrevMonth = () => {
    let newMonth: number;
    let newYear = calYear;
    if (calMonth === 0) {
      newMonth = 11;
      newYear = calYear - 1;
    } else {
      newMonth = calMonth - 1;
    }
    setCalMonth(newMonth);
    setCalYear(newYear);

    // Auto-select event in the newly selected month if present
    const mStr = `-${String(newMonth + 1).padStart(2, "0")}-`;
    const yStr = `${newYear}-`;
    const inMonth = events.find(
      (e) => (e.date_start?.startsWith(yStr) && e.date_start?.includes(mStr)) || (e.date_end?.startsWith(yStr) && e.date_end?.includes(mStr))
    );
    if (inMonth?.date_start) {
      setSelectedDateStr(inMonth.date_start);
    } else {
      setSelectedDateStr(`${newYear}-${String(newMonth + 1).padStart(2, "0")}-01`);
    }
  };

  const handleNextMonth = () => {
    let newMonth: number;
    let newYear = calYear;
    if (calMonth === 11) {
      newMonth = 0;
      newYear = calYear + 1;
    } else {
      newMonth = calMonth + 1;
    }
    setCalMonth(newMonth);
    setCalYear(newYear);

    // Auto-select event in the newly selected month if present
    const mStr = `-${String(newMonth + 1).padStart(2, "0")}-`;
    const yStr = `${newYear}-`;
    const inMonth = events.find(
      (e) => (e.date_start?.startsWith(yStr) && e.date_start?.includes(mStr)) || (e.date_end?.startsWith(yStr) && e.date_end?.includes(mStr))
    );
    if (inMonth?.date_start) {
      setSelectedDateStr(inMonth.date_start);
    } else {
      setSelectedDateStr(`${newYear}-${String(newMonth + 1).padStart(2, "0")}-01`);
    }
  };

  const handleToday = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    setCalYear(y);
    setCalMonth(m);
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    setSelectedDateStr(`${y}-${mm}-${dd}`);
  };


  // Generate calendar days matrix
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(calYear, calMonth, 1).getDay();
    const daysInCurrentMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    const days = [];

    // Leading days from previous month
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      days.push({
        dayNumber: daysInPrevMonth - i,
        isCurrentMonth: false,
        dateStr: "",
        events: [] as CityEvent[]
      });
    }

    // Days in current month
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const mm = String(calMonth + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      const dateStr = `${calYear}-${mm}-${dd}`;

      // Find events that span this date
      const matchedEvents = events.filter((ev) => {
        if (!ev.date_start) return false;
        const start = ev.date_start;
        const end = ev.date_end || ev.date_start;
        return dateStr >= start && dateStr <= end;
      });

      days.push({
        dayNumber: d,
        isCurrentMonth: true,
        dateStr,
        events: matchedEvents
      });
    }

    // Trailing days to fill the final week
    const totalCells = Math.ceil(days.length / 7) * 7;
    let nextMonthDay = 1;
    while (days.length < totalCells) {
      days.push({
        dayNumber: nextMonthDay++,
        isCurrentMonth: false,
        dateStr: "",
        events: [] as CityEvent[]
      });
    }

    return days;
  }, [calYear, calMonth, events]);

  // Find the event corresponding to the selected date
  const daySpecialEvent = useMemo(() => {
    return events.find((ev) => {
      if (!ev.date_start) return false;
      const start = ev.date_start;
      const end = ev.date_end || ev.date_start;
      return selectedDateStr >= start && selectedDateStr <= end;
    }) || null;
  }, [events, selectedDateStr]);

  // Common Overall India National Card
  const indiaCard = useMemo(() => {
    return cities.find((c) => c.is_national || c.city_name === "All-India") || {
      city_name: "All-India",
      state: "National Festivals & Public Events",
      active_campaigns: 26,
      upcoming_events_count: 26,
      top_demand_service: "Deep Cleaning & Painting",
      featured_discount: "Up to 30% OFF",
      is_national: true,
      events: []
    };
  }, [cities]);

  // Regional City Cards (Telangana hubs)
  const regionalCityCards = useMemo(() => {
    return cities.filter((c) => !c.is_national && c.city_name !== "All-India");
  }, [cities]);

  // Total metrics for Dashboard KPI cards
  const totalCitiesCount = cities.length > 0 ? cities.length : 9;
  const totalEventsCount = useMemo(() => {
    const regionalSum = regionalCityCards.reduce((acc, c) => acc + (c.upcoming_events_count || 0), 0);
    return regionalSum + (indiaCard.upcoming_events_count || 3);
  }, [regionalCityCards, indiaCard]);
  const totalAdsSent = 1420;

  const isIndiaSelected = selectedCity.toLowerCase() === "all-india";

  return (
    <div
      className="advertisement-container"
      style={{
        padding: "0 0 5rem",
        maxWidth: "1560px",
        margin: "0 auto",
        position: "relative",
        boxSizing: "border-box",
        background: "#ffffff",
        color: "#0f172a"
      }}
    >
      {/* =========================================================================
          VIEW 1: MARKETING & ADVERTISEMENT DASHBOARD
          CLEAN, MINIMALIST MODERN SAAS DESIGN
          ========================================================================= */}
      {currentView === "dashboard" ? (
        <div>
          {/* Header Row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.6rem", flexWrap: "wrap", gap: "14px", paddingTop: "0.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "10px",
                background: "#fffbeb",
                border: "1px solid #fef3c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#d97706",
                flexShrink: 0
              }}>
                <PartyPopper size={22} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>
                  ExtraHand Marketing &amp; Advertisement Dashboard
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "#64748b", fontWeight: 500 }}>
                  Area-based festival marketing engine. Predicts local demand spikes and automatically prepares customer WhatsApp promos.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                padding: "6px 14px",
                borderRadius: "20px",
                fontSize: "11.5px",
                color: "#15803d",
                fontWeight: 650
              }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#16a34a" }} />
                <span>Marketing Radar Active</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCityModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "7px 15px",
                  background: "#0f172a",
                  border: "1px solid #0f172a",
                  borderRadius: "8px",
                  color: "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                }}
              >
                <Plus size={13} />
                <span>Add City</span>
              </button>
              <button
                type="button"
                onClick={fetchCities}
                disabled={loadingCities}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "7px 15px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  color: "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                }}
              >
                <RefreshCw size={12} className={loadingCities ? "spin" : ""} />
                <span>Refresh Sync</span>
              </button>
            </div>
          </div>

          {/* 4 TOP MARKETING KPI CARDS - CLEAN MODERN MINIMALIST DESIGN */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: "14px",
            marginBottom: "1.8rem"
          }}>
            {/* KPI Card 1: Active Cities */}
            <motion.div
              whileHover={{ y: -2 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
              }}
            >
              <div style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "#eff6ff",
                border: "1px solid #dbeafe",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <MapPin size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>
                  Active Cities
                </span>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", lineHeight: 1.15, marginTop: "2px" }}>
                  {totalCitiesCount} Cities
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, marginTop: "2px", display: "block" }}>
                  Telangana hubs &amp; All-India
                </span>
              </div>
            </motion.div>

            {/* KPI Card 2: Events This Month */}
            <motion.div
              whileHover={{ y: -2 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
              }}
            >
              <div style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "#fffbeb",
                border: "1px solid #fef3c7",
                color: "#d97706",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <CalendarIcon size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>
                  Events This Month
                </span>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", lineHeight: 1.15, marginTop: "2px" }}>
                  {totalEventsCount} Events
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, marginTop: "2px", display: "block" }}>
                  November 2026 local surges
                </span>
              </div>
            </motion.div>

            {/* KPI Card 3: WhatsApp Promos Sent */}
            <motion.div
              whileHover={{ y: -2 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
              }}
            >
              <div style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "#f0fdf4",
                border: "1px solid #dcfce7",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <MessageSquare size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>
                  WhatsApp Promos Sent
                </span>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", lineHeight: 1.15, marginTop: "2px" }}>
                  {totalAdsSent.toLocaleString()} Messages
                </div>
                <span style={{ fontSize: "11.5px", color: "#15803d", fontWeight: 600, marginTop: "2px", display: "block" }}>
                  98.4% Delivery rate
                </span>
              </div>
            </motion.div>

            {/* KPI Card 4: Booking Conversion */}
            <motion.div
              whileHover={{ y: -2 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
              }}
            >
              <div style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "#faf5ff",
                border: "1px solid #f3e8ff",
                color: "#7c3aed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                <TrendingUp size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>
                  Booking Conversion
                </span>
                <div style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", lineHeight: 1.15, marginTop: "2px" }}>
                  38.4% Conv
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500, marginTop: "2px", display: "block" }}>
                  545 orders (₹3.85L GMV)
                </span>
              </div>
            </motion.div>
          </div>

          {/* ANALYTICS SECTION: DEMAND SURGES & MARKETING FUNNEL */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
            gap: "18px",
            marginBottom: "2.2rem"
          }}>
            {/* Chart 1: Festival Demand Surge Percentage */}
            <div style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "14px",
              padding: "22px",
              boxSizing: "border-box",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px", color: "#0f172a" }}>
                    <TrendingUp size={17} style={{ color: "#ea580c" }} />
                    <span>Festival Demand Surge by City &amp; Area (%)</span>
                  </h3>
                  <span style={{ fontSize: "12px", color: "#64748b", display: "block", marginTop: "2px", fontWeight: 500 }}>
                    Incremental ExtraHand customer demand driven by upcoming festivals
                  </span>
                </div>
                <span style={{
                  background: "#fff7ed",
                  border: "1px solid #ffedd5",
                  color: "#ea580c",
                  fontWeight: 650,
                  fontSize: "11px",
                  padding: "3px 10px",
                  borderRadius: "20px"
                }}>
                  ● Live Radar Spikes
                </span>
              </div>

              {/* Demand Surge Visual Bars */}
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 650, marginBottom: "6px" }}>
                    <span style={{ color: "#0f172a" }}>All-India · Diwali Festival of Lights</span>
                    <span style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontWeight: 700, fontSize: "11.5px", padding: "1px 7px", borderRadius: "5px" }}>
                      +95% Spike
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{ width: "95%", height: "100%", background: "linear-gradient(90deg, #f97316 0%, #ef4444 100%)", borderRadius: "5px" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px", display: "block", fontWeight: 500 }}>
                    Target Service: Deep Cleaning, Balcony Wash &amp; Complete Whitewashing
                  </span>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 650, marginBottom: "6px" }}>
                    <span style={{ color: "#0f172a" }}>Warangal · Bhadrakali Deepotsavam</span>
                    <span style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c", fontWeight: 700, fontSize: "11.5px", padding: "1px 7px", borderRadius: "5px" }}>
                      +92% Spike
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{ width: "92%", height: "100%", background: "linear-gradient(90deg, #f59e0b 0%, #ea580c 100%)", borderRadius: "5px" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px", display: "block", fontWeight: 500 }}>
                    Target Service: Temple Illumination, Switchboard Fixes &amp; Safety Wiring
                  </span>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 650, marginBottom: "6px" }}>
                    <span style={{ color: "#0f172a" }}>Siddipet · Komuravelli Mallanna Jathara</span>
                    <span style={{ background: "#fefce8", border: "1px solid #fef08a", color: "#a16207", fontWeight: 700, fontSize: "11.5px", padding: "1px 7px", borderRadius: "5px" }}>
                      +85% Spike
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{ width: "85%", height: "100%", background: "linear-gradient(90deg, #eab308 0%, #f59e0b 100%)", borderRadius: "5px" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px", display: "block", fontWeight: 500 }}>
                    Target Service: Pilgrim Guest House Sanitization &amp; Floor Scrubbing
                  </span>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 650, marginBottom: "6px" }}>
                    <span style={{ color: "#0f172a" }}>Mahabubnagar · Manyamkonda Utsavam</span>
                    <span style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", fontWeight: 700, fontSize: "11.5px", padding: "1px 7px", borderRadius: "5px" }}>
                      +78% Spike
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{ width: "78%", height: "100%", background: "linear-gradient(90deg, #10b981 0%, #059669 100%)", borderRadius: "5px" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px", display: "block", fontWeight: 500 }}>
                    Target Service: Water Sump &amp; Overhead Tank Cleaning, Whitewash
                  </span>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px", fontWeight: 650, marginBottom: "6px" }}>
                    <span style={{ color: "#0f172a" }}>Karimnagar · Kondagattu Hanuman Jayanthi</span>
                    <span style={{ background: "#ecfeff", border: "1px solid #a5f3fc", color: "#0e7490", fontWeight: 700, fontSize: "11.5px", padding: "1px 7px", borderRadius: "5px" }}>
                      +65% Spike
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "7px", background: "#f1f5f9", borderRadius: "5px", overflow: "hidden" }}>
                    <div style={{ width: "65%", height: "100%", background: "linear-gradient(90deg, #06b6d4 0%, #0284c7 100%)", borderRadius: "5px" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px", display: "block", fontWeight: 500 }}>
                    Target Service: Pipe Line Flushes &amp; Emergency Water Motor Setup
                  </span>
                </div>
              </div>
            </div>

            {/* Chart 2: Marketing Channel Performance & Customer Conversion */}
            <div style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "14px",
              padding: "22px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxSizing: "border-box",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
            }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px", color: "#0f172a" }}>
                      <BarChart3 size={17} style={{ color: "#2563eb" }} />
                      <span>Marketing Channels &amp; Performance</span>
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b", display: "block", marginTop: "2px", fontWeight: 500 }}>
                      Customer acquisition efficiency across advertisement methods
                    </span>
                  </div>
                  <span style={{
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    color: "#2563eb",
                    fontWeight: 650,
                    fontSize: "11px",
                    padding: "3px 10px",
                    borderRadius: "20px"
                  }}>
                    High Converting
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* Channel 1: WhatsApp */}
                  <div style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16a34a" }} />
                        <span style={{ fontSize: "12.5px", fontWeight: 650, color: "#0f172a" }}>WhatsApp Direct Broadcasts</span>
                      </div>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", padding: "1px 7px", borderRadius: "5px" }}>
                        38.4% Conversion
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", fontSize: "11.5px", marginTop: "3px" }}>
                      <span style={{ color: "#64748b", fontWeight: 500 }}>1,420 Dispatched · 1,398 Delivered</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>545 Bookings Generated</span>
                    </div>
                  </div>

                  {/* Channel 2: In-App Banners */}
                  <div style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2563eb" }} />
                        <span style={{ fontSize: "12.5px", fontWeight: 650, color: "#0f172a" }}>In-App Festive Promo Banners</span>
                      </div>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1px 7px", borderRadius: "5px" }}>
                        44.0% Conversion
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", fontSize: "11.5px", marginTop: "3px" }}>
                      <span style={{ color: "#64748b", fontWeight: 500 }}>2,850 Banners · 890 Clicks</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>392 Redemptions</span>
                    </div>
                  </div>

                  {/* Channel 3: SMS Flash */}
                  <div style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#d97706" }} />
                        <span style={{ fontSize: "12.5px", fontWeight: 650, color: "#0f172a" }}>Area SMS Flash Notifications</span>
                      </div>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", padding: "1px 7px", borderRadius: "5px" }}>
                        27.1% Conversion
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", fontSize: "11.5px", marginTop: "3px" }}>
                      <span style={{ color: "#64748b", fontWeight: 500 }}>620 SMS Delivered · 410 Opened</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>168 Fast Bookings</span>
                    </div>
                  </div>

                  {/* Channel 4: Referrals */}
                  <div style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#7c3aed" }} />
                        <span style={{ fontSize: "12.5px", fontWeight: 650, color: "#0f172a" }}>Partner Referrals &amp; Community Links</span>
                      </div>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#6b21a8", background: "#faf5ff", border: "1px solid #e9d5ff", padding: "1px 7px", borderRadius: "5px" }}>
                        40.0% Conversion
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", fontSize: "11.5px", marginTop: "3px" }}>
                      <span style={{ color: "#64748b", fontWeight: 500 }}>310 Shared Links · 220 Clicks</span>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>124 Verified Orders</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Insight Box */}
              <div style={{
                marginTop: "16px",
                padding: "12px 16px",
                background: "#fffbeb",
                border: "1px solid #fef3c7",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center"
              }}>
                <span style={{ fontSize: "12px", color: "#92400e", fontWeight: 500, lineHeight: 1.4 }}>
                  💡 <b style={{ color: "#78350f" }}>Marketing Insight:</b> Automated festive WhatsApp campaigns deliver 3.2x higher ROI and faster booking responses than cold calling.
                </span>
              </div>
            </div>
          </div>


        </div>
      ) : (
        /* =========================================================================
            VIEW 2: DEDICATED CITY CALENDAR PAGE
            CLEAN, MINIMALIST MODERN SAAS DESIGN (70% CALENDAR / 30% DAY SPECIAL)
            ========================================================================= */
        <div>
          {/* Top Month Controls Bar */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
            gap: "14px",
            padding: "14px 20px",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
          }}>
            {/* Left: City Icon + Title + Live Badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "#eff6ff",
                border: "1px solid #dbeafe",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}>
                {isIndiaSelected ? <Globe size={20} /> : <MapPin size={20} />}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {isIndiaSelected ? "Government of India · National Calendar" : `${selectedCity} Regional Festival & Events Calendar`}
                  </h2>
                  <span style={{
                    background: isIndiaSelected ? "#eff6ff" : "#f0fdf4",
                    border: isIndiaSelected ? "1px solid #bfdbfe" : "1px solid #bbf7d0",
                    color: isIndiaSelected ? "#1d4ed8" : "#15803d",
                    fontSize: "11px",
                    fontWeight: 650,
                    padding: "3px 9px",
                    borderRadius: "12px",
                    whiteSpace: "nowrap"
                  }}>
                    {isIndiaSelected ? "Gazetted National Calendar" : "Live City Calendar"}
                  </span>
                </div>
                <span style={{ fontSize: "12px", color: "#64748b", display: "block", marginTop: "2px", fontWeight: 500 }}>
                  {isIndiaSelected
                    ? "Official Gazetted Public Holidays, National Festivals & Countrywide ExtraHand Promos (india.gov.in)."
                    : `Official district portals and local festival radar mapped to ExtraHand service spikes in ${selectedCity}.`}
                </span>
              </div>
            </div>

            {/* Right Action Bar: Month Switcher Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <button
                type="button"
                onClick={handleToday}
                style={{
                  fontSize: "12px",
                  padding: "6px 14px",
                  fontWeight: 600,
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  color: "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease"
                }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={handlePrevMonth}
                style={{
                  padding: "6px 9px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  color: "#475569",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontWeight: 700, fontSize: "14px", minWidth: "125px", textAlign: "center", color: "#0f172a" }}>
                {MONTH_NAMES[calMonth]} {calYear}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                style={{
                  padding: "6px 9px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  color: "#475569",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* MONITORED DATA SOURCES & AUTONOMOUS AI CRAWLER ACTION BAR */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.25rem",
            flexWrap: "wrap",
            gap: "12px",
            padding: "12px 18px",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
          }}>
            {/* Left: Monitored Portals */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>
                <Bot size={16} style={{ color: "#2563eb" }} />
                <span>Monitored Sources ({selectedCitySources.length} Official Portals):</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {selectedCitySources.map((url, idx) => {
                  let cleanDisplay = url.replace("https://", "").replace("http://", "").replace("www.", "");
                  if (cleanDisplay.endsWith("/")) cleanDisplay = cleanDisplay.slice(0, -1);
                  if (cleanDisplay.length > 28) cleanDisplay = cleanDisplay.slice(0, 26) + "…";

                  return (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "11.5px",
                        fontWeight: 500,
                        color: "#334155",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        padding: "4px 10px",
                        borderRadius: "8px",
                        textDecoration: "none",
                        transition: "all 0.15s ease"
                      }}
                      title={`Open ${url}`}
                    >
                      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#16a34a" }} />
                      <span>{cleanDisplay}</span>
                      <ExternalLink size={11} style={{ color: "#94a3b8" }} />
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Right: Autonomous Web Reading Agent Button */}
            <button
              type="button"
              onClick={handleTriggerScan}
              disabled={scanning}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                fontSize: "12px",
                fontWeight: 650,
                padding: "7px 15px",
                background: "#0f172a",
                border: "1px solid #0f172a",
                borderRadius: "8px",
                color: "#ffffff",
                cursor: scanning ? "wait" : "pointer",
                transition: "all 0.15s ease",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
              }}
            >
              {scanning ? (
                <>
                  <RefreshCw size={13} className="spin" style={{ color: "#60a5fa" }} />
                  <span>Reading Websites Sequentially...</span>
                </>
              ) : (
                <>
                  <Bot size={14} style={{ color: "#60a5fa" }} />
                  <span>AI Agent: Read Websites &amp; Scan Events</span>
                </>
              )}
            </button>
          </div>

          {/* TWO-COLUMN RESPONSIVE GRID (70% CALENDAR / 30% DAY SPECIAL) */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 7fr) minmax(350px, 3.2fr)",
            gap: "20px",
            alignItems: "flex-start",
            width: "100%",
            boxSizing: "border-box"
          }}>
            {/* 70% LEFT: MONTHLY CALENDAR GRID */}
            <div style={{
              minWidth: 0,
              width: "100%",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "14px",
              padding: "20px",
              boxSizing: "border-box",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CalendarIcon size={18} style={{ color: "#2563eb" }} />
                  <span style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a" }}>
                    {MONTH_NAMES[calMonth]} {calYear} Schedule
                  </span>
                  {loadingEvents && <RefreshCw size={12} className="spin" style={{ color: "#2563eb" }} />}
                </div>
                <span style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap", fontWeight: 500 }}>
                  Selected Date: <b style={{ color: "#0f172a" }}>{selectedDateStr}</b>
                </span>
              </div>

              {/* 7-Column Day Header (Sun-Sat) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "6px", marginBottom: "8px", textAlign: "center" }}>
                {WEEKDAY_NAMES.map((d) => (
                  <div key={d} style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "#64748b",
                    padding: "6px 0",
                    background: "#f8fafc",
                    border: "1px solid #f1f5f9",
                    borderRadius: "8px",
                    minWidth: 0
                  }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* 7-Column Day Cells Matrix: ONLY SHOW DATE AND SPECIAL OF THAT DAY IN GREEN! */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "6px" }}>
                {calendarDays.map((cell, idx) => {
                  const hasEvents = cell.events.length > 0;
                  const isDateSelected = cell.dateStr === selectedDateStr;

                  return (
                    <div
                      key={idx}
                      style={{
                        minHeight: "96px",
                        minWidth: 0,
                        overflow: "hidden",
                        boxSizing: "border-box",
                        background: !cell.isCurrentMonth
                          ? "#fcfcfc"
                          : isDateSelected
                          ? "#f0fdf4"
                          : "#ffffff",
                        border: isDateSelected
                          ? "1.5px solid #16a34a"
                          : "1px solid #f1f5f9",
                        borderRadius: "10px",
                        padding: "8px",
                        display: "flex",
                        flexDirection: "column",
                        opacity: cell.isCurrentMonth ? 1 : 0.35,
                        transition: "all 0.15s ease",
                        cursor: cell.isCurrentMonth ? "pointer" : "default"
                      }}
                      onClick={() => {
                        if (cell.isCurrentMonth && cell.dateStr) {
                          setSelectedDateStr(cell.dateStr);
                        }
                      }}
                    >
                      {/* Date number */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{
                          fontSize: "13px",
                          fontWeight: 650,
                          color: isDateSelected ? "#15803d" : "#0f172a"
                        }}>
                          {cell.dayNumber}
                        </span>
                      </div>

                      {/* ONLY Special of that day in GREEN! */}
                      {hasEvents && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", overflow: "hidden", minWidth: 0, marginTop: "2px" }}>
                          {cell.events.map((ev) => (
                            <div
                              key={ev.id}
                              style={{
                                background: "#dcfce7",
                                color: "#15803d",
                                border: "1px solid #bbf7d0",
                                borderRadius: "5px",
                                padding: "3px 6px",
                                fontSize: "11px",
                                fontWeight: 600,
                                lineHeight: 1.25,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                minWidth: 0,
                                display: "block"
                              }}
                              title={ev.title}
                            >
                              {ev.title}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* =========================================================================
                30% RIGHT: DAY SPECIAL PANEL
                Details of that day + Discount % & Coupon ("cups") + Customer WhatsApp Msg
                ========================================================================= */}
            <div style={{
              minWidth: 0,
              width: "100%",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "14px",
              padding: "18px 20px",
              boxSizing: "border-box",
              position: "sticky",
              top: "76px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={17} style={{ color: "#d97706" }} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Day Special</h3>
                    <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500 }}>Festival &amp; Customer Offer</span>
                  </div>
                </div>
                <span style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  color: "#0f172a",
                  fontWeight: 650,
                  fontSize: "11.5px",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  whiteSpace: "nowrap",
                  flexShrink: 0
                }}>
                  {selectedDateStr}
                </span>
              </div>

              <FestivalPosterCard
                event={daySpecialEvent}
                selectedCity={selectedCity}
                selectedDateStr={selectedDateStr}
                isIndiaSelected={isIndiaSelected}
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD NEW CITY (CITY NAME + DATA SOURCES: MIN 2, MAX 5) */}
      <AnimatePresence>
        {showAddCityModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "14px",
                padding: "24px",
                maxWidth: "480px",
                width: "100%",
                boxShadow: "0 20px 45px rgba(0, 0, 0, 0.12)",
                color: "#0f172a"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#eff6ff", border: "1px solid #dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Plus size={16} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Add New City &amp; Data Sources</h3>
                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Configure monthly festival radar and event tracking</span>
                  </div>
                </div>
                <button type="button" onClick={() => setShowAddCityModal(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b" }}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddCity} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* 1. City Name & State */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", display: "block", marginBottom: "5px" }}>
                      City / District Name:
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={newCityName}
                      onChange={(e) => setNewCityName(e.target.value)}
                      placeholder="e.g. Vijayawada, Mysuru, Khammam..."
                      autoFocus
                      required
                      style={{ width: "100%", fontSize: "13px", border: "1px solid #cbd5e1", color: "#0f172a", background: "#ffffff", borderRadius: "8px", padding: "8px 12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", display: "block", marginBottom: "5px" }}>
                      State / Region:
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={newCityState}
                      onChange={(e) => setNewCityState(e.target.value)}
                      placeholder="e.g. Telangana, Andhra Pradesh, Karnataka..."
                      required
                      style={{ width: "100%", fontSize: "13px", border: "1px solid #cbd5e1", color: "#0f172a", background: "#ffffff", borderRadius: "8px", padding: "8px 12px" }}
                    />
                  </div>
                </div>

                {/* 2. City Data Sources (Min 2, Max 5) */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                      Data Sources <span style={{ fontSize: "11px", fontWeight: 500, color: "#64748b" }}>(Min 2, Max 5)</span>:
                    </label>
                    <span style={{
                      fontSize: "10.5px",
                      fontWeight: 650,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      background: newDataSources.filter(s => s.trim().length > 0).length >= 2 ? "#dcfce7" : "#fee2e2",
                      color: newDataSources.filter(s => s.trim().length > 0).length >= 2 ? "#15803d" : "#dc2626",
                      border: `1px solid ${newDataSources.filter(s => s.trim().length > 0).length >= 2 ? "#bbf7d0" : "#fecaca"}`
                    }}>
                      {newDataSources.length} / 5 Sources
                    </span>
                  </div>

                  <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "8px", fontWeight: 500 }}>
                    Official portals, news bulletins or festival committees where AI monitors upcoming demand.
                  </span>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "175px", overflowY: "auto", paddingRight: "4px" }}>
                    {newDataSources.map((src, index) => (
                      <div key={index} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "4px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          color: "#64748b",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: 600,
                          flexShrink: 0
                        }}>
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={src}
                          onChange={(e) => handleSourceChange(index, e.target.value)}
                          placeholder={index === 0 ? "e.g. District Tourism & Culture Portal" : index === 1 ? "e.g. Local Daily Events & News Bulletin" : `Data Source ${index + 1}`}
                          required={index < 2}
                          style={{
                            flex: 1,
                            fontSize: "12px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "6px",
                            padding: "6px 10px",
                            color: "#0f172a",
                            background: "#ffffff"
                          }}
                        />
                        {newDataSources.length > 2 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSource(index)}
                            style={{
                              background: "#fef2f2",
                              border: "1px solid #fee2e2",
                              color: "#dc2626",
                              borderRadius: "6px",
                              width: "26px",
                              height: "26px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              flexShrink: 0
                            }}
                            title="Remove this source"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {newDataSources.length < 5 && (
                    <button
                      type="button"
                      onClick={handleAddSource}
                      style={{
                        marginTop: "8px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        background: "#ffffff",
                        border: "1px dashed #cbd5e1",
                        padding: "5px 12px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        color: "#475569"
                      }}
                    >
                      <Plus size={12} />
                      <span>Add Data Source ({5 - newDataSources.length} slots left)</span>
                    </button>
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                  <button
                    type="button"
                    onClick={() => setShowAddCityModal(false)}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "7px 16px",
                      color: "#475569",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "12px"
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addingCity || newDataSources.filter(s => s.trim().length > 0).length < 2}
                    style={{
                      background: "#0f172a",
                      border: "1px solid #0f172a",
                      color: "#ffffff",
                      fontWeight: 600,
                      padding: "7px 18px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      cursor: "pointer",
                      opacity: (addingCity || newDataSources.filter(s => s.trim().length > 0).length < 2) ? 0.6 : 1,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                    }}
                  >
                    {addingCity ? "Creating City..." : "Save City & Radar"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: AUTONOMOUS AI AGENT WEBSITE CRAWLER & FESTIVAL RADAR */}
      <AnimatePresence>
        {showCrawlModal && (
          <div style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(4px)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem"
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "24px",
                maxWidth: "540px",
                width: "100%",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                color: "#0f172a"
              }}
            >
              {/* Modal Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: "14px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: "#eff6ff",
                    border: "1px solid #dbeafe",
                    color: "#2563eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <Bot size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                      Autonomous Event Radar &amp; Web Reader
                    </h3>
                    <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500 }}>
                      {batchScanning
                        ? `Processing City ${currentCityIndex + 1} of ${ALL_MARKETING_CITIES.length}: ${currentBatchCity}`
                        : `Reading official portals for ${selectedCity} one by one`}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCrawlModal(false)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", padding: "4px" }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Multi-City Sequence Queue Pills */}
              {batchScanning && (
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "14px" }}>
                  {ALL_MARKETING_CITIES.map((c, idx) => {
                    const isPast = idx < currentCityIndex;
                    const isNow = idx === currentCityIndex;
                    return (
                      <span
                        key={c}
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "6px",
                          background: isNow ? "#eff6ff" : isPast ? "#f0fdf4" : "#f8fafc",
                          border: isNow ? "1.5px solid #bfdbfe" : isPast ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                          color: isNow ? "#1d4ed8" : isPast ? "#15803d" : "#94a3b8",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        {isPast ? "✓" : isNow ? "●" : ""}
                        <span>{c}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Progress Bar */}
              <div style={{ width: "100%", height: "4px", background: "#f1f5f9", borderRadius: "2px", overflow: "hidden", marginBottom: "16px" }}>
                <motion.div
                  style={{
                    height: "100%",
                    background: crawlStep >= 4 ? "#16a34a" : "#2563eb"
                  }}
                  initial={{ width: "20%" }}
                  animate={{
                    width: crawlStep === 1 ? "40%" : crawlStep === 2 ? "70%" : crawlStep === 3 ? "90%" : "100%"
                  }}
                  transition={{ duration: 0.4 }}
                />
              </div>

              {/* Sequential Steps List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
                {selectedCitySources.map((url, idx) => {
                  const isDone = crawlStep > idx + 1 || crawlStep === 4;
                  const isCurrent = (crawlStep === idx + 1);

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "10px",
                        background: isCurrent ? "#eff6ff" : isDone ? "#f0fdf4" : "#f8fafc",
                        border: isCurrent ? "1px solid #bfdbfe" : isDone ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                      }}
                    >
                      {isDone ? (
                        <CheckCircle2 size={16} style={{ color: "#16a34a", flexShrink: 0 }} />
                      ) : isCurrent ? (
                        <RefreshCw size={15} className="spin" style={{ color: "#2563eb", flexShrink: 0 }} />
                      ) : (
                        <Clock size={15} style={{ color: "#94a3b8", flexShrink: 0 }} />
                      )}

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: "12px", fontWeight: 650, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          Step {idx + 1}: Reading {url}
                        </div>
                        <div style={{ fontSize: "11px", color: isDone ? "#15803d" : "#64748b", fontWeight: 500 }}>
                          {isDone ? "● Scanned (HTTP 200) · Extracted official notices & festival calendar" : isCurrent ? "Connecting & extracting regional bulletins..." : "Queued in sequence"}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Synthesis Step */}
                <div style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: crawlStep === 4 ? "#f0fdf4" : crawlStep === 3 ? "#eff6ff" : "#f8fafc",
                  border: crawlStep === 4 ? "1px solid #bbf7d0" : crawlStep === 3 ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}>
                  {crawlStep === 4 ? (
                    <CheckCircle2 size={16} style={{ color: "#16a34a", flexShrink: 0 }} />
                  ) : crawlStep === 3 ? (
                    <RefreshCw size={15} className="spin" style={{ color: "#2563eb", flexShrink: 0 }} />
                  ) : (
                    <Clock size={15} style={{ color: "#94a3b8", flexShrink: 0 }} />
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "12px", fontWeight: 650, color: "#0f172a" }}>
                      AI Marketing Strategy &amp; WhatsApp Promo Generation
                    </div>
                    <div style={{ fontSize: "11px", color: crawlStep === 4 ? "#15803d" : "#64748b", fontWeight: 500 }}>
                      {crawlStep === 4
                        ? `Identified demand spikes, created promo coupons, and updated ${selectedCity} calendar.`
                        : "Detecting festival dates, demand spikes & target services..."}
                    </div>
                  </div>
                </div>
              </div>

              {/* Discovered Summary Box */}
              {crawlStep === 4 && scanReport && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    marginBottom: "16px"
                  }}
                >
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#15803d", marginBottom: "4px" }}>
                    🎉 {scanReport.events_discovered.length} Festival / Event Surges Discovered in {selectedCity}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "#166534", lineHeight: 1.45, fontWeight: 500 }}>
                    {scanReport.events_discovered.slice(0, 2).map((ev) => (
                      <div key={ev.id} style={{ marginTop: "3px" }}>
                        • <b>{ev.title}</b> ({ev.date_start}) — <i>{ev.demand_surge}</i> · Coupon: <b>{ev.discount_code}</b>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                {batchScanning ? (
                  <button
                    type="button"
                    onClick={handleStopProcess}
                    style={{
                      padding: "8px 14px",
                      background: "#fef2f2",
                      border: "1.5px solid #fecaca",
                      borderRadius: "8px",
                      color: "#dc2626",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Square size={13} fill="#dc2626" />
                    <span>Stop Process</span>
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={() => setShowCrawlModal(false)}
                  style={{
                    padding: "8px 18px",
                    background: "#0f172a",
                    border: "1px solid #0f172a",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "12.5px",
                    fontWeight: 650,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                  }}
                >
                  {crawlStep === 4 ? "View Updated City Calendar" : "Close Radar"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* BIG HOVERING ANIMATED FLOATING AI AGENT BUTTON */}
      <FloatingAIAgent
        onStartProcess={handleStartProcess}
        onStopProcess={handleStopProcess}
        onScanEvents={handleTriggerScan}
        onRefreshEvents={() => fetchEvents(selectedCity)}
        onOpenCalendar={() => openCityCalendar("All-India")}
        scanning={scanning || batchScanning}
        activeCity={currentBatchCity}
        currentCityIndex={currentCityIndex}
        totalCities={ALL_MARKETING_CITIES.length}
        selectedCity={selectedCity}
      />
    </div>
  );
}
