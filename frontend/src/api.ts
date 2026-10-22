import type {
  AppConfig, Call, Escalation, EventItem, Helper, HelperDetail, HelperFilters, RuntimeSettings, Stats, Ticket, TicketDetail,
} from "./types";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const get = <T,>(path: string) => request<T>("GET", path);
const post = <T,>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});

export const api = {
  stats: () => get<Stats>("/api/stats"),
  config: () => get<AppConfig>("/api/config"),
  sync: () => post<Record<string, number>>("/api/sync"),
  tickets: (params: { dispatch_status?: string; status?: string; q?: string; order?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return get<Ticket[]>(`/api/tickets${qs.size ? `?${qs}` : ""}`);
  },
  ticket: (id: string) => get<TicketDetail>(`/api/tickets/${encodeURIComponent(id)}`),
  dispatch: (id: string) => post(`/api/tickets/${encodeURIComponent(id)}/dispatch`),
  cancelDispatch: (id: string) => post(`/api/tickets/${encodeURIComponent(id)}/dispatch/cancel`),
  calls: (active = false) => get<Call[]>(`/api/calls${active ? "?active=true" : ""}`),
  simulate: (callId: number, action: string, digit?: string) =>
    post<{ call: Call; spoken: string | null; max_prompts: number }>(`/api/simulator/calls/${callId}`, { action, digit }),
  escalations: (status?: string) => get<Escalation[]>(`/api/escalations${status ? `?status=${status}` : ""}`),
  updateEscalation: (id: number, body: Partial<Pick<Escalation, "status" | "notes" | "assigned_to">>) =>
    request<Escalation>("PATCH", `/api/escalations/${id}`, body),
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
  saveSettings: (body: Partial<RuntimeSettings>) => request<RuntimeSettings>("PUT", "/api/settings", body),
};
