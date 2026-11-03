/**
 * Service 4: User Engagement & Operational Performance Analytics Service
 * 
 * Computes card headline KPIs:
 * - Total Volume (Work orders logged)
 * - Acceptance Rate % (Helper cascade)
 * - Completion Rate % (Verified fulfilled)
 * - Audit-ready CSV export streams
 */

import type { UserSegmentationSummary } from "../types";

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
    kpis: (days = 30) => get<OperationalPerformanceKPIs>(`/api/engagement/kpis?days=${days}`),
    overview: (days = 30) => get<Record<string, unknown>>(`/api/engagement/overview?days=${days}`),
    users: (tier?: string, period: "monthly" | "weekly" = "monthly") =>
      get<UserSegmentationSummary>(`/api/engagement/users?${tier ? `tier=${tier}&` : ""}period=${period}`),
    segmentation: () =>
      get<UserSegmentationSummary>("/api/engagement/segmentation"),
    exportUrl: (type: "bookings" | "calls" | "feedback" | "helpers", days = 30) =>
      `/api/engagement/export?type=${type}&days=${days}`,
    // Backward compatibility for existing reports callers
    summary: (days = 30) => get<any>(`/api/reports/summary?days=${days}`),
  };
}

