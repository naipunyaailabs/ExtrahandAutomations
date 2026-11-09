import { AnimatePresence, MotionConfig } from "framer-motion";
import { Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { AgentWorkspace, workspaceFor } from "./components/AgentWorkspace";
import { ConfigContext, Layout } from "./components/Layout";
import { PageTransition } from "./components/motion";
import { SkeletonPage, ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { usePoll } from "./hooks";
import CallingPage from "./pages/CallingPage";
import Calls from "./pages/Calls";
import { CustomerFeedbackPage } from "./pages/CustomerFeedback";
import Dashboard from "./pages/Dashboard";
import LoginPage from "./pages/Login";
import { ReportsPage } from "./pages/Reports";
import Settings from "./pages/Settings";
import TicketDetail from "./pages/TicketDetail";
import WhatsAppPage from "./pages/WhatsAppPage";
import AdvertisementPage from "./pages/AdvertisementPage";
import { setBranding } from "./branding";
import type { AppConfig } from "./types";

export default function App() {
  return (
    <AuthProvider>
      <AppBody />
    </AuthProvider>
  );
}

function AppBody() {
  const { user } = useAuth();

  if (!user) {
    return <LoginPage />;
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
          <Route path="/" element={<Dashboard />} />
          <Route path="/feedback" element={<CustomerFeedbackPage />} />
          <Route path="/engagement" element={<ReportsPage />} />
          <Route path="/engagement/dashboard" element={<ReportsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<Settings />} />
          {/* Calling Agent */}
          <Route path="/calling" element={<CallingPage initialView="dispatch" />} />
          <Route path="/calling/dispatch" element={<CallingPage initialView="dispatch" />} />
          <Route path="/calling/console" element={<CallingPage initialView="console" />} />
          <Route path="/calling/tasks" element={<CallingPage initialView="tickets" />} />
          <Route path="/calling/helpers" element={<CallingPage initialView="helpers" />} />
          <Route path="/calling/care" element={<CallingPage initialView="care" />} />
          <Route path="/calling/history" element={<Calls />} />
          <Route path="/calls" element={<Calls />} />
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
          <Route path="/whatsapp/bulk" element={<WhatsAppPage section="bulk" />} />
          <Route path="/whatsapp/bulk-msgs" element={<WhatsAppPage section="bulk" />} />
          {/* Advertisement Engine */}
          <Route path="/advertisement" element={<AdvertisementPage />} />
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
