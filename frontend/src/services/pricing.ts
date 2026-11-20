/**
 * Service 5: Pricing Agent
 *
 * The list the agent works on (areas, services, competitors), the pricing strategy,
 * runs, recommended prices with their evidence, and the per-area competitive analysis.
 */

import type {
  PriceRecommendation,
  PriceRecommendationDetail,
  PricingArea,
  PricingCompetitor,
  PricingReport,
  PricingRun,
  PricingService,
  PricingStatus,
  PricingStrategy,
} from "../types";

export type PricingAreaInput = Omit<PricingArea, "id">;
export type PricingServiceInput = Omit<PricingService, "id" | "slug" | "keywords"> & { keywords?: string[] };
export type PricingCompetitorInput = Omit<PricingCompetitor, "id">;

export function createPricingService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const call = <T>(method: string, path: string, body?: unknown) => request<T>(method, `/api/pricing${path}`, body, serviceUrl);

  return {
    status: () => call<PricingStatus>("GET", "/status"),

    areas: () => call<PricingArea[]>("GET", "/areas"),
    addArea: (a: PricingAreaInput) => call<PricingArea>("POST", "/areas", a),
    saveArea: (id: number, a: PricingAreaInput) => call<PricingArea>("PUT", `/areas/${id}`, a),
    removeArea: (id: number) => call<void>("DELETE", `/areas/${id}`),

    services: () => call<PricingService[]>("GET", "/services"),
    addService: (s: PricingServiceInput) => call<PricingService>("POST", "/services", s),
    saveService: (id: number, s: PricingServiceInput) => call<PricingService>("PUT", `/services/${id}`, s),
    removeService: (id: number) => call<void>("DELETE", `/services/${id}`),

    competitors: () => call<PricingCompetitor[]>("GET", "/competitors"),
    addCompetitor: (c: PricingCompetitorInput) => call<PricingCompetitor>("POST", "/competitors", c),
    saveCompetitor: (id: number, c: PricingCompetitorInput) => call<PricingCompetitor>("PUT", `/competitors/${id}`, c),
    removeCompetitor: (id: number) => call<void>("DELETE", `/competitors/${id}`),

    strategy: () => call<PricingStrategy>("GET", "/strategy"),
    saveStrategy: (s: PricingStrategy) => call<PricingStrategy>("PUT", "/strategy", s),

    runNow: () => call<{ id: number }>("POST", "/runs"),
    runs: () => call<PricingRun[]>("GET", "/runs"),

    recommendations: () => call<PriceRecommendation[]>("GET", "/recommendations"),
    recommendation: (id: number) => call<PriceRecommendationDetail>("GET", `/recommendations/${id}`),
    reports: () => call<PricingReport[]>("GET", "/reports"),
  };
}
