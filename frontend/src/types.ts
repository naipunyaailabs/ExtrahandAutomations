export type DispatchStatus = "new" | "dispatching" | "assigned" | "escalated" | "closed";

export interface Person {
  id: string | null;
  name: string | null;
  phone: string | null;
  email?: string | null;
  profile_id?: string | null;
}

export interface Call {
  id: number;
  ticket_id: string;
  ticket_title?: string;
  purpose: "dispatch" | "followup" | "feedback" | "callback";
  run_id: number | null;
  followup_id: number | null;
  helper_id: string | null;
  helper_name: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  language?: string | null;
  transcript?: string | null;
  summary?: string | null;
  duration_seconds?: number | null;
  phone: string | null;
  provider: string;
  provider_call_id: string | null;
  status: "queued" | "ringing" | "in_progress" | "ended";
  outcome: string | null;
  prompts_played: number;
  digits: string;
  script: string | null;
  error: string | null;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

export interface FollowUp {
  id: number;
  ticket_id: string;
  helper_id: string | null;
  helper_name: string | null;
  phone: string | null;
  offset_minutes: number;
  due_at: string;
  status: string;
  outcome: string | null;
}

export interface Candidate {
  helper_id: string;
  profile_id: string | null;
  name: string | null;
  phone: string;
  skills: string[];
  distance_km: number | null;
}

export interface DispatchRun {
  id: number;
  status: "running" | "accepted" | "escalated" | "cancelled";
  candidates: Candidate[];
  current_index: number;
  candidate_source: string | null;
  reason: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Ticket {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  status: string | null;
  dispatch_status: DispatchStatus;
  budget: number | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  scheduled_at: string | null;
  booking_source: string | null;
  customer: Person;
  assignee: Person | null;
  assignment_local_only: boolean;
  created_at?: string | null;
  synced_at: string | null;
  updated_at: string | null;
  // date comparison & categorization
  date_status?: "today" | "upcoming" | "past" | "unscheduled";
  is_today?: boolean;
  is_upcoming?: boolean;
  is_past?: boolean;
  days_from_today?: number | null;
  // list only
  active_call?: Call | null;
  next_followup?: FollowUp | null;
  has_open_escalation?: boolean;
  last_run?: { status: string; progress: string } | null;
}

export interface Escalation {
  id: number;
  ticket_id: string;
  reason: string;
  details: string | null;
  status: "open" | "in_progress" | "resolved";
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  ticket: Ticket | null;
}

export interface EventItem {
  id: number;
  ticket_id: string | null;
  kind: string;
  message: string;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  raw: unknown;
  runs: DispatchRun[];
  calls: Call[];
  followups: FollowUp[];
  escalations: Escalation[];
  events: EventItem[];
}

export interface Stats {
  tickets_total: number;
  tickets_by_status: Partial<Record<DispatchStatus, number>>;
  tickets_by_raw_status?: Record<string, number>;
  completed_tickets?: number;
  cancelled_tickets?: number;
  unassigned_tickets?: number;
  assigned_tickets?: number;
  closed_tickets?: number;
  assigned_helpers?: number;
  active_calls: number;
  calls_24h: number;
  call_outcomes_24h: Record<string, number>;
  acceptance_rate_24h: number | null;
  open_escalations: number;
  followups_scheduled: number;
  last_sync: { at: string | null; ok: boolean | null; error: string | null; stats: Record<string, number> | null };
}

export interface RuntimeSettings {
  followup_offsets_minutes: number[];
  auto_dispatch: boolean;
  max_helpers_per_ticket: number;
  match_radius_km: number;
  emergency_stop_calls?: boolean;
  workflow_helper_dispatch_enabled?: boolean;
  workflow_customer_feedback_enabled?: boolean;
  calling_hours_start?: string;
  calling_hours_end?: string;
  feedback_call_delay_minutes?: number;
  preferred_language?: string;
  cost_per_call_minute?: number;
  cost_per_whatsapp_msg?: number;
}

export interface AppConfig {
  extrahand_mode: "mock" | "live";
  telephony_provider: "simulator" | "twilio";
  assignment_enabled: boolean;
  matching_api_configured: boolean;
  ivr_max_prompts: number;
  sync_interval_seconds: number;
  whatsapp_enabled?: boolean;
  whatsapp_gateway_url?: string;
  whatsapp_simulated?: boolean;
  runtime: RuntimeSettings;
}

export interface WhatsAppStatus {
  session_id: string;
  status: "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED" | "STOPPED" | "DISCONNECTED" | "UNKNOWN" | string;
  phone_number?: string | null;
  engine?: string | null;
  uptime_seconds?: number | null;
  qr_code_available?: boolean;
  messages_today?: number;
  messages_total?: number;
  delivery_rate?: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  message_id?: string | null;
  status: string;
  error?: string | null;
  timestamp: string;
}

export interface Helper {
  id: string;
  profile_id: string | null;
  name: string | null;
  phone: string | null;
  alt_phone?: string | null;
  email?: string | null;
  skills: string[];
  categories: string[];
  work_areas: string[];
  address?: string | null;
  city: string | null;
  state?: string | null;
  pincode?: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  is_active: boolean;
  is_verified: boolean;
  can_accept_tasks: boolean;
  work_shift_type?: string | null;
  active_tickets_count?: number;
  total_calls_count?: number;
  updated_at: string;
}

export interface HelperDetail extends Helper {
  raw?: unknown;
  tickets: Ticket[];
  calls: Call[];
}

export interface HelperFilters {
  cities: string[];
  areas: string[];
  locations: string[];
  services: string[];
  total_helpers: number;
  assigned_helpers_count?: number;
  assigned_tickets_count?: number;
}

export interface CustomerFeedback {
  id: number;
  ticket_id: string;
  customer_id: string | null;
  rating: number; // 1 to 5
  feedback_text: string | null;
  channel: "voice" | "whatsapp" | "web";
  language: string;
  sentiment: "positive" | "neutral" | "negative";
  complaint_category: "late_arrival" | "poor_service" | "incomplete_work" | "overcharging" | "unprofessional" | "other" | null;
  resolution_status: "pending" | "in_review" | "resolved" | "escalated";
  assigned_agent: string | null;
  resolution_notes: string | null;
  callback_requested: boolean;
  callback_scheduled_at: string | null;
  call_attempt_id: number | null;
  call_duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export type UserTier = "diamond" | "gold" | "silver";

export interface UserSegmentItem {
  customer_id: string;
  name: string;
  phone: string;
  email?: string | null;
  city: string;
  total_tasks: number;
  monthly_tasks: number;
  weekly_tasks: number;
  monthly_tier: UserTier;
  weekly_tier: UserTier;
  top_category: string;
  last_active?: string | null;
}

export interface TierCountSummary {
  diamond: number;
  gold: number;
  silver: number;
  total: number;
  diamond_pct: number;
  gold_pct: number;
  silver_pct: number;
}

export interface UserSegmentationSummary {
  monthly: TierCountSummary;
  weekly: TierCountSummary;
  users: UserSegmentItem[];
  criteria: {
    monthly: {
      diamond: string;
      gold: string;
      silver: string;
    };
    weekly: {
      diamond: string;
      gold: string;
      silver: string;
    };
  };
}

export interface ReportsSummary {
  period_days: number;
  bookings: {
    total: number;
    completed: number;
    cancelled: number;
    unassigned: number;
    assigned: number;
  };
  calls: {
    total: number;
    successful: number;
    failed: number;
    unanswered: number;
    total_duration_minutes: number;
    estimated_cost_inr: number;
  };
  helpers: {
    total_active: number;
    availability_responses: Record<string, number>;
    acceptance_rate: number;
  };
  csat: {
    total_responses: number;
    average_rating: number;
    rating_breakdown: Record<string, number>;
    complaints_count: number;
    complaints_by_category: Record<string, number>;
    callbacks_requested: number;
  };
  whatsapp: {
    estimated_messages: number;
    estimated_cost_inr: number;
  };
  costs: {
    voice_inr: number;
    whatsapp_inr: number;
    total_inr: number;
  };
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  template: string;
  variables: string[];
}



export interface TaskLocationCandidateHelper {
  helper_id: string;
  profile_id?: string | null;
  name: string;
  phone: string;
  skills?: string[];
  categories?: string[];
  city?: string | null;
  distance_km?: number | null;
  is_verified?: boolean;
  status?: string;
  rating?: number;
}

export interface TaskLocationCandidates {
  ticket_id: string;
  task_title: string;
  location: string;
  service?: string;
  helpers_count: number;
  helpers: TaskLocationCandidateHelper[];
  candidates?: TaskLocationCandidateHelper[];
}

export interface WhatsAppBroadcastResult {
  ok: boolean;
  ticket_id: string;
  task_title: string;
  location: string;
  service?: string;
  total_helpers_in_location: number;
  helpers_contacted: number;
  sent_count: number;
  simulated_count: number;
  failed_count: number;
  candidates: Array<{
    helper_id: string;
    name: string;
    phone: string;
    distance_km?: number | null;
    city?: string | null;
    status: string;
    message_id?: string;
    error?: string;
  }>;
  summary: string;
}

export interface CityEvent {
  id: string;
  title: string;
  city: string;
  date_start: string;
  date_end: string;
  category: "Festival" | "Sports" | "Cultural" | "Seasonal" | "Expo" | "National Holiday" | string;
  impact_level: "Peak" | "High" | "Medium" | string;
  target_services: string[];
  description: string;
  demand_surge: string;
  suggested_discount: number;
  discount_code: string;
  promo_template: string;
  source: string;
}

export interface CitySummary {
  city_name: string;
  state: string;
  active_campaigns: number;
  upcoming_events_count: number;
  top_demand_service: string;
  featured_discount: string;
  is_national: boolean;
  data_sources?: string[];
  events?: CityEvent[];
}

export interface CrawlSourceTelemetry {
  url: string;
  status: string;
  http_status: number;
  detected_headline?: string | null;
  events_found: number;
  scanned_at: string;
}

export interface ScanResultResponse {
  ok: boolean;
  city: string;
  sources_crawled: CrawlSourceTelemetry[];
  events_discovered: CityEvent[];
  summary: string;
}

export interface AdTemplateResponse {
  ok: boolean;
  event_id: string;
  city: string;
  discount_percent: number;
  discount_code: string;
  promo_template: string;
  headline: string;
  call_to_action: string;
  source: string;
}

export interface AdBroadcastResult {
  ok: boolean;
  event_id: string;
  city: string;
  channel: string;
  target_audience: string;
  customers_reached: number;
  delivered_count: number;
  failed_count: number;
  discount_code: string;
  summary: string;
}

