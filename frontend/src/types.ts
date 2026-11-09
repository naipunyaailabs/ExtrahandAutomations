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
  /** When the customer booked on ExtraHand (created_at is when the row was copied locally). */
  booked_at?: string | null;
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
  branding: Branding;
  runtime: RuntimeSettings;
}

/** Brand and locale values served by the backend (/api/config and /api/public-config). */
export interface Branding {
  company_name: string;
  website_url: string;
  logo_url: string;
  booking_url: string;
  offers_url: string;
  task_url_template: string;
  bulk_message_template: string;
  default_country_code: string;
  currency_code: string;
  currency_symbol: string;
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
  automation_active?: boolean;
  bulk_active?: boolean;
}

export interface WhatsAppChannelControls {
  automation_active: boolean;
  bulk_active: boolean;
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

/** One of today's orders (a Work booked or scheduled today, India time). */
export interface DashboardOrderItem {
  id: string;
  title: string;
  category: string;
  status: string;
  state_type: "success" | "fail" | "pending";
  customer_name: string;
  customer_phone: string;
  city: string;
  area: string;
  scheduled_at: string | null;
  scheduled_slot: string;
  created_at: string | null;
  budget: number;
  booking_source: string;
  posted_by: string;
  helper_name: string;
}

/** User Engagement dashboard for today (backend/user_engagement, live from ExtraHand). */
export interface EngagementDashboardSummary {
  today: string;
  today_label: string;
  timezone: string;
  source: "live" | "local";
  source_note: string;
  fetched_at: string;
  refresh_seconds: number;
  total_users: number;
  new_users_today: number | null;
  new_users_month: number | null;
  active_users_month: number;
  active_users_today: number;
  total_orders_all_time: number;
  today_orders_count: number;
  today_success: number;
  today_fail: number;
  today_pending: number;
  monthly_orders_count: number;
  monthly_success: number;
  monthly_fail: number;
  monthly_pending: number;
  today_orders: DashboardOrderItem[];
  categories_breakdown: Record<string, number>;
  booking_sources: Record<string, number>;
  support: { available: boolean; reason?: string | null; total: number; open: number; by_status: Record<string, number> };
  /** Left out so only real customers are counted: Works posted by the ExtraHand team and test accounts. */
  excluded?: { team_posted_works?: number; test_account_works?: number; test_accounts?: number; test_account_names?: string[] };
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

export interface BulkRecipient {
  phone: string;
  name?: string;
  custom_vars?: Record<string, string>;
}

export interface BulkMessageRequest {
  recipients: BulkRecipient[];
  message: string;
  template_id?: string;
  variables?: Record<string, string>;
  channel?: string;
}

export interface BulkMessageItemResult {
  phone: string;
  name?: string;
  status: "sent" | "simulated" | "failed";
  message_id?: string;
  error?: string;
}

export interface BulkMessageResponse {
  ok: boolean;
  total: number;
  sent_count: number;
  failed_count: number;
  simulated_count: number;
  results: BulkMessageItemResult[];
  timestamp?: string;
}

export interface ParsedContact {
  phone: string;
  name?: string | null;
  is_valid: boolean;
  formatted_phone: string;
  original_phone: string;
  row: number;
  reason?: string | null;
}

export interface ParseContactsResponse {
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  detected_phone_column?: string | null;
  detected_name_column?: string | null;
  detected_columns: string[];
  contacts: ParsedContact[];
  filename?: string | null;
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
  knowledge?: FestivalKnowledge;
  source: string;
  status?: string;
  importance_score?: number;
  importance_reason?: string;
  event_scope?: "local" | "regional" | "national" | string;
  source_url?: string;
  source_name?: string;
  is_verified?: boolean;
  confidence_score?: number;
  poster_url?: string;
  poster_theme?: string;
  poster_generated_at?: string;
  admin_notes?: string;
  published_at?: string;
  discovery_date?: string;
}

export interface PosterInfo {
  id: string;
  event_id: string;
  event_title: string;
  city: string;
  date_str: string;
  poster_url: string;
  poster_svg?: string;
  theme?: string;
  status: "generated" | "published" | string;
  created_at?: string;
  /** Design used for this poster: colours, icon, photo (`image`), `variant` number and `source` ("ai" | "preset"). */
  palette?: Record<string, any> | null;
}

/** All-India festival finder (GPT-OSS-20B agent reading Drik Panchang); results wait for admin approval. */
export interface FestivalFinderStatus {
  configured: boolean;
  running: boolean;
  step: string;
  model: string;
  source: string;
  verify_source: string;
  window: string[];
  every_months: number;
  last_run: { status: string; summary: string; found: number; saved: number; ran_at: string; period: string } | null;
  next_due: string | null;
  due: boolean;
}

/** Poster agent scan of this month and the next two (Seedream 5.0 Flash artwork). */
export interface PosterScanStatus {
  running: boolean;
  step: string;
  done: number;
  total: number;
  last: { summary: string; made: number; failed: number; ran_at: string } | null;
  window_start: string;
  window_end: string;
  waiting: number;
  image_model: string;
}

/** Poster agent progress for one event. */
export interface PosterAgentStatus {
  status: "running" | "ready" | "failed" | "none" | "missing" | "awaiting_approval";
  poster_url?: string;
  error?: string;
}

export interface CitySummary {
  city_name: string;
  state: string;
  active_campaigns: number;
  upcoming_events_count: number;
  top_demand_service: string;
  featured_discount: string;
  is_national: boolean;
  /** "national" (All-India), "state" or "city" */
  region_type?: "national" | "state" | "union_territory" | "city";
  events?: CityEvent[];
}

/** Optional festival profile the poster agent designs from. */
/** Agent 1 (Festival Research & Prompt Generator) output: structured festival details + image prompt for Agent 2. */
export interface FestivalKnowledge {
  summary?: string;
  religion?: string;
  significance?: string;
  greeting?: string;
  figures?: string[];
  rituals?: string[];
  symbols?: string[];
  colors?: string[];
  attire?: string[];
  foods?: string[];
  places?: string[];
  regions?: string[];
  imagery_do?: string[];
  imagery_avoid?: string[];
  image_prompt?: string;
  model?: string;
  learned_at?: string;
}

/** User Engagement > Category: real customers of a month grouped by orders placed. */
export type CustomerTierKey = "diamond" | "gold" | "platinum" | "silver";

export interface CustomerTier {
  key: CustomerTierKey;
  label: string;
  min_orders: number;
  max_orders: number | null;
  range: string;
  count: number;
  percent: number;
}

export interface CategorisedCustomer {
  customer_key: string;
  name: string;
  phone: string;
  area: string;
  city: string;
  orders: number;
  completed: number;
  cancelled: number;
  pending: number;
  spent: number;
  last_order_at: string | null;
  tier: CustomerTierKey | null;
  top_service: string;
  services: string[];
  lifetime_orders: number;
}

export interface CustomerCategories {
  month: string;
  month_label: string;
  is_current_month: boolean;
  months: { value: string; label: string }[];
  tiers: CustomerTier[];
  customers: CategorisedCustomer[];
  active_customers: number;
  registered_customers: number;
  orders_in_month: number;
  source: "live" | "local";
  fetched_at: string;
  source_note: string;
}

/** One page of Silver customers (registered, no order in the month). */
export interface SilverCustomerPage {
  available: boolean;
  reason?: string;
  month?: string;
  customers: {
    customer_key: string;
    name: string;
    phone: string;
    area: string;
    city: string;
    joined_at: string | null;
    lifetime_orders: number;
    last_order_at: string | null;
    status: string;
  }[];
  page: number;
  pages: number;
  registered?: number;
}

/** Today's dispatch pipeline (backend app/services/dispatch_flow.py): real-customer orders + channel activity. */
interface DispatchFlowBase {
  today: string;
  source: "live" | "local";
  fetched_at: string;
  source_note: string;
  tasks_today: number;
  total_orders: number;
}

export interface WhatsAppFlow extends DispatchFlowBase {
  open_today: number;
  eligible_helpers: number;
  helper_pool: number;
  sent_today: number;
  sent_total: number;
  simulated_today: number;
  simulated_total: number;
  failed_today: number;
  failed_total: number;
  in_progress_today: number;
  completed_today: number;
  delivery_tracking: boolean;
}

/** How a group of today's tasks stands right now. */
export interface TaskProgress {
  completed: number;
  in_progress: number;
  cancelled: number;
}

export interface CallingFlow extends DispatchFlowBase {
  assigned_today: number;
  unassigned_today: number;
  assigned_progress: TaskProgress;
  unassigned_progress: TaskProgress;
  today_progress: TaskProgress;
  followups_cancelled_today: number;
  cancelled_today: number;
  calls_today: number;
  real_calls_today: number;
  simulated_calls_today: number;
  dispatch_calls_today: number;
  accepted_today: number;
  followup_calls_today: number;
  followups_due_today: number;
  followups_done_today: number;
  active_calls: number;
  open_escalations: number;
  escalated_today: number;
}
