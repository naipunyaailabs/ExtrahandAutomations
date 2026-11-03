/**
 * Service 3: Marketing & Festival Demand Radar Service
 * 
 * Manages festival calendars, automated city web scraping,
 * AI promotional copy generation, and WhatsApp flash discount campaigns.
 */

import type {
  AdBroadcastResult,
  AdTemplateResponse,
  CityEvent,
  CitySummary,
  ScanResultResponse,
} from "../types";

export function createMarketingService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, serviceUrl);

  return {
    cities: () => get<CitySummary[]>("/api/advestiment/cities"),
    addCity: (city_name: string, state?: string, data_sources?: string[]) =>
      post<CitySummary>("/api/advestiment/cities/add", { city_name, state: state || "Telangana", data_sources }),
    events: (city: string, year?: number, month?: number) => {
      const q = new URLSearchParams();
      if (year) q.set("year", String(year));
      if (month) q.set("month", String(month));
      const qs = q.toString() ? `?${q.toString()}` : "";
      return get<CityEvent[]>(`/api/advestiment/events/${encodeURIComponent(city)}${qs}`);
    },
    allIndia: (year?: number, month?: number) => {
      const q = new URLSearchParams();
      if (year) q.set("year", String(year));
      if (month) q.set("month", String(month));
      const qs = q.toString() ? `?${q.toString()}` : "";
      return get<CityEvent[]>(`/api/advestiment/all-india${qs}`);
    },
    scan: (payload: { city?: string; custom_query?: string; use_openrouter?: boolean }) =>
      post<ScanResultResponse>("/api/advestiment/scan", payload),
    scanReport: (city: string) =>
      get<ScanResultResponse>(`/api/advestiment/scan-report/${encodeURIComponent(city)}`),
    generateTemplate: (payload: {
      event_id: string;
      city: string;
      event_title: string;
      discount_percent: number;
      target_service: string;
      custom_instructions?: string;
    }) => post<AdTemplateResponse>("/api/advestiment/generate-template", payload),
    broadcast: (payload: {
      event_id: string;
      city: string;
      discount_code: string;
      promo_message: string;
      channel?: string;
      target_audience?: string;
    }) => post<AdBroadcastResult>("/api/advestiment/broadcast", payload),
  };
}

