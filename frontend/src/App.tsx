import { AnimatePresence, MotionConfig } from "framer-motion";
import { Route, Routes, useLocation, Navigate } from "react-router-dom";
import { api } from "./api";
import { AgentWorkspace, workspaceFor } from "./components/AgentWorkspace";
import { ConfigContext, Layout } from "./components/Layout";
import { PageTransition } from "./components/motion";
import { SkeletonPage, ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { usePoll } from "./hooks";
import CallingPage from "./pages/CallingPage";
import CallDetailPage from "./pages/CallDetail";
import Calls from "./pages/Calls";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/Login";
import { ReportsPage } from "./pages/Reports";
import { RegionsPage } from "./pages/Regions";
import Settings from "./pages/Settings";
import TicketDetail from "./pages/TicketDetail";
import VoiceIvr from "./pages/VoiceIvr";
import { CallingAutomationCommercials, CallingBulkCommercials } from "./pages/Commercials";
import { WaAutomationCommercials, WaBulkCommercials } from "./pages/WaCommercials";
import { WaSentMessages } from "./pages/WaSentMessages";
import { WaWelcomer, WaWelcomerCommercials } from "./pages/WaWelcomers";
import { WaFeedback, WaFeedbackCommercials, WaFeedbackReplies, WaFeedbackTemplate } from "./pages/WaFeedback";
import { AdCommercials } from "./pages/AdCommercials";
import { TaskSeeding } from "./pages/TaskSeeding";
import BulkCallingPage from "./pages/BulkCallingPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import AdvertisementPage from "./pages/AdvertisementPage";
import PricingPage from "./pages/PricingPage";
import PriceComparisonPage from "./pages/Pricing";
import { setBranding } from "./branding";
import type { AppConfig } from "./types";

export default function App() {
  return (
    <AuthProvider>
      <AppBody />
    </AuthProvider>
  );
}

/** Where the dashboard lives. "/" forwards here, and signing in lands here unless another page was asked for. */
export const HOME = "/home";

function AppBody() {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <SkeletonPage />
      </div>
    );
  }

  if (!user) {
    // signed out: every address shows the login page at /login, remembering where the user wanted to go
    if (location.pathname !== "/login") {
      const from = location.pathname + location.search + location.hash;
      const wanted = location.pathname === "/" ? undefined : from;
      return <Navigate to="/login" replace state={wanted ? { from: wanted } : undefined} />;
    }
    return <LoginPage />;
  }
  if (location.pathname === "/login") {
    // signed in: back to the page that was asked for, else the dashboard
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith("/") && !from.startsWith("/login") ? from : HOME} replace />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthedApp />
      </ToastProvider>
    </MotionConfig>
  );
}

function AuthedApp() {
  const { data: config, error } = usePoll<AppConfig>(api.config, 60000);
  const location = useLocation();
  setBranding(config?.branding);

  if (!config) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        {error ? (
          <div style={{ color: "var(--danger)", padding: 20 }}>
            Cannot reach backend: {error}
          </div>
        ) : (
          <SkeletonPage />
        )}
      </div>
    );
  }

  const workspace = workspaceFor(location.pathname);
  const pages = (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<Navigate to={HOME} replace />} />
          <Route path={HOME} element={<Dashboard />} />
          <Route path="/feedback" element={<Navigate to="/feedback/reviews" replace />} />
          <Route path="/engagement" element={<ReportsPage />} />
          <Route path="/engagement/dashboard" element={<ReportsPage />} />
          <Route path="/engagement/regions" element={<RegionsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<Settings />} />
          {/* Competitive Pricing: the Pricing Agent's pages + our live prices vs competitors */}
          <Route path="/pricing" element={<PricingPage section="prices" />} />
          <Route path="/pricing/compare" element={<PriceComparisonPage />} />
          <Route path="/pricing/analysis" element={<PricingPage section="analysis" />} />
          <Route path="/pricing/runs" element={<PricingPage section="runs" />} />
          <Route path="/pricing/setup" element={<PricingPage section="setup" />} />
          <Route path="/pricing/api" element={<PricingPage section="api" />} />
          {/* Calling Agent */}
          <Route path="/calling" element={<CallingPage initialView="dispatch" />} />
          <Route path="/calling/dispatch" element={<CallingPage initialView="dispatch" />} />
          <Route path="/calling/console" element={<CallingPage initialView="console" />} />
          <Route path="/calling/bulk" element={<BulkCallingPage />} />
          <Route path="/calling/tasks" element={<CallingPage initialView="tickets" />} />
          <Route path="/calling/helpers" element={<CallingPage initialView="helpers" />} />
          <Route path="/calling/care" element={<CallingPage initialView="care" />} />
          <Route path="/calling/history" element={<Calls />} />
          <Route path="/calling/voice" element={<VoiceIvr />} />
          <Route path="/calling/commercials" element={<Navigate to="/calling/commercials/automation" replace />} />
          <Route path="/calling/commercials/automation" element={<CallingAutomationCommercials />} />
          <Route path="/calling/commercials/bulk" element={<CallingBulkCommercials />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/calls/:id" element={<CallDetailPage />} />
          <Route path="/tickets" element={<CallingPage initialView="tickets" />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/customer-care" element={<CallingPage initialView="care" />} />
          <Route path="/helpers" element={<CallingPage initialView="helpers" />} />
          {/* WhatsApp Agent */}
          <Route path="/whatsapp" element={<WhatsAppPage section="dispatch" />} />
          <Route path="/whatsapp/dispatch" element={<WhatsAppPage section="dispatch" />} />
          <Route path="/whatsapp/overview" element={<WhatsAppPage section="dashboard" />} />
          <Route path="/whatsapp/dashboard" element={<WhatsAppPage section="dashboard" />} />
          <Route path="/whatsapp/send" element={<WhatsAppPage section="send" />} />
          <Route path="/whatsapp/orders" element={<WhatsAppPage section="send" />} />
          <Route path="/whatsapp/replies" element={<WhatsAppPage section="send" />} />
          <Route path="/whatsapp/device" element={<WhatsAppPage section="device" />} />
          <Route path="/whatsapp/messages" element={<WaSentMessages />} />
          <Route path="/whatsapp/welcomers" element={<Navigate to="/whatsapp/welcomers/helper" replace />} />
          <Route path="/whatsapp/welcomers/helper" element={<WaWelcomer audience="helper" />} />
          <Route path="/whatsapp/welcomers/customer" element={<WaWelcomer audience="customer" />} />
          <Route path="/whatsapp/welcomers/commercials" element={<WaWelcomerCommercials />} />
          <Route path="/feedback/reviews" element={<WaFeedback />} />
          <Route path="/feedback/template" element={<WaFeedbackTemplate />} />
          <Route path="/feedback/replies" element={<WaFeedbackReplies />} />
          <Route path="/feedback/commercials" element={<WaFeedbackCommercials />} />
          <Route path="/whatsapp/feedback" element={<Navigate to="/feedback/reviews" replace />} />
          <Route path="/whatsapp/bulk" element={<WhatsAppPage section="bulk" />} />
          <Route path="/whatsapp/bulk-msgs" element={<WhatsAppPage section="bulk" />} />
          <Route path="/whatsapp/commercials" element={<Navigate to="/whatsapp/commercials/automation" replace />} />
          <Route path="/whatsapp/commercials/automation" element={<WaAutomationCommercials />} />
          <Route path="/whatsapp/commercials/bulk" element={<WaBulkCommercials />} />
          {/* Advertisement Engine */}
          <Route path="/advertisement" element={<AdvertisementPage />} />
          <Route path="/advertisement/commercials" element={<AdCommercials />} />
          <Route path="/advertisement/task-seeding" element={<TaskSeeding />} />
          <Route path="/advertisement/task-seeding/calendar" element={<TaskSeeding section="calendar" />} />
          <Route path="/advertisement/task-seeding/settings" element={<TaskSeeding section="settings" />} />
          <Route path="/advertisement/task-seeding/history" element={<TaskSeeding section="history" />} />
          <Route path="/advertisement/regions" element={<AdvertisementPage mode="regions" />} />
          <Route path="/advertisement/regions/:region" element={<AdvertisementPage mode="regions" />} />
          <Route path="/advestiment" element={<AdvertisementPage />} />
        </Routes>
      </PageTransition>
    </AnimatePresence>
  );

  return (
    <ConfigContext.Provider value={config}>
      {workspace ? <AgentWorkspace agent={workspace}>{pages}</AgentWorkspace> : <Layout>{pages}</Layout>}
    </ConfigContext.Provider>
  );
}
