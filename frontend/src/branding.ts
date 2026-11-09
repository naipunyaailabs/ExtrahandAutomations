/**
 * Brand, link, currency and phone helpers. Every value comes from the backend
 * (/api/config → branding), which reads backend/.env. Nothing brand-specific is written here.
 */
import { useConfig } from "./components/Layout";
import type { Branding } from "./types";

const EMPTY: Branding = {
  company_name: "",
  website_url: "",
  logo_url: "",
  booking_url: "",
  offers_url: "",
  task_url_template: "",
  bulk_message_template: "",
  default_country_code: "",
  currency_code: "",
  currency_symbol: "",
};

let current: Branding = EMPTY;

/** Called once the backend config is loaded, so non-React helpers (fmtMoney) can use it. */
export function setBranding(b: Branding | undefined | null) {
  if (b) current = b;
}

export function getBranding(): Branding {
  return current;
}

export function useBranding(): Branding {
  return useConfig()?.branding ?? current;
}

export function bookingLink(b: Branding, city?: string | null, promo?: string | null): string {
  const params = new URLSearchParams();
  if (city && city !== "All-India" && city !== "India") params.set("city", city.toLowerCase());
  if (promo) params.set("promo", promo);
  const q = params.toString();
  return q ? `${b.booking_url}?${q}` : b.booking_url;
}

export function taskLink(b: Branding, taskId: string): string {
  return b.task_url_template.replace("{task_id}", encodeURIComponent(taskId));
}

/** Country code digits without "+", e.g. "91". */
export function countryDigits(b: Branding): string {
  return b.default_country_code.replace(/\D/g, "");
}

/** Normalise a phone number to +<country><number> using the configured country code. */
export function toE164(b: Branding, raw: string): string | null {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  const cc = countryDigits(b);
  if (!digits) return null;
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 11 && digits.startsWith("0")) return `+${cc}${digits.slice(1)}`;
  if (cc && digits.startsWith(cc) && digits.length > 10) return `+${digits}`;
  if (digits.length === 10) return `+${cc}${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function money(n: number | null | undefined, b: Branding = current): string {
  if (n == null) return "—";
  return `${b.currency_symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Fill {company}, {link}, {name} … placeholders in a template. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}
