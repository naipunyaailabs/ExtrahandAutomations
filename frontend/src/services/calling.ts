/**
 * Service 1: Automated Calling & Telephony Service
 * 
 * Manages tickets, helper matching, voice outreach, IVR call simulations,
 * escalations, customer care, and post-service ratings.
 */

import type {
  AppConfig,
  Call,
  CallDetail,
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
  CallingFlow,
  CallingAgentStatus,
  BulkCampaign,
  ParseContactsFileResponse,
  VoiceCheck,
  VoiceScript,
  VoiceStatus,
  CommercialRates,
  CommercialSummary,
  CallingBulkSummary,
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
    outreachStatus: () =>
      get<{ whatsapp_on: boolean; whatsapp_test_mode: boolean; calls_on: boolean; calling_hours: string | null; calling_hours_open: boolean }>(
        "/api/tickets/outreach-status",
      ),
    pushAssignment: (id: string) =>
      post<{ ok: boolean; extrahand_push: string }>(`/api/tickets/${encodeURIComponent(id)}/push-assignment`),
    /** Today's Calling Agent pipeline from real data (real-customer orders, calls, follow-ups, escalations). */
    flow: () => get<CallingFlow>("/api/calls/flow"),
    calls: (activeOrLimit?: boolean | number) => {
      if (typeof activeOrLimit === "boolean") {
        return get<Call[]>(`/api/calls${activeOrLimit ? "?active=true" : ""}`);
      }
      const limit = typeof activeOrLimit === "number" ? activeOrLimit : 30;
      return get<Call[]>(`/api/calls?limit=${limit}`);
    },
    callDetail: (id: number) => get<CallDetail>(`/api/calls/${id}`),
    voiceStatus: () => get<VoiceStatus>("/api/voice/status"),
    commercials: () => get<CommercialSummary>("/api/commercials/summary"),
    commercialsAutomation: () => get<CommercialSummary>("/api/commercials/automation"),
    commercialsBulk: () => get<CallingBulkSummary>("/api/commercials/bulk"),
    saveCommercialRates: (body: CommercialRates) =>
      request<CommercialRates>("PUT", "/api/commercials/rates", body, serviceUrl),
    voiceChecks: () => post<{ checks: VoiceCheck[] }>("/api/voice/checks"),
    voiceScript: (purpose: string, ticketId?: string) =>
      get<VoiceScript>(`/api/voice/scripts?purpose=${purpose}${ticketId ? `&ticket_id=${encodeURIComponent(ticketId)}` : ""}`),
    /** Address of one step as a WAV file (needs the session cookie, so fetch it with credentials). */
    voicePreviewUrl: (purpose: string, step: string, ticketId?: string) =>
      `${serviceUrl ?? ""}/api/voice/preview?purpose=${purpose}&step=${encodeURIComponent(step)}${ticketId ? `&ticket_id=${encodeURIComponent(ticketId)}` : ""}`,
    simulate: (callId: number, action: string, digit?: string, result?: unknown) =>
      post<{ call: Call; spoken: string | null; max_prompts: number }>(`/api/simulator/calls/${callId}`, { action, digit, result }),
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
    callingAgentStatus: () => get<CallingAgentStatus>("/api/calling-agent/status"),
    activateCallingAgent: () => post<CallingAgentStatus>("/api/calling-agent/activate"),
    deactivateCallingAgent: () => post<CallingAgentStatus>("/api/calling-agent/deactivate"),
    toggleCallingAgent: (active?: boolean) =>
      post<CallingAgentStatus>("/api/calling-agent/toggle", active !== undefined ? { active } : {}),
    bulk: {
      agentStatus: () => get<CallingAgentStatus>("/api/bulk-calling/agent/status"),
      activateAgent: () => post<CallingAgentStatus>("/api/bulk-calling/agent/activate"),
      deactivateAgent: () => post<CallingAgentStatus>("/api/bulk-calling/agent/deactivate"),
      parseFile: (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        return request<ParseContactsFileResponse>("POST", "/api/bulk-calling/parse-file", fd, serviceUrl);
      },
      listCampaigns: () => get<BulkCampaign[]>("/api/bulk-calling/campaigns"),
      getCampaign: (id: number) => get<BulkCampaign>(`/api/bulk-calling/campaigns/${id}`),
      createCampaign: (data: { title: string; script: string; language?: string; contacts: { name?: string; phone: string }[] }) =>
        post<{ id: number; title: string; status: string; total_contacts: number }>("/api/bulk-calling/campaigns", data),
      activateCampaign: (id: number) =>
        post<{ id: number; status: string; message: string }>(`/api/bulk-calling/campaigns/${id}/activate`),
      deactivateCampaign: (id: number) =>
        post<{ id: number; status: string; message: string }>(`/api/bulk-calling/campaigns/${id}/deactivate`),
      cancelCampaign: (id: number) =>
        post<{ id: number; status: string; message: string }>(`/api/bulk-calling/campaigns/${id}/cancel`),
      resetCampaign: (id: number) =>
        post<{ id: number; status: string; message: string }>(`/api/bulk-calling/campaigns/${id}/reset`),
      retryFailed: (id: number) =>
        post<{ id: number; status: string; retried_count: number; message: string }>(`/api/bulk-calling/campaigns/${id}/retry-failed`),
      deleteCampaign: (id: number) =>
        request<{ ok: boolean }>("DELETE", `/api/bulk-calling/campaigns/${id}`, undefined, serviceUrl),
      previewAudioUrl: () => `${serviceUrl ?? ""}/api/bulk-calling/preview-audio`,
    },
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

