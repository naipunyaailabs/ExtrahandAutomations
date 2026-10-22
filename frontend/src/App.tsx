import { AnimatePresence, MotionConfig } from "framer-motion";
import { Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { ConfigContext, Layout } from "./components/Layout";
import { PageTransition } from "./components/motion";
import { SkeletonPage, ToastProvider } from "./components/ui";
import { usePoll } from "./hooks";
import Calls from "./pages/Calls";
import CustomerCare from "./pages/CustomerCare";
import Dashboard from "./pages/Dashboard";
import Helpers from "./pages/Helpers";
import Settings from "./pages/Settings";
import TicketDetail from "./pages/TicketDetail";
import Tickets from "./pages/Tickets";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </MotionConfig>
  );
}

function Shell() {
  const { data: config, error } = usePoll(api.config, 30000);
  const location = useLocation();

  if (!config) {
    return (
      <div className="boot">
        {error ? <div className="error-note">Cannot reach the backend: {error}. Is it running on port 8000?</div> : <SkeletonPage />}
      </div>
    );
  }

  return (
    <ConfigContext.Provider value={config}>
      <Layout>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={location.pathname}>
            <Routes location={location}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/calls" element={<Calls />} />
              <Route path="/customer-care" element={<CustomerCare />} />
              <Route path="/helpers" element={<Helpers />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </PageTransition>
        </AnimatePresence>
      </Layout>
    </ConfigContext.Provider>
  );
}
