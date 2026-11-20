/**
 * ExtraHand Intelligence Platform - API client.
 *
 * One backend serves the dashboard and every API on the same port, so requests go to the page's own address.
 * VITE_API_BASE_URL is only needed when the dashboard is hosted somewhere else than the backend.
 */

import { createCallingService } from "./services/calling";
import { createWhatsAppService } from "./services/whatsapp";
import { createMarketingService } from "./services/marketing";
import { createEngagementService } from "./services/engagement";
import { createPricingService } from "./services/pricing";
import type { AuthUser, CompetitorPriceInput, CompetitorPriceItem, PricingOverview } from "./types";

export const AUTH_EXPIRED_EVENT = "ip_auth_expired";

// One backend for everything (empty = the page's own address)
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
export const CALLING_SERVICE_URL = API_BASE_URL;
export const WHATSAPP_SERVICE_URL = API_BASE_URL;
export const MARKETING_SERVICE_URL = API_BASE_URL;
export const ENGAGEMENT_SERVICE_URL = API_BASE_URL;
export const PRICING_SERVICE_URL = API_BASE_URL;

/**
 * Resolves the target URL for a request.
 * In local development, relative paths are preferred so Vite dev proxy handles the connection
 * smoothly without browser CORS or localhost/127.0.0.1 mismatch issues.
 * In production or with remote URLs, the full service URL is used.
 */
function resolveUrl(path: string, serviceUrl?: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const base = serviceUrl || API_BASE_URL;
  // If base is empty or points to this machine, use a relative path so the Vite proxy handles it
  if (!base || /^https?:[/][/](localhost|127[.]0[.]0[.]1)(:|[/]|$)/.test(base)) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Core HTTP client with error handling and JSON parsing.
 */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  serviceUrl?: string
): Promise<T> {
  const url = resolveUrl(path, serviceUrl);
  let res: Response;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body && !isFormData ? { "Content-Type": "application/json" } : undefined,
      body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      `Cannot reach the server (${url}). Check your internet connection; if it keeps happening, the backend may be down.`
    );
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) {
        msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
      }
    } catch {
      /* non-JSON response */
    }
    throw new Error(msg);
  }

  return res.status === 204 ? (undefined as T) : res.json();
}

// Instantiate individual services
const callingService = createCallingService(request, CALLING_SERVICE_URL);
const whatsAppService = createWhatsAppService(request, WHATSAPP_SERVICE_URL);
const marketingService = createMarketingService(request, MARKETING_SERVICE_URL);
const engagementService = createEngagementService(request, ENGAGEMENT_SERVICE_URL);
const pricingService = createPricingService(request, PRICING_SERVICE_URL);

/**
 * Unified API Client
 * Exposes individual services while maintaining 100% backward compatibility for all existing callers.
 */
export const api = {
  // Service 1: Calling Service
  ...callingService,
  calling: callingService,

  // Service 2: WhatsApp Service
  whatsapp: whatsAppService,

  // Service 3: Marketing & Advertisement Service
  marketing: marketingService,
  advestiment: marketingService, // Backward-compatible alias for existing components

  // Service 4: User Engagement & Operational Performance Analytics Service
  engagement: engagementService,
  reports: engagementService, // Backward-compatible alias for existing components

  // Service 5: Competitive Pricing
  //  - Pricing Agent (services/pricing.ts): areas, services, competitors, runs, recommended prices, analysis
  //  - comparison: our live ExtraHand prices vs competitor prices entered by the team
  pricing: {
    ...pricingService,
    comparison: () => request<PricingOverview>("GET", "/api/pricing", undefined, PRICING_SERVICE_URL),
    saveCompetitorPrice: (body: CompetitorPriceInput) =>
      request<CompetitorPriceItem>("POST", "/api/pricing/competitor-prices", body, PRICING_SERVICE_URL),
    updateCompetitorPrice: (id: number, body: CompetitorPriceInput) =>
      request<CompetitorPriceItem>("PUT", `/api/pricing/competitor-prices/${id}`, body, PRICING_SERVICE_URL),
    removeCompetitorPrice: (id: number) =>
      request<{ ok: boolean }>("DELETE", `/api/pricing/competitor-prices/${id}`, undefined, PRICING_SERVICE_URL),
  },

  // Auth & Session
  auth: {
    login: (email: string, password: string, remember = true) =>
      request<AuthUser>("POST", "/api/auth/login", { email, password, remember }, API_BASE_URL),
    me: () => request<AuthUser>("GET", "/api/auth/me", undefined, API_BASE_URL),
    logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout", undefined, API_BASE_URL),
  },
};
