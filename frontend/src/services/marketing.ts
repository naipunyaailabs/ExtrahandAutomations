/**
 * Marketing service: regions (All-India and the cities), festivals and their posters.
 * Festivals are registered by hand; for All-India the festival finder can also suggest them for approval.
 */

import type {
  AdCommercialReport, AdRates, CityEvent, CitySummary, FestivalFinderStatus, PosterAgentStatus, PosterInfo, PosterScanStatus,
  SeedConfig, SeedContact, SeedContactsPage, SeedFestivalCalendar, SeedFestivalDay, SeedService, SeedStatus, SeedTemplateView,
} from "../types";

export function createMarketingService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, serviceUrl);
  const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body, serviceUrl);
  const del = <T>(path: string) => request<T>("DELETE", path, undefined, serviceUrl);
  const id = (eventId: string) => encodeURIComponent(eventId);

  return {
    /** What the Advertisement Agent's AI cost (OpenRouter), and its rate card. */
    commercials: () => get<AdCommercialReport>("/api/advestiment/commercials"),
    saveCommercialRates: (body: AdRates) => put<AdRates>("/api/advestiment/commercials/rates", body),
    /** All-India and the cities, with their upcoming festivals. */
    cities: () => get<CitySummary[]>("/api/advestiment/cities"),
    addCity: (city_name: string, state?: string) =>
      post<CitySummary>("/api/advestiment/cities/add", { city_name, state: state || undefined }),

    /** Festivals of a region (All-India or a city) in a month. */
    events: (city: string, year?: number, month?: number) => {
      const q = new URLSearchParams();
      if (year) q.set("year", String(year));
      if (month) q.set("month", String(month));
      const qs = q.toString() ? `?${q.toString()}` : "";
      return get<CityEvent[]>(`/api/advestiment/events/${encodeURIComponent(city)}${qs}`);
    },

    /** Register a festival for one day; the poster agent then designs its poster. */
    registerEvent: (payload: { city: string; date: string; title: string; description?: string; discount_code: string }) =>
      post<CityEvent>("/api/advestiment/events/register", payload),
    updateRegisteredEvent: (eventId: string, payload: { title: string; description?: string; discount_code: string }) =>
      put<CityEvent>(`/api/advestiment/events/register/${id(eventId)}`, payload),
    deleteEvent: (eventId: string) => del<{ ok: boolean; id: string }>(`/api/advestiment/events/detail/${id(eventId)}`),

    /** Admin decision on a festival suggested by the All-India festival finder. */
    approveEvent: (eventId: string) => post<CityEvent>(`/api/advestiment/events/detail/${id(eventId)}/approve`),
    rejectEvent: (eventId: string) => post<CityEvent>(`/api/advestiment/events/detail/${id(eventId)}/reject`),

    /** All-India festival finder: GPT-OSS-20B agent reading Drik Panchang, for the current and next two months. */
    finderStatus: () => get<FestivalFinderStatus>("/api/advestiment/festival-finder/status"),
    startFinder: () => post<FestivalFinderStatus>("/api/advestiment/festival-finder/start"),

    /** Poster agent: posters for approved festivals of this month and the next two that have none. */
    posterScanStatus: () => get<PosterScanStatus>("/api/advestiment/posters/scan/status"),
    startPosterScan: () => post<PosterScanStatus>("/api/advestiment/posters/scan"),

    posterStatus: (eventId: string) =>
      get<PosterAgentStatus>(`/api/advestiment/events/detail/${id(eventId)}/poster-status`),
    restartPosterAgent: (eventId: string) =>
      post<PosterAgentStatus>(`/api/advestiment/events/detail/${id(eventId)}/poster-agent`),
    generatePoster: (eventId: string, theme?: string) =>
      post<PosterInfo>(`/api/advestiment/events/detail/${id(eventId)}/generate-poster`, { theme }),

    /** Task-Seeding Agent: first-booking nudges (WhatsApp + optional Telugu call) to new customers. */
    seeding: {
      status: (days = 30) => get<SeedStatus>(`/api/marketing/task-seeding/status?days=${days}`),
      save: (body: Partial<SeedConfig>) => put<SeedConfig>("/api/marketing/task-seeding/settings", body),
      runNow: () => post<Record<string, unknown>>("/api/marketing/task-seeding/run-now"),
      contacts: (status = "all", q = "", offset = 0, limit = 50) =>
        get<SeedContactsPage>(`/api/marketing/task-seeding/contacts?status=${status}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`),
      retryFailed: () => post<{ retrying: number }>("/api/marketing/task-seeding/retry-failed"),
      retry: (contactId: number) => post<SeedContact>(`/api/marketing/task-seeding/contacts/${contactId}/retry`),
      submitTemplate: (language?: string) =>
        post<{ results: Record<string, { ok: boolean; already: boolean; status?: string; error?: string | null; edited?: boolean }>; button_url: string; clicks_tracked: boolean; template: SeedTemplateView }>(
          `/api/marketing/task-seeding/template${language ? `?language=${language}` : ""}`),
      template: () => get<SeedTemplateView>("/api/marketing/task-seeding/template"),
      saveTemplate: (language: string, body: { body: string; footer: string; button: string }) =>
        put<SeedTemplateView>(`/api/marketing/task-seeding/template/${language}`, body),
      resetTemplate: (language: string) => del<SeedTemplateView>(`/api/marketing/task-seeding/template/${language}`),
      festivals: (year: number, month: number) =>
        get<SeedFestivalCalendar>(`/api/marketing/task-seeding/festivals?year=${year}&month=${month}`),
      saveFestival: (eventId: string, body: { enabled: boolean; services: string[]; promo_code: string; hooks: Record<string, string>; send_from: string | null; send_until: string | null }) =>
        put<SeedFestivalDay>(`/api/marketing/task-seeding/festivals/${id(eventId)}`, body),
      addService: (body: { en: string; te?: string; hi?: string; category: string }) =>
        post<SeedService>("/api/marketing/task-seeding/services", body),
      deleteService: (key: string) => del<{ ok: boolean }>(`/api/marketing/task-seeding/services/${encodeURIComponent(key)}`),
      resetFestival: (eventId: string) => del<{ ok: boolean }>(`/api/marketing/task-seeding/festivals/${id(eventId)}`),
      optOut: (phone: string, note?: string) => post<{ ok: boolean }>("/api/marketing/task-seeding/opt-outs", { phone, note }),
    },
  };
}
