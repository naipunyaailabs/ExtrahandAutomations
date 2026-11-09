/**
 * ExtraHand Intelligence Platform - API Gateway Client
 * 
 * Configured via frontend/.env:
 * - VITE_API_BASE_URL: Main FastAPI backend URL (e.g. http://127.0.0.1:8050)
 * - VITE_CALLING_SERVICE_URL: Service 1 (Voice Calling & Telephony)
 * - VITE_WHATSAPP_SERVICE_URL: Service 2 (WhatsApp Dispatch)
 * - VITE_MARKETING_SERVICE_URL: Service 3 (Festival & Demand Marketing)
 */

import { createCallingService } from "./services/calling";
import { createWhatsAppService } from "./services/whatsapp";
import { createMarketingService } from "./services/marketing";
import { createEngagementService } from "./services/engagement";

// Base URLs from .env
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
export const CALLING_SERVICE_URL = (import.meta.env.VITE_CALLING_SERVICE_URL || API_BASE_URL).replace(/\/+$/, "");
export const WHATSAPP_SERVICE_URL = (import.meta.env.VITE_WHATSAPP_SERVICE_URL || API_BASE_URL).replace(/\/+$/, "");
export const MARKETING_SERVICE_URL = (import.meta.env.VITE_MARKETING_SERVICE_URL || API_BASE_URL).replace(/\/+$/, "");
export const ENGAGEMENT_SERVICE_URL = (import.meta.env.VITE_ENGAGEMENT_SERVICE_URL || API_BASE_URL).replace(/\/+$/, "");

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
      headers: body && !isFormData ? { "Content-Type": "application/json" } : undefined,
      body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      `Cannot reach the server at ${url}. Check that the frontend (npm run dev) and backend (FastAPI port 8050) are running.`
    );
  }

  if (!res.ok) {
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
};
