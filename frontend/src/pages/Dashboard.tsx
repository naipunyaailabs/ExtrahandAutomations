import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  ExternalLink,
  Inbox,
  PhoneCall,
  Star,
  Zap,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CallingAgentView } from "../components/CallingAgentView";
import { useConfig } from "../components/Layout";
import { itemVariants, Stagger } from "../components/motion";
import { Pipeline } from "../components/Pipeline";
import { Timeline } from "../components/Timeline";
import { Card, Empty, SkeletonRows, WhatsAppIcon } from "../components/ui";
import { WhatsAppAgentView } from "../components/WhatsAppAgentView";
import { type SpotlightModule } from "../components/ModuleSpotlight";
import { ModuleGrid } from "../components/ModuleGrid";
import { moduleByKey, type ModuleKey } from "../components/modules";
import { AdvertisementView } from "../components/AdvertisementView";
import { CustomerFeedbackPage } from "./CustomerFeedback";
import { ReportsPage } from "./Reports";
import { fmtMoney, fmtRelative, fmtTime } from "../format";
import { usePoll, useUrlState } from "../hooks";
import { useAuth } from "../context/AuthContext";

type ActiveModule = "none" | "calling" | "whatsapp" | "advertisement" | "tickets" | "system" | "feedback" | "reports";

export default function Dashboard() {
  const config = useConfig()!;
  const navigate = useNavigate();
  const { user } = useAuth();
  // Kept in the URL (?module=calling): a reload stays on the open module, Back returns to the KPI cards
  const [activeModule, setActiveModule, backToCards] = useUrlState<ActiveModule>("module", "none", { push: true });

  const stats = usePoll(api.stats, 3000);
  const calls = usePoll(() => api.calls(true), 2000);
  const tickets = usePoll(() => api.tickets(), 5000);
  const events = usePoll(() => api.events(25), 3000);
  const waStatus = usePoll(api.whatsapp.status, 6000);
  const feedback = usePoll(api.whatsapp.feedbackOverview, 60000);
  const adCities = usePoll(api.advestiment.cities, 60000);
  const pricing = usePoll(api.pricing.status, 15000);
  const pricingStatus = pricing.data;

  const s = stats.data;
  const by = s?.tickets_by_status ?? {};
  const refreshAll = () => {
    calls.refresh();
    stats.refresh();
    events.refresh();
    tickets.refresh();
    waStatus.refresh();
  };

  const total = s?.tickets_total ?? 0;
  const unassignedCount = s?.unassigned_tickets ?? by.new ?? 0;
  const assignedCount = s?.assigned_tickets ?? by.assigned ?? 0;
  const completedCount = s?.completed_tickets ?? (tickets.data ?? []).filter((t) => t.status === "completed").length;

  // Advertisement card: computed from the marketing calendar
  const adCityList = adCities.data ?? [];
  const adRegional = adCityList.filter((c) => !c.is_national);
  const adStates = adRegional.filter((c) => c.region_type === "state" || c.region_type === "union_territory");
  const adCityRegions = adRegional.filter((c) => c.region_type === "city");
  const adEvents = adCityList.flatMap((c) => c.events ?? []);
  const adMaxDiscount = adEvents.reduce((m, e) => Math.max(m, e.suggested_discount || 0), 0);

  // Reminders queue
  const reminders = (tickets.data ?? [])
    .filter((t) => t.next_followup)
    .sort((a, b) => a.next_followup!.due_at.localeCompare(b.next_followup!.due_at))
    .slice(0, 5);

  // 7-day booking trend (real data: tasks per India day, oldest first)
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const last7 = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400000)));
  const perDay = (pick: (t: NonNullable<typeof tickets.data>[number]) => string | null | undefined) => {
    const c: Record<string, number> = {};
    for (const t of tickets.data ?? []) {
      const v = pick(t);
      if (v) { const k = dayKey(new Date(v)); c[k] = (c[k] ?? 0) + 1; }
    }
    return last7.map((k) => c[k] ?? 0);
  };
  const bookedTrend = perDay((t) => t.booked_at ?? t.created_at);
  const assignedTrend = perDay((t) => (t.assigned_at ?? null));
  const doneTrend = perDay((t) => (t.status === "completed" ? t.updated_at : null));
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  const esc = s?.open_escalations ?? 0;
  const lowRatings = feedback.data?.counts.low ?? 0;

  const base = (k: ModuleKey) => {
    const m = moduleByKey(k);
    return { key: m.key, title: m.title, subtitle: m.subtitle, icon: m.icon, accent: m.accent, onOpen: () => navigate(m.path) };
  };
  const spotlight: SpotlightModule[] = [
    {
      ...base("calling"),
      status: config.telephony_provider === "twilio" ? "Twilio Voice" : config.telephony_provider === "vobiz" ? "Vobiz Voice" : "Simulator",
      metrics: [
        { label: "Active calls", value: s?.active_calls ?? 0, note: "Live dialing" },
        { label: "Calls (24h)", value: s?.calls_24h ?? 0, note: "Placed to helpers" },
        { label: "Escalations", value: esc, note: esc > 0 ? "Needs review" : "All clear", tone: esc > 0 ? "bad" : "good" },
      ],
      progress: s?.acceptance_rate_24h != null ? { label: "Acceptance rate (24h)", value: s.acceptance_rate_24h * 100 } : null,
      peek: `${s?.active_calls ?? 0} Active · ${esc} Escalations`,
      trend: assignedTrend, trendLabel: "Assigned · 7 days", action: "Launch Calling Console & Dial Engine",
      attention: esc > 0,
    },
    {
      ...base("whatsapp"),
      status: waStatus.data?.status === "WORKING" ? "Online" : "Ready",
      metrics: [
        { label: "Dispatched tasks", value: assignedCount, note: "Work orders sent" },
        { label: "Pending queue", value: unassignedCount, note: "Awaiting dispatch", tone: unassignedCount > 0 ? "warn" : undefined },
        { label: "Messages today", value: waStatus.data?.messages_today ?? 0, note: waStatus.data?.status ?? "Status unknown" },
      ],
      progress: { label: "Queue throughput", value: pct(assignedCount, assignedCount + unassignedCount) },
      peek: `${waStatus.data?.messages_today ?? 0} Today · ${unassignedCount} Pending`,
      trend: bookedTrend, trendLabel: "Bookings · 7 days", action: "Open WhatsApp Agent & Templates",
    },
    {
      ...base("advertisement"),
      status: "Festival Calendar",
      metrics: [
        { label: "Monitored regions", value: `${adCityRegions.length} Cities`, note: `${adStates.map((c) => c.city_name).join(", ") || "No states"} + All-India` },
        { label: "Festivals", value: `${adEvents.length} Events`, note: "Upcoming in calendar" },
        { label: "Promo discounts", value: adMaxDiscount > 0 ? `Up to ${adMaxDiscount}%` : "—", note: "Dynamic coupons" },
      ],
      peek: `${adCityRegions.length} Cities · Up to ${adMaxDiscount}%`,
      trend: bookedTrend, trendLabel: "Bookings · 7 days", action: "Register Festivals & Posters",
    },
    {
      ...base("engagement"),
      status: "Audit Ready",
      metrics: [
        { label: "Total volume", value: total, note: "Work orders logged" },
        { label: "Acceptance rate", value: s?.acceptance_rate_24h != null ? `${Math.round(s.acceptance_rate_24h * 100)}%` : "—", note: "Helper cascade", tone: "good" },
        { label: "Completion rate", value: total > 0 ? `${Math.round(pct(completedCount, total))}%` : "—", note: "Verified fulfilled" },
      ],
      progress: total > 0 ? { label: "Completed tasks", value: pct(completedCount, total) } : null,
      peek: `${total} Tasks · ${completedCount} Completed`,
      trend: doneTrend, trendLabel: "Completed · 7 days", action: "View Executive Reports & Exports",
    },
    {
      ...base("pricing"),
      status: pricingStatus?.running ? "Agent scanning…" : pricingStatus?.last_run?.finished_at ? `Scanned ${fmtRelative(pricingStatus.last_run.finished_at)}` : "Competitor Scan",
      metrics: [
        { label: "Priced", value: pricingStatus?.counts.priced ?? 0, note: "Service–area prices" },
        { label: "Areas", value: pricingStatus?.counts.areas ?? 0, note: `${pricingStatus?.counts.services ?? 0} services` },
        { label: "Competitors", value: pricingStatus?.counts.competitors ?? 0, note: "Tracked" },
      ],
      peek: `${pricingStatus?.counts.priced ?? 0} Priced · ${pricingStatus?.counts.competitors ?? 0} Rivals`,
      trend: bookedTrend, trendLabel: "Bookings · 7 days", action: "View Prices & Competitive Analysis",
    },
    {
      ...base("feedback"),
      status: feedback.data?.active ? "Automation on" : "Automation off",
      metrics: [
        { label: "Avg rating", value: feedback.data?.averages.overall ? feedback.data.averages.overall.toFixed(1) : "—", note: "out of 5 stars" },
        { label: "Responses", value: feedback.data?.counts.answered ?? 0, note: feedback.data ? `${feedback.data.response_rate}% replied` : "Customers" },
        { label: "Low ratings", value: lowRatings, note: `${feedback.data?.counts.sent ?? 0} awaiting reply`, tone: lowRatings > 0 ? "bad" : "good" },
      ],
      progress: feedback.data ? { label: "Response rate", value: feedback.data.response_rate } : null,
      peek: `${feedback.data?.counts.answered ?? 0} Replies · ${lowRatings} Low`,
      trend: doneTrend, trendLabel: "Completed · 7 days", action: "Open Reviews & Feedback",
      attention: lowRatings > 0,
    },
  ];

  return (
    <Stagger className="page">
      {/* =========================================================================
          INITIAL VIEW: ONLY SHOW THE KPI CARDS (BLUE & WHITE SHOWCASE WITH ANIMATION)
          ========================================================================= */}
      {activeModule === "none" ? (
        <motion.div variants={itemVariants}>
          <ModuleGrid
            modules={spotlight}
            intro={
              <HomeIntro
                name={user?.name}
                chips={[
                  { label: "Tasks today", value: (tickets.data ?? []).filter((t) => t.is_today).length, tone: "brand" },
                  { label: "Waiting for a helper", value: unassignedCount, tone: unassignedCount > 0 ? "warn" : "good" },
                  { label: "Live calls", value: s?.active_calls ?? 0, tone: (s?.active_calls ?? 0) > 0 ? "brand" : "muted" },
                  { label: "Escalations", value: esc, tone: esc > 0 ? "bad" : "good", onClick: () => navigate("/calling/care") },
                ]}
              />
            }
          />
        </motion.div>
      ) : (
        /* =========================================================================
           CLICKED VIEW: EXPANDED DASHBOARD & EVERY FEATURE OF THAT MODULE
           ========================================================================= */
        <motion.div variants={itemVariants} className="feature-view-container">
          {/* Floating Control Bar with Back Button */}
          <div className="feature-control-bar">
            <button
              className="back-to-kpi-btn"
              onClick={backToCards}
              title="Return to initial KPI Cards view"
            >
              <ArrowLeft size={16} />
              <span>Back to All KPI Cards</span>
            </button>

            <div className="feature-tab-pills">
              <button
                className={`feature-pill-btn ${activeModule === "calling" ? "active" : ""}`}
                onClick={() => setActiveModule("calling")}
              >
                <PhoneCall size={14} />
                <span>📞 Calling Agent</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "whatsapp" ? "active" : ""}`}
                onClick={() => setActiveModule("whatsapp")}
              >
                <WhatsAppIcon size={14} />
                <span>💬 WhatsApp Agent</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "feedback" ? "active" : ""}`}
                onClick={() => setActiveModule("feedback")}
              >
                <Star size={14} />
                <span>⭐ Feedback &amp; CSAT</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "reports" ? "active" : ""}`}
                onClick={() => setActiveModule("reports")}
              >
                <BarChart3 size={14} />
                <span>📊 Reports &amp; Analytics</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "tickets" ? "active" : ""}`}
                onClick={() => setActiveModule("tickets")}
              >
                <ClipboardList size={14} />
                <span>📋 Work Orders</span>
              </button>
              <button
                className={`feature-pill-btn ${activeModule === "system" ? "active" : ""}`}
                onClick={() => setActiveModule("system")}
              >
                <Zap size={14} />
                <span>⚡ System Activity</span>
              </button>
            </div>

            <div>
              {activeModule === "calling" && (
                <Link to="/calling" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "whatsapp" && (
                <Link to="/whatsapp" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "feedback" && (
                <Link to="/feedback" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "reports" && (
                <Link to="/reports" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>Full Screen Page</span>
                </Link>
              )}
              {activeModule === "tickets" && (
                <Link to="/tickets" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", gap: "6px" }}>
                  <ExternalLink size={13} />
                  <span>View All Tickets</span>
                </Link>
              )}
            </div>
          </div>

          {/* FEATURE 1: Calling Agent Dashboard */}
          {activeModule === "calling" && (
            <CallingAgentView
              stats={s ?? undefined}
              calls={calls.data ?? undefined}
              tickets={tickets.data ?? undefined}
              events={events.data ?? undefined}
              ivrMaxPrompts={config.ivr_max_prompts}
              telephonyProvider={config.telephony_provider}
              onRefreshAll={refreshAll}
            />
          )}

          {/* FEATURE 2: WhatsApp Agent Dashboard */}
          {activeModule === "whatsapp" && (
            <WhatsAppAgentView
              tickets={tickets.data ?? []}
              onRefreshAll={refreshAll}
              section="send"
            />
          )}

          {/* FEATURE 3: Work Orders & Pipeline Dashboard */}
          {activeModule === "tickets" && (
            <div>
              <Pipeline
                totalTasks={s?.tickets_total}
                unassigned={s?.unassigned_tickets}
                calling={s?.tickets_by_status?.dispatching ?? 0}
                assigned={s?.assigned_tickets ?? s?.tickets_by_status?.assigned ?? 0}
                completed={s?.completed_tickets ?? 0}
                cancelled={s?.cancelled_tickets ?? 0}
                escalated={s?.open_escalations ?? 0}
                reminders={s?.followups_scheduled ?? 0}
                assignedHelpers={s?.assigned_helpers ?? 0}
              />
              <div style={{ marginTop: "1.5rem" }}>
                <Card title="Live Field Work Orders &amp; Tickets" icon={Inbox}>
                  <div className="table-wrap inner">
                    <table className="table responsive">
                      <thead>
                        <tr>
                          <th>Task ID</th>
                          <th>Title</th>
                          <th>Category</th>
                          <th>Customer</th>
                          <th>Payout</th>
                          <th>Location</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tickets.data ?? []).slice(0, 10).map((t) => (
                          <tr key={t.id}>
                            <td className="mono text-xs">#{t.id.slice(-6)}</td>
                            <td>
                              <Link to={`/tickets/${t.id}`} style={{ fontWeight: 600, color: "#FFFFFF" }}>
                                {t.title}
                              </Link>
                            </td>
                            <td><span className="pill tone-info text-xs">{t.category || "General"}</span></td>
                            <td>{t.customer?.name || "Customer"}</td>
                            <td className="mono font-bold" style={{ color: "var(--blue-bright, #60a5fa)" }}>
                              {fmtMoney(t.budget)}
                            </td>
                            <td className="text-xs muted">{t.address || t.city}</td>
                            <td>
                              <span className={`pill ${t.dispatch_status === "assigned" ? "tone-success" : t.dispatch_status === "dispatching" ? "tone-live" : "tone-info"}`}>
                                {t.dispatch_status}
                              </span>
                            </td>
                            <td>
                              <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                                View Details
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* FEATURE 4: System Activity & Event Stream Dashboard */}
          {activeModule === "system" && (
            <div className="dashboard-two-col-grid">
              <Card title="Upcoming Voice Follow-up Reminders" icon={Activity}>
                {!tickets.data ? (
                  <SkeletonRows rows={3} />
                ) : reminders.length ? (
                  <div className="reminders-list">
                    {reminders.map((t) => (
                      <div key={t.id} className="reminder-item-card">
                        <div className="reminder-left">
                          <span className="reminder-due-badge">
                            Due {fmtRelative(t.next_followup!.due_at)}
                          </span>
                          <Link to={`/tickets/${t.id}`} className="reminder-title-link">
                            #{t.id.slice(-6)} · {t.title}
                          </Link>
                          <div className="reminder-helper muted text-xs">
                            Candidate: {t.assignee?.name || t.next_followup?.helper_id || "Available Helper"}
                          </div>
                        </div>
                        <div className="reminder-right">
                          <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                            Inspect
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty icon={Activity}>No upcoming voice follow-ups scheduled.</Empty>
                )}
              </Card>

              <Card title="Real-Time Multi-Agent Activity Stream" icon={Activity}>
                <Timeline events={events.data ?? []} time={fmtTime} />
              </Card>
            </div>
          )}

          {/* FEATURE 4.5: Advertisement & City Event Campaigns */}
          {activeModule === "advertisement" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <AdvertisementView />
            </motion.div>
          )}

          {/* FEATURE 5: Customer Feedback & CSAT Dashboard */}
          {activeModule === "feedback" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <CustomerFeedbackPage />
            </motion.div>
          )}

          {/* FEATURE 6: Reports & Executive Analytics Dashboard */}
          {activeModule === "reports" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <ReportsPage />
            </motion.div>
          )}
        </motion.div>
      )}
    </Stagger>
  );
}

/** Greeting + live counters above the module spotlight. */
function HomeIntro({ name, chips }: {
  name?: string | null;
  chips: { label: string; value: number; tone: "brand" | "good" | "warn" | "bad" | "muted"; onClick?: () => void }[];
}) {
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  return (
    <div className="ms-intro">
      <div className="ms-intro-text">
        <span className="ms-intro-date">{today}</span>
        <h1>{hello}{name ? `, ${name.split(" ")[0]}` : ""}</h1>
        <p>All your automations at a glance. Click a card to open it.</p>
      </div>
      <div className="ms-intro-chips">
        {chips.map((c) => (
          <button key={c.label} type="button" className={`ms-chip tone-${c.tone}`} onClick={c.onClick} disabled={!c.onClick}>
            <b>{c.value}</b>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
