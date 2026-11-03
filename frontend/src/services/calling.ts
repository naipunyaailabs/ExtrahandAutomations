/**
 * Service 1: Automated Calling & Telephony Service
 * 
 * Manages tickets, helper matching, voice outreach, IVR call simulations,
 * escalations, customer care, and post-service ratings.
 */

import type {
  AppConfig,
  Call,
  CustomerFeedback,
  Escalation,
  EventItem,
  Helper,
  HelperDetail,
  HelperFilters,
  ReportsSummary,
  RuntimeSettings,
  Stats,
  Ticket,
  TicketDetail,
} from "../types";

export function createCallingService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, serviceUrl);

  return {
    config: () => get<AppConfig>("/api/config"),
    stats: () => get<Stats>("/api/stats"),
    settings: () => get<RuntimeSettings>("/api/settings"),
    sync: () =>
      post<Record<string, number> & { ok?: boolean; stats?: Record<string, number>; fetched?: number; new?: number; updated?: number }>(
        "/api/sync"
      ),
    tickets: (params?: { dispatch_status?: string; status?: string; q?: string; order?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== "") as [string, string][]
      );
      return get<Ticket[]>(`/api/tickets${qs.size ? `?${qs}` : ""}`);
    },
    ticket: (id: string) => get<TicketDetail>(`/api/tickets/${encodeURIComponent(id)}`),
    dispatch: (id: string) => post(`/api/tickets/${encodeURIComponent(id)}/dispatch`),
    cancelDispatch: (id: string) => post(`/api/tickets/${encodeURIComponent(id)}/dispatch/cancel`),
    calls: (activeOrLimit?: boolean | number) => {
      if (typeof activeOrLimit === "boolean") {
        return get<Call[]>(`/api/calls${activeOrLimit ? "?active=true" : ""}`);
      }
      const limit = typeof activeOrLimit === "number" ? activeOrLimit : 30;
      return get<Call[]>(`/api/calls?limit=${limit}`);
    },
    simulate: (callId: number, action: string, digit?: string) =>
      post<{ call: Call; spoken: string | null; max_prompts: number }>(`/api/simulator/calls/${callId}`, { action, digit }),
    escalations: (status?: string) =>
      get<Escalation[]>(`/api/escalations${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    updateEscalation: (id: number, body: { status?: string; resolution_notes?: string; notes?: string; assigned_to?: string }) =>
      request<Escalation>("PATCH", `/api/escalations/${id}`, body, serviceUrl),
    redispatch: (id: number) => post(`/api/escalations/${id}/redispatch`),
    events: (limit = 30) => get<EventItem[]>(`/api/events?limit=${limit}`),
    helpers: (params?: { q?: string; service?: string; location?: string; status?: string; is_verified?: boolean; can_accept_tasks?: boolean }) => {
      const qs = new URLSearchParams(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== "") as [string, string][]
      );
      return get<Helper[]>(`/api/helpers${qs.size ? `?${qs}` : ""}`);
    },
    helper: (id: string) => get<HelperDetail>(`/api/helpers/${encodeURIComponent(id)}`),
    helperFilters: () => get<HelperFilters>("/api/helpers/filters"),
    syncHelpers: () => post<{ ok: boolean; stats: Record<string, number>; total: number }>("/api/helpers/sync"),
    saveSettings: (body: Partial<RuntimeSettings>) => request<RuntimeSettings>("PUT", "/api/settings", body, serviceUrl),
    toggleEmergencyStop: (enabled: boolean) =>
      post<{ ok: boolean; emergency_stop_calls: boolean }>("/api/settings/emergency-stop", { stopped: enabled, enabled }),
    feedback: {
      list: (params?: { rating?: number; complaint_category?: string; resolution_status?: string; q?: string }) => {
        const qs = new URLSearchParams(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== "") as [string, string][]
        );
        return get<CustomerFeedback[]>(`/api/feedback${qs.size ? `?${qs}` : ""}`);
      },
      trigger: (ticketId: string) =>
        post<{ success?: boolean; call_id?: number; call_attempt_id?: number; status: string }>(
          `/api/feedback/trigger/${encodeURIComponent(ticketId)}`
        ),
      update: (id: number, body: Partial<CustomerFeedback>) =>
        request<CustomerFeedback>("PATCH", `/api/feedback/${id}`, body, serviceUrl),
    },
    reports: {
      summary: (days = 30) => get<ReportsSummary>(`/api/reports/summary?days=${days}`),
      exportUrl: (type: "bookings" | "calls" | "feedback" | "helpers", days = 30) =>
        `/api/reports/export?type=${type}&days=${days}`,
    },
  };
}

