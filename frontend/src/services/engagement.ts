/**
 * Service 4: User Engagement (backend/user_engagement).
 * dashboard(): today's numbers, live from the ExtraHand Main Admin API (read every 5 minutes).
 * 
 * Computes card headline KPIs:
 * - Total Volume (Work orders logged)
 * - Acceptance Rate % (Helper cascade)
 * - Completion Rate % (Verified fulfilled)
 * - Audit-ready CSV export streams
 */

import type { CustomerCategories, EngagementDashboardSummary, SilverCustomerPage } from "../types";

export interface OperationalPerformanceKPIs {
  total_volume: number;
  acceptance_rate: number;
  completion_rate: number;
  audit_ready: boolean;
  period_days: number;
  completed_tickets: number;
  total_dispatches: number;
  accepted_dispatches: number;
}

export function createEngagementService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);

  return {
    dashboard: () => get<EngagementDashboardSummary>("/api/engagement/dashboard"),
    /** Category module: real customers of a month (YYYY-MM) in Diamond / Gold / Platinum / Silver. */
    categories: (month?: string) =>
      get<CustomerCategories>(`/api/engagement/categories${month ? `?month=${month}` : ""}`),
    /** Silver customers (no order in the month), one page at a time. */
    silverCustomers: (page: number, month?: string) =>
      get<SilverCustomerPage>(`/api/engagement/categories/silver?page=${page}${month ? `&month=${month}` : ""}`),
    kpis: (days = 30) => get<OperationalPerformanceKPIs>(`/api/engagement/kpis?days=${days}`),
    overview: (days = 30) => get<Record<string, unknown>>(`/api/engagement/overview?days=${days}`),
    exportUrl: (type: "bookings" | "calls" | "feedback" | "helpers", days = 30) =>
      `/api/engagement/export?type=${type}&days=${days}`,
    // Backward compatibility for existing reports callers
    summary: (days = 30) => get<any>(`/api/reports/summary?days=${days}`),
  };
}

