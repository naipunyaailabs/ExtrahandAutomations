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
  status: "queued" | "ringing" | "in_progress" | "handoff" | "ended";
  outcome: string | null;
  prompts_played: number;
  digits: string;
  script: string | null;
  error: string | null;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  /** What the voice agent (Maya) recorded after a hand-off: her decision or complaint, reason and arrival time. */
  handoff?: {
    kind: "reminder" | "rating";
    decision?: "cannot_come" | "running_late";
    reason?: string;
    eta_minutes?: number | null;
    eta_at?: string;
    complaint_category?: string;
    details?: string;
    summary?: string;
  } | null;
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
  /** When the task should finish (slot end, or start + estimated duration); null when unknown. */
  scheduled_end_at?: string | null;
  booking_source: string | null;
  customer: Person;
  assignee: Person | null;
  assignment_local_only: boolean;
  /** Who assigned the helper: on ExtraHand, or here (accepted on our call / replied YES on WhatsApp). */
  assigned_via?: "extrahand" | "call" | "whatsapp" | null;
  assigned_at?: string | null;
  /** Our assignment written to ExtraHand: pending | ok | failed (null when ExtraHand assigned it itself). */
  extrahand_push?: "pending" | "ok" | "failed" | null;
  extrahand_push_error?: string | null;
  /** WhatsApp task alerts sent to helpers for this task (list endpoint only). */
  whatsapp?: { total: number; sent: number; delivered: number; read: number; failed: number; simulated?: number; last_at: string | null; no_match?: boolean; from_event?: boolean } | null;
  /** Dispatch calls placed to helpers for this task (list endpoint only). */
  call_summary?: { placed: number; answered: number; accepted: number; last_outcome: string | null; last_at: string | null } | null;
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
  /** the synced task; null for a WhatsApp Support case that is not about one */
  ticket_id: string | null;
  /** calling (calling agent) | whatsapp (WhatsApp Support) | whatsapp_test (the in-app tester) */
  source?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  booking_id?: string | null;
  category?: string | null;
  conversation_id?: number | null;
  reason: string;
  details: string | null;
  status: "open" | "in_progress" | "resolved";
  /** how a resolved case ended: achieved (solved) | rejected (closed without a solution) */
  outcome?: "achieved" | "rejected" | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  ticket: Ticket | null;
}

/** A customer care team member (cases are assigned to them by name) */
export interface CareMember {
  id: number;
  name: string;
  phone: string | null;
  role: string | null;
  active: boolean;
  created_at: string | null;
}

export interface CarePeriod {
  received: number; done: number; achieved: number; rejected: number; pending: number; achieved_rate: number | null;
}

/** Customer Care dashboard */
export interface CareStats {
  periods: Record<"today" | "week" | "month" | "all", CarePeriod>;
  now: { open: number; in_progress: number; unassigned: number; oldest_waiting_since: string | null };
  members: (CareMember & { assigned: number; working_on: number; achieved: number; rejected: number })[];
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
  /** Latest WhatsApp task alert per helper phone (last 10 digits). */
  whatsapp_alerts?: Record<string, { status: string; at: string | null; error: string | null; template: string | null }>;
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
  emergency_stop_calls?: boolean;
  calling_agent_active?: boolean;
  last_sync: { at: string | null; ok: boolean | null; error: string | null; stats: Record<string, number> | null };
}

export interface CallingHours {
  /** true when the agent may place calls right now (India time) */
  open: boolean;
  start: string; // "07:30"
  end: string; // "21:30"
  label: string; // "7:30 AM – 9:30 PM IST"
  /** UTC ISO of the next opening when closed */
  next_open: string | null;
}

export interface CallingAgentStatus {
  calling_hours?: CallingHours;
  active: boolean;
  status: "active" | "deactive";
  emergency_stop_calls?: boolean;
  message: string;
}

export interface BulkContact {
  name?: string;
  phone: string;
  formatted?: string;
  is_valid?: boolean;
  reason?: string;
}

export interface BulkCallItem {
  id: number;
  name: string | null;
  phone: string;
  status: "pending" | "calling" | "completed" | "failed" | "busy" | "no_answer";
  duration_seconds: number | null;
  error_message: string | null;
  called_at: string | null;
}

export interface BulkCampaign {
  id: number;
  title: string;
  script: string;
  language: string;
  status: "inactive" | "active" | "paused" | "completed" | "cancelled";
  total_contacts: number;
  completed_calls: number;
  failed_calls: number;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  contacts?: BulkCallItem[];
}

export interface ParseContactsFileResponse {
  filename: string;
  total: number;
  valid_count: number;
  invalid_count: number;
  contacts: BulkContact[];
}

export interface RuntimeSettings {
  followup_offsets_minutes: number[];
  auto_dispatch: boolean;
  max_helpers_per_ticket: number;
  match_radius_km: number;
  emergency_stop_calls?: boolean;
  calling_agent_active?: boolean;
  workflow_helper_dispatch_enabled?: boolean;
  workflow_customer_feedback_enabled?: boolean;
  calling_hours_start?: string;
  calling_hours_end?: string;
  feedback_call_delay_minutes?: number;
  preferred_language?: string;
  cost_per_call_minute?: number;
  cost_per_whatsapp_msg?: number;
  /** Automatic calls & IVR start this many hours before a task's time. */
  dispatch_lead_hours?: number;
}

export interface AppConfig {
  extrahand_mode: "mock" | "live";
  telephony_provider: "simulator" | "twilio" | "vobiz";
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
  messages_failed_total?: number;
  messages_simulated_total?: number;
  delivery_rate?: string;
  automation_active?: boolean;
  bulk_active?: boolean;
  /** Meta Cloud API details (live check against Meta) */
  configured?: boolean;
  simulated?: boolean;
  phone_number_id?: string | null;
  verified_name?: string | null;
  quality_rating?: string | null;
  api_version?: string | null;
  mode?: string | null;
  error?: string | null;
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
  /** Helpers (ExtraHand partners): registrations from ExtraHand (null on the local copy), activity from assigned Works. */
  helpers?: {
    total: number | null;
    new_today: number | null;
    new_month: number | null;
    verified: number | null;
    aadhaar_verified: number | null;
    pan_verified?: number | null;
    bank_verified?: number | null;
    /** Aadhaar, PAN and bank all verified */
    kyc_complete?: number | null;
    with_completed_jobs: number | null;
    blocked: number | null;
    active_month: number;
    active_today: number;
    today_assigned: number;
    month_assigned: number;
  };
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
  /** Meta review state (bulk list): APPROVED | PENDING | REJECTED ... */
  status?: string;
  /** set when an automation sends this template; it can then not be deleted from Meta */
  used_by?: string | null;
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
  image_url?: string;
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
  city?: string;
  category?: string;
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

/** Festival WhatsApp: cities switched on, sends per city and the poster template's review at Meta. */
export interface FestivalWhatsAppStatus {
  /** lower-case city name: switched on at (ISO) */
  active: Record<string, string>;
  /** lower-case city name */
  per_city: Record<string, { sent: number; failed: number; last_at: string | null }>;
  poster_template: { language: string; language_name: string; status: string; rejected_reason: string | null }[];
  blocked: string | null;
  last_run: string | null;
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

// ---- sign-in ---------------------------------------------------------------------------------------------

export interface AuthUser {
  email: string;
  name: string;
  role: string;
  /** False on a development server that has no login configured. */
  auth_enabled: boolean;
  token?: string;
}

// ---- call detail -----------------------------------------------------------------------------------------

export interface TimelineEvent {
  /** ISO time, UTC. */
  t: string;
  event: string;
  detail?: string;
}

export interface CallDetail extends Call {
  timeline: TimelineEvent[];
  ticket: {
    id: string;
    title: string | null;
    category: string | null;
    city: string | null;
    address: string | null;
    scheduled_at: string | null;
    status: string | null;
    dispatch_status: string | null;
  } | null;
  followup: { id: number; offset_minutes: number; due_at: string | null; retry_of: number | null } | null;
}

// ---- Voice & IVR -----------------------------------------------------------------------------------------

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export interface VoiceCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix: string;
  /** How long a live check took. */
  ms: number | null;
}

export interface VoiceStatus {
  environment: "development" | "production";
  provider: "simulator" | "twilio" | "vobiz";
  ready: boolean;
  summary: Record<CheckStatus, number>;
  checks: VoiceCheck[];
  timing: {
    max_prompts: number;
    key_wait_seconds: number;
    ring_seconds: number;
    handoff_limit_seconds: number;
    handoff_ring_seconds: number;
    retry_after_minutes: number;
  };
  audio: { files: number; megabytes: number };
  /** What to enter in the Vobiz console; null until the public address is set. */
  urls: { inbound: string; answer: string; hangup: string } | null;
}

export interface ScriptPart {
  text: string;
  /** Holds a name, area, time or address: its audio is made for each call. */
  personal: boolean;
}

export interface ScriptStep {
  key: string;
  title: string;
  when: string;
  handoff: boolean;
  note: string | null;
  parts: ScriptPart[];
}

export interface VoiceScript {
  purpose: "dispatch" | "followup" | "feedback";
  sample: boolean;
  ticket: { id: string; title: string | null; category: string | null } | null;
  keys: { digit: string; outcome: string; label: string; handoff: boolean }[];
  steps: ScriptStep[];
}

/* ---------------------------------------------------------------- Competitive Pricing */
export interface CompetitorPriceItem {
  id: number;
  service: string;
  competitor: string;
  price: number;
  notes: string | null;
  updated_at: string | null;
}

export interface CompetitorPriceInput {
  service: string;
  competitor: string;
  price: number;
  notes?: string | null;
}

export type PricePosition = "cheaper" | "same" | "costlier" | "no_competitor" | "not_offered";

export interface PricingRow {
  service: string;
  category: string;
  works: number;
  our_price: number | null;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  last_booked_at: string | null;
  competitors: CompetitorPriceItem[];
  cheapest_competitor: string | null;
  cheapest_price: number | null;
  gap: number | null;
  gap_pct: number | null;
  position: PricePosition;
}

export interface PricingOverview {
  summary: {
    services: number;
    compared: number;
    cheaper: number;
    same: number;
    costlier: number;
    avg_gap_pct: number | null;
    competitors: string[];
    competitor_prices: number;
  };
  services: PricingRow[];
  source?: string;
  fetched_at?: number | string | null;
  note?: string | null;
}

/* ---------------------------------------------------------------- Pricing Agent */
// ---- Pricing agent ----

export interface PricingArea {
  id: number;
  city: string;
  area: string;
  pincode: string | null;
  active: boolean;
}

export interface PricingService {
  id: number;
  name: string;
  slug: string;
  scope: string;
  unit: string;
  keywords: string[];
  min_price: number | null;
  max_price: number | null;
  active: boolean;
}

export interface PricingCompetitor {
  id: number;
  name: string;
  website: string | null;
  notes: string | null;
  active: boolean;
}

export interface PricingStrategy {
  position_pct: number;
  demand_adjust_pct: number;
  sentiment_adjust_pct: number;
  demand_window_days: number;
  refresh_days: number;
}

export interface PricingRun {
  id: number;
  status: "running" | "done" | "failed";
  trigger: "manual" | "schedule";
  total_steps: number;
  done_steps: number;
  message: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PricingStatus {
  llm_configured: boolean;
  search_engine: "searxng" | "duckduckgo";
  page_reader: "crawl4ai" | "http";
  maps_enabled: boolean;
  scheduler_enabled: boolean;
  public_api_protected: boolean;
  running: PricingRun | null;
  last_run: PricingRun | null;
  next_run_due: string | null;
  counts: { areas: number; services: number; competitors: number; priced: number };
}

export interface PriceRecommendation {
  id: number;
  run_id: number;
  area_id: number;
  service_id: number;
  city: string;
  area: string;
  service: string;
  service_name: string;
  unit: string;
  status: "priced" | "no_data";
  price: number | null;
  currency: string;
  market_median: number | null;
  market_low: number | null;
  market_high: number | null;
  price_count: number;
  basis: "area" | "city";
  demand_level: "low" | "normal" | "high" | "unknown";
  demand_tasks: number;
  sentiment_level: "weak" | "neutral" | "strong" | "unknown";
  competitor_rating: number | null;
  confidence: "low" | "medium" | "high";
  adjustments: { reason: string; pct: number }[];
  reasoning: string;
  updated_at: string;
}

export interface PriceEvidence {
  competitor: string;
  listed: boolean;
  price_min: number;
  price_max: number | null;
  unit: string | null;
  source_url: string;
  source_title: string | null;
  evidence: string;
}

export interface CompetitorRating {
  competitor: string;
  rating: number | null;
  review_count: number | null;
  sentiment: number | null;
  summary: string | null;
  source: "google_maps" | "web";
  source_url: string | null;
}

export interface PriceRecommendationDetail extends PriceRecommendation {
  evidence: PriceEvidence[];
  ratings: CompetitorRating[];
}

export interface PricingReport {
  id: number;
  run_id: number;
  area_id: number;
  city: string;
  area: string;
  summary: string;
  updated_at: string;
}

// ---- Commercials (Calling Agent cost & usage) ---------------------------------------------------------

export interface CommercialRates {
  vobiz_per_min: number;
  vobiz_pulse_seconds: number;
  handoff_leg_per_min: number;
  sarvam_stt_per_hour: number;
  sarvam_tts_per_10k_chars: number;
  agent_tts_chars_per_min: number;
  llm_per_min: number;
  livekit_per_min: number;
  monthly_budget: number;
  automation_budget: number;
  bulk_budget: number;
}

export interface CommercialPurpose {
  purpose: string;
  calls: number;
  connected: number;
  billed_minutes: number;
  handoffs: number;
  wins: number;
  cost: number;
  cost_per_call: number;
  cost_per_win: number | null;
}

export interface CommercialPeriod {
  total_cost: number;
  calls: number;
  connected: number;
  connect_rate: number;
  test_calls: number;
  cost_per_call: number;
  cost_per_connected: number;
  cost_per_minute: number;
  ivr: {
    calls: number;
    bulk_calls: number;
    connected: number;
    talk_minutes: number;
    billed_minutes: number;
    avg_call_seconds: number;
    handoff_leg_cost: number;
    call_cost: number;
    cost: number;
  };
  sarvam: {
    handoffs: number;
    handoffs_connected: number;
    agent_minutes: number;
    avg_handoff_seconds: number;
    stt_cost: number;
    agent_tts_cost: number;
    ivr_tts_chars: number;
    ivr_tts_requests: number;
    ivr_tts_by_source: Record<string, number>;
    ivr_tts_cost: number;
    cost: number;
  };
  agent_infra: { llm_cost: number; livekit_cost: number; cost: number };
  breakdown: { key: string; label: string; group: "ivr" | "sarvam" | "infra"; cost: number }[];
  by_purpose: CommercialPurpose[];
}

export type CommercialPeriodKey = "today" | "week" | "month" | "all";

export interface CommercialBucket { ivr: number; sarvam: number; infra: number; calls: number }

export interface CommercialSummary {
  generated_at: string;
  currency: string;
  timezone: string;
  provider: string;
  stack: { telephony: string; ivr_voice: string; agent: string; handoff_enabled: boolean; tts_metered_since: string | null };
  periods: Record<CommercialPeriodKey, CommercialPeriod>;
  previous: Record<Exclude<CommercialPeriodKey, "all">, number>;
  daily: (CommercialBucket & { date: string })[];
  monthly: (CommercialBucket & { month: string })[];
  projection: {
    month_to_date: number;
    projected_month: number;
    budget: number;
    budget_used_pct: number | null;
    projected_budget_pct: number | null;
    days_elapsed: number;
    days_in_month: number;
  };
  rates: CommercialRates;
  rates_customized: boolean;
  source?: "all" | "automation" | "bulk";
}

export interface CallingBulkCampaign {
  id: number;
  title: string;
  script: string;
  language: string;
  status: string;
  total_contacts: number;
  completed_calls: number;
  failed_calls: number;
  duration_seconds: number;
  billed_minutes: number;
  cost: number;
  connect_rate: number;
  cost_per_contact: number;
  cost_per_connected: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CallingBulkSummary extends CommercialSummary {
  campaigns: CallingBulkCampaign[];
}

// ---- WhatsApp commercials (Automation & Bulk) ----------------------------------------------------------

export type WaCategory = "marketing" | "utility" | "authentication" | "service";

export interface WaTaskAlertTemplate {
  name: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "NOT_FOUND" | "UNKNOWN" | string;
  category: string;
  language: string;
  rejected_reason: string | null;
  /** what new-task alerts use right now: the template once approved, else the plain-text fallback */
  in_use: "template" | "text";
  body: string;
  footer: string;
  button: { text: string; url: string } | null;
  variables: { n: string; label: string; example: string }[];
  sample: { filled_body: string; task_url: string; from_real_task: boolean };
  fallback_text: string;
  today: { template: number; text: number; failed: number };
  error: string | null;
}

export interface WaFeedbackRatings {
  work: number | null;
  behaviour: number | null;
  on_time: number | null;
}

export interface WaFeedbackOverview {
  active: boolean;
  since: string | null;
  quiet_hours: CallingHours;
  setup: {
    flow: { id: string | null; status: string; error?: string };
    template: { status: string; category?: string; rejected_reason?: string | null; error?: string };
    ready: boolean;
  };
  /** last time any Meta webhook reached the app; answers only arrive through it */
  webhook_last_seen: string | null;
  counts: { sent: number; answered: number; failed: number; no_phone: number; skipped: number; sending: number; asked: number; low: number };
  response_rate: number;
  averages: WaFeedbackRatings & { overall: number | null };
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  template: { name: string; body: string; button: string };
  form: { questions: { key: keyof WaFeedbackRatings; label: string; options: string[] }[]; comment_label: string };
}

export type FbWhen = "today" | "previous" | "upcoming";
export type FbTaskState = "completed" | "in_progress" | "open" | "cancelled";
export type FbFeedbackFilter = "all" | "replied" | "best" | "good" | "worst" | "awaiting" | "not_asked";

/** The customer's reply exactly as received from WhatsApp */
export interface FbReply {
  /** form = submitted the feedback form; text = typed a message (stars then guessed from the text) */
  via: "form" | "text" | "unknown" | null;
  stars_guessed: boolean;
  message_id: string | null;
  /** true only for a real Meta message id; test webhooks and unknown sources are false */
  verified: boolean;
  source: "whatsapp" | "test" | "unknown";
  answer: { key: string; label: string; stars: number | null; picked: string }[] | null;
  concerns: string | null;
  /** the raw values Meta delivered (form fields, or {type: "text", text}) */
  raw: Record<string, string> | null;
  /** other WhatsApp messages the customer sent after getting the form */
  messages: { at: string | null; kind: string; text: string | null; message_id: string | null; verified: boolean }[];
}

export interface FbCommercialsPeriod {
  best: number;
  good: number;
  worst: number;
  avg_rating: number | null;
  with_concerns: number;
  not_charged: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replies: number;
  low: number;
  cost: number;
  cost_per_message: number;
  cost_per_reply: number | null;
  delivery_rate: number;
  read_rate: number;
  reply_rate: number;
}

export interface FbCommercials {
  periods: Record<"today" | "week" | "month" | "all", FbCommercialsPeriod>;
  daily: { date: string; sent: number; replies: number; cost: number }[];
  rate_utility: number;
  rate_marketing: number;
  category: string;
}

export interface FbTaskFeedback {
  reply?: FbReply | null;
  status: "sending" | "sent" | "answered" | "failed" | "no_phone" | "skipped";
  error: string | null;
  ratings: WaFeedbackRatings;
  average: number | null;
  low: boolean;
  comment: string | null;
  sent_at: string | null;
  answered_at: string | null;
}

export interface FbTask {
  id: string;
  title: string | null;
  category: string | null;
  city: string | null;
  address: string | null;
  scheduled_at: string | null;
  status: string | null;
  state: FbTaskState;
  budget: number | null;
  customer: { name: string | null; phone: string | null; email: string | null };
  helper: { name: string | null; phone: string | null } | null;
  feedback: FbTaskFeedback | null;
}

export interface FbTasksPage {
  counts: Record<FbWhen, number>;
  states: Record<FbTaskState | "all", number>;
  /** feedback state of the tasks in this view: replied / awaiting reply / completed but not asked */
  feedback: Record<FbFeedbackFilter, number>;
  /** the period's feedback numbers (all its tasks, before filters) */
  funnel?: { completed: number; sent: number; received: number; pending: number; not_asked: number; failed: number; reply_rate: number };
  total: number;
  offset: number;
  limit: number;
  items: FbTask[];
}

export interface FbTemplateExample {
  from_real_task: boolean;
  task: { id: string; title: string | null; scheduled_at: string | null } | null;
  values: { n: string; label: string; example: string }[];
  filled_body: string;
  raw_body: string;
  footer: string;
  button: string;
}

export type WaFeedbackTab = "all" | "awaiting" | "received" | "low" | "commented" | "five_star" | "not_sent" | "skipped";

export interface WaFeedbackItem {
  reply?: FbReply | null;
  id: number;
  ticket_id: string;
  task_title: string | null;
  category: string | null;
  city: string | null;
  scheduled_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  helper_name: string | null;
  status: "sending" | "sent" | "answered" | "failed" | "no_phone" | "skipped";
  error: string | null;
  ratings: WaFeedbackRatings;
  average: number | null;
  low: boolean;
  comment: string | null;
  created_at: string | null;
  sent_at: string | null;
  answered_at: string | null;
}

export interface WaFeedbackPage {
  counts: Record<WaFeedbackTab, number>;
  total: number;
  offset: number;
  limit: number;
  items: WaFeedbackItem[];
}

export type WaAudience = "helper" | "customer";

export interface WaWelcomerState {
  active: boolean;
  /** UTC ISO time the welcomer was activated; only people who register after it are welcomed */
  since: string | null;
  template: string;
  total: number;
  today: number;
  failed: number;
  /** UTC ISO time the worker last looked for new registrations (null until the first check) */
  last_check?: string | null;
  check_every_seconds?: number;
}

export type WaWelcomeOutcome = "welcomed" | "delivered" | "read" | "failed" | "welcomer_off" | "no_phone" | "pending";

export interface WaWelcomerPerson {
  user_id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  registered_at: string | null;
  status: WaWelcomeOutcome;
  welcomed_at: string | null;
  error: string | null;
  /** welcomed, then deleted on ExtraHand or marked as a test account: still counted, as the message was sent and paid */
  removed?: boolean;
  /** why: "Deleted their account", "Marked as a test account", ... (from ExtraHand now) */
  removed_reason?: string | null;
  /** the name on ExtraHand now (e.g. "Account Deleted", "Test User") */
  now_name?: string | null;
}

export interface WaWelcomerPeople {
  counts: Record<WaWelcomeOutcome | "all" | "sent", number>;
  total: number;
  offset: number;
  limit: number;
  items: WaWelcomerPerson[];
  fetched_at: string | null;
}

export interface WaTemplateVersion {
  language: string;
  language_name: string;
  /** Meta review status: APPROVED | PENDING | REJECTED | PAUSED | DISABLED */
  status: string;
  category: string | null;
  rejected_reason: string | null;
  body: string;
  button: string | null;
  has_image: boolean;
}

export interface WaWelcomerDetail extends WaWelcomerState {
  audience: WaAudience;
  /** Text people get today (Telugu once Meta approves it, English until then) */
  template_text: string;
  template_versions?: WaTemplateVersion[];
  /** Language that is sent now; null when no version is approved */
  sending_language?: string | null;
  sending_language_name?: string | null;
  telugu_draft?: string;
  telugu_button?: string;
  recent: {
    id: number;
    user_id: string;
    name: string | null;
    phone: string | null;
    registered_at: string | null;
    sent_at: string | null;
    status: string;
    error: string | null;
  }[];
}

export interface WaWelcomerDay {
  registered: number;
  with_phone: number;
  welcomed: number;
  delivered: number;
  read: number;
  failed: number;
  no_phone: number;
  /** registered while the welcomer was deactive (or before it was activated) */
  welcomer_off: number;
  /** waiting for the next check */
  pending: number;
}

export interface WaWelcomerHistory {
  audience: WaAudience;
  periods: Record<"today" | "week" | "month" | "last30", WaWelcomerDay>;
  daily: (WaWelcomerDay & { date: string })[];
  fetched_at: string | null;
  error: string | null;
}

export interface WaWelcomerFigures {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  simulated: number;
  cost: number;
  cost_per_welcome: number;
  delivery_rate: number;
  read_rate: number;
}

export interface WaWelcomerCommercials {
  periods: Record<"today" | "week" | "month" | "all", { total: WaWelcomerFigures; helper: WaWelcomerFigures; customer: WaWelcomerFigures }>;
  daily: { date: string; helper: number; customer: number; cost: number }[];
  rate_marketing: number;
}

export type WaMsgCategoryTab = "all" | "utility" | "marketing" | "other";

export interface WaSentMessage {
  id: number;
  created_at: string | null;
  phone: string | null;
  source: string;
  purpose: string;
  kind: string;
  template: string | null;
  body: string | null;
  category: string;
  /** meta = Meta's billing report; template = the template's approved category; estimated = rate card by source */
  category_origin: "meta" | "template" | "estimated";
  status: string;
  error: string | null;
  billable: boolean | null;
  ticket_id: string | null;
  campaign_id: number | null;
  delivered_at: string | null;
  read_at: string | null;
}

export interface WaSentMessagesPage {
  counts: Record<WaMsgCategoryTab, number>;
  /** per tab: ok = sent / delivered / read, failed = refused by Meta, unsent = test mode (never left) */
  outcomes?: Record<WaMsgCategoryTab, { ok: number; failed: number; unsent: number }>;
  total: number;
  offset: number;
  limit: number;
  items: WaSentMessage[];
}

export interface WaRates {
  marketing: number;
  utility: number;
  authentication: number;
  service: number;
  automation_category: WaCategory;
  bulk_category: WaCategory;
  automation_budget: number;
  bulk_budget: number;
}

export interface WaPeriod {
  attempted: number;
  simulated: number;
  accepted: number;
  api_failed: number;
  delivery_failed: number;
  failed: number;
  delivered: number;
  read: number;
  awaiting_report: number;
  recipients: number;
  replied: number;
  delivery_rate: number;
  read_rate: number;
  reply_rate: number;
  cost: number;
  measured_cost: number;
  estimated_cost: number;
  billable: number;
  free: number;
  cost_per_delivered: number;
  cost_per_read: number;
  categories: { category: string; messages: number; cost: number }[];
  texts: number;
  templates: number;
  texts_outside_window: number;
  template_equivalent_cost: number;
  template_category: WaCategory;
  failure_reasons: { reason: string; count: number }[];
}

export type WaPeriodKey = "today" | "week" | "month" | "all";

export interface WaReport {
  generated_at: string;
  source: "automation" | "bulk";
  periods: Record<WaPeriodKey, WaPeriod>;
  previous_cost: Record<Exclude<WaPeriodKey, "all">, number>;
  previous_sent: Record<Exclude<WaPeriodKey, "all">, number>;
  daily: { date: string; sent: number; delivered: number; read: number; failed: number; cost: number }[];
  budget: { budget: number; month_to_date: number; projected: number; days_elapsed: number; days_in_month: number };
  rates: WaRates;
  rates_customized: boolean;
  ledger_since: string | null;
}

export interface WaAutomationReport extends WaReport {
  outcomes: Record<WaPeriodKey, {
    purposes: { purpose: string; sent: number; delivered: number; read: number; failed: number; cost: number; delivery_rate: number }[];
    tickets: number;
    messages_per_ticket: number;
    cost_per_ticket: number;
    jobs_accepted: number;
    cost_per_acceptance: number;
  }>;
}

export interface WaCampaign {
  id: number;
  created_at: string;
  message_preview: string | null;
  total: number;
  sent: number;
  simulated: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
  cost: number;
  estimated: boolean;
  delivery_rate: number;
  read_rate: number;
  cost_per_read: number;
  template_equivalent_cost: number;
}

export interface WaBulkReport extends WaReport {
  campaigns: WaCampaign[];
}

/* ---------------------------------------------------------------- Advertisement Commercials */

export type AdOperation = "scan" | "research" | "brief" | "draw" | "check";
export type AdPeriodKey = "today" | "week" | "month" | "all";

export interface AdRates {
  usd_to_inr: number;
  text_in_per_m: number;
  text_out_per_m: number;
  vision_in_per_m: number;
  vision_out_per_m: number;
  image_usd: number;
  monthly_budget: number;
}

export interface AdOpStat { cost: number; requests: number; failed: number }

export interface AdPeriod {
  cost: number;
  requests: number;
  failed: number;
  tokens_in: number;
  tokens_out: number;
  images: number;
  posters: number;
  scans: number;
  cost_per_poster: number | null;
  reported_share: number;
  by_operation: Record<AdOperation, AdOpStat>;
}

export interface AdJob {
  job_id: string;
  kind: "poster" | "scan" | "research" | string;
  title: string;
  event_id: string;
  started: string;
  seconds: number;
  cost: number;
  draws: number;
  tokens: number;
  ok: boolean;
  steps: Partial<Record<AdOperation, AdOpStat>>;
  poster_url: string;
  city: string;
  date: string;
}

export interface AdModelLine {
  model: string;
  operations: AdOperation[];
  requests: number;
  failed: number;
  tokens_in: number;
  tokens_out: number;
  images: number;
  cost_usd: number;
  cost_inr: number;
  reported: number;
  avg_latency_ms: number;
}

export interface AdCommercialReport {
  generated_at: string;
  rates: AdRates;
  rates_customized: boolean;
  periods: Record<AdPeriodKey, AdPeriod>;
  previous: Record<AdPeriodKey, number | null>;
  daily: ({ date: string; total: number } & Record<AdOperation, number>)[];
  unit: {
    per_poster: number;
    per_scan: number;
    draws_per_poster: number;
    first_try_rate: number;
    recipe: Record<"research" | "brief" | "draw" | "check", number>;
    recipe_source: "measured" | "estimate";
    typical: Record<"research" | "brief" | "draw" | "check", number>;
    posters_measured: number;
    scans_measured: number;
  };
  models: AdModelLine[];
  recent: AdJob[];
  budget: { monthly: number; spent: number; projected: number };
  pipeline: { upcoming_without_poster: number; projected_cost: number };
  festivals: AdFestivalLedger;
}

export interface AdFestival {
  id: string;
  title: string;
  city: string;
  date: string;
  days: number | null;
  status: string;
  source: string;
  poster_url: string;
  versions: number;
  measured_cost: number;
  estimated_cost: number;
  cost: number;
  unmetered: number;
}

export interface AdFestivalLedger {
  found: number;
  approved: number;
  pending: number;
  rejected: number;
  with_poster: number;
  versions: number;
  scans_run: number;
  by_status: Record<string, number>;
  before_metering: { posters: number; scans: number; cost: number };
  soon_pending: AdFestival[];
  past_pending: AdFestival[];
  items: AdFestival[];
}

/* ---------------------------------------------------------------- User Engagement regions */

export interface RegionCounts {
  name: string;
  customers: number;
  helpers: number;
  new_customers: number;
  new_helpers: number;
  /** booked a Work (customers) or were given one (helpers) in the last 30 days */
  active_customers?: number;
  active_helpers?: number;
}

export interface RegionState extends RegionCounts {
  kind: "state" | "other";
  city_count: number;
  cities: RegionCounts[];
}

export interface EngagementRegions {
  loading?: boolean;
  fetched_at?: string;
  totals?: { states: number; cities: number; customers: number; helpers: number; customers_placed: number; helpers_placed: number;
    active_customers?: number; active_helpers?: number };
  active_days?: number;
  active_known?: boolean;
  states?: RegionState[];
}

/* ------------------------------------------------------------------ Task-Seeding Agent (Advertisement) */

export interface SeedConfig {
  enabled: boolean;
  since: string | null;
  delay_hours: number;
  whatsapp: boolean;
  call: boolean;
  call_after_hours: number;
  festival_campaigns: boolean;
  seasonal_campaigns: boolean;
  festival_window_days: number;
}

export interface SeedKpis {
  days: number;
  registrations: number | null;
  not_booked: number | null;
  registrations_error: string | null;
  messages_sent: number;
  messages_delivered: number;
  messages_read: number;
  calls_made: number;
  calls_answered: number;
  link_clicks: number;
  people_clicked: number;
  first_bookings: number;
  conversion_rate: number;
  contacted: number;
  failures: number;
  skipped: number;
  opted_out: number;
  waiting: number;
}

export interface SeedTemplateVersion {
  language: string;
  language_name: string;
  status: string;
  category: string | null;
  rejected_reason: string | null;
  body: string;
  button: string | null;
  button_url?: string | null;
}

export interface SeedFestival {
  id: string;
  title: string;
  region: string;
  date_start: string;
  date_end: string;
  status: string;
  discount_code: string;
  service: string | null;
  service_name: string | null;
  in_window: boolean;
}

export interface SeedStatus {
  config: SeedConfig;
  kpis: SeedKpis;
  template: {
    name: string;
    versions: SeedTemplateVersion[];
    drafts: { language: string; language_name: string; body: string; footer: string; button: string }[];
    any_approved: boolean;
    clicks_tracked: boolean | null;
    link_base: string | null;
  };
  call: { ready: boolean; reason: string | null; calls_stopped: boolean; hours: string; hours_open: boolean };
  festivals: SeedFestival[];
  season: { season: string; service: string };
  services: { key: string; name: string; family: string }[];
  last_run: string | null;
  last_result: Record<string, unknown> | null;
  blocked: string | null;
  check_every_seconds: number;
}

export type SeedContactStatus =
  | "pending" | "sending" | "messaged" | "called" | "failed" | "skipped" | "opted_out" | "converted";

export interface SeedContact {
  id: number;
  user_id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  registered_at: string | null;
  contacted_at: string | null;
  language: string | null;
  language_name: string | null;
  service: string | null;
  service_name: string | null;
  reason: "festival" | "summer" | "regular" | null;
  reason_text: string | null;
  event_title: string | null;
  promo_code: string | null;
  status: SeedContactStatus;
  skip_reason: string | null;
  wa_status: string | null;
  wa_language: string | null;
  wa_error: string | null;
  wa_attempts: number;
  wa_sent_at: string | null;
  call_status: string | null;
  call_error: string | null;
  call_at: string | null;
  call_duration: number | null;
  clicks: number;
  first_click_at: string | null;
  converted_at: string | null;
  converted_ticket_id: string | null;
  converted_category: string | null;
}

export interface SeedContactsPage {
  counts: Record<string, number>;
  total: number;
  offset: number;
  limit: number;
  items: SeedContact[];
}

export interface SeedFestivalDay {
  id: string;
  title: string;
  region: string;
  /** An All-India festival shown in a city calendar: read-only there (its message is set in the All-India calendar). */
  inherited?: boolean;
  date_start: string;
  date_end: string;
  status: string;
  category: string;
  discount_code: string;
  promo_code: string;
  suggested_service: string | null;
  service: string | null;
  /** every service in this festival's message */
  services: string[];
  enabled: boolean;
  customised: boolean;
  hooks: Record<"te" | "hi" | "en", string>;
  sends_from: string;
  sends_until: string;
  custom_dates?: boolean;
  sending_now: boolean;
  past: boolean;
}

export interface SeedFestivalCalendar {
  year: number;
  month: number;
  /** The region asked for (null = every festival) */
  region?: string | null;
  today: string;
  window_days: number;
  festival_campaigns: boolean;
  services: SeedService[];
  /** real ExtraHand booking categories, for adding a service */
  categories: { slug: string; label: string; bookings: number }[];
  template: Record<"te" | "hi" | "en", { body: string; footer: string; button: string }>;
  festivals: SeedFestivalDay[];
}

export interface SeedService {
  key: string;
  name: string;
  te: string;
  hi: string;
  custom: boolean;
  category: string;
}

export interface SeedTemplateLanguage {
  language: "te" | "hi" | "en";
  language_name: string;
  body: string;
  footer: string;
  button: string;
  /** wording changed here from the built-in one */
  edited: boolean;
  default: { body: string; footer: string; button: string };
  /** NOT_SUBMITTED | PENDING | APPROVED | REJECTED | PAUSED | DISABLED; changed = the wording here differs from Meta's */
  meta: { status: string; rejected_reason: string | null; changed: boolean };
}

export interface SeedTemplateView {
  name: string;
  languages: SeedTemplateLanguage[];
  clicks_tracked: boolean | null;
}

/** Welcomer Dashboard: registrations (ExtraHand) and welcome messages, per audience */
export interface WaWelcomerDashPeriod { registered: number; sent: number; delivered: number; read: number; failed: number }
export interface WaWelcomerDashAudience {
  active: boolean;
  since: string | null;
  template: string;
  periods: Record<"today" | "week" | "month" | "last30", WaWelcomerDashPeriod>;
  funnel: { registered: number; with_phone: number; welcomed: number; delivered: number; read: number };
  outcomes: { read: number; delivered: number; welcomed: number; failed: number; no_phone: number; welcomer_off: number; pending: number };
  sent_all_time: number;
  coverage: number | null;
  read_rate: number | null;
}
export interface WaWelcomerDashboard {
  audiences: { helper: WaWelcomerDashAudience; customer: WaWelcomerDashAudience };
  daily: { date: string; helper_registered: number; customer_registered: number; helper_sent: number; customer_sent: number;
    helper_read: number; customer_read: number }[];
  top_cities: { city: string; registered: number }[];
  hours: number[];
  last_check: string | null;
  fetched_at: string | null;
  errors: string[];
}

/* ------------------------------------------------------------------ User Engagement: cancelled Works */

/** Who cancelled: the customer, the ExtraHand team, or not recorded by ExtraHand (older Works). */
export type CancelSide = "customer" | "team" | "unknown";

export interface CancelledWork {
  id: string;
  title: string;
  category: string;
  customer_name: string;
  customer_phone: string;
  customer_key: string;
  city: string;
  area: string;
  booked_at: string | null;
  scheduled_at: string | null;
  scheduled_slot: string;
  /** null when ExtraHand did not record when it was cancelled */
  cancelled_at: string | null;
  reason: string | null;
  side: CancelSide;
  side_note: string;
  helper_name: string;
  amount: number;
  payment_type: string;
  refunded: boolean;
  refunded_at: string | null;
  /** total refunded for this Work (refunds API); null when not refunded */
  refund_amount: number | null;
  booking_source: string;
}

/** The numbers on the Cancelled Works cards, computed by the backend for the page's filters */
export interface CancelledWorksSummary {
  loading?: boolean;
  fetched_at?: string;
  cancelled: { count: number; value: number; rate: number | null };
  refunded: { count: number; share: number; returned: number; paid: number };
  not_refunded: { count: number; share: number; value: number; paid_bookings: number };
  completed: { count: number; received: number; average: number | null };
}

export interface CancelledWorks {
  /** real-customer Works that were completed (for the Completed / Money received cards): when, amount paid, city, service */
  completed?: { id: string; when: string | null; amount: number; city: string; category: string }[];
  loading?: boolean;
  fetched_at?: string;
  total?: number;
  by_side?: Record<CancelSide, number>;
  rows?: CancelledWork[];
}

/* ------------------------------------------------------------------ User Engagement: refunded Works */

/** Who started the refund: the customer cancelled, an admin refunded, or the helper cancelled. */
export type RefundStarter = "customer" | "admin" | "helper" | "unknown";

export interface RefundRow {
  id: string;
  refund_id: string;
  razorpay_refund_id: string;
  payment_id: string;
  task_id: string;
  requested_at: string | null;
  completed_at: string | null;
  /** completed | processing | failed ... */
  status: string;
  /** razorpay = money sent back through Razorpay; recorded = written in ExtraHand only */
  method: "razorpay" | "recorded";
  amount: number;
  /** what the customer paid (escrow), when known */
  paid: number | null;
  full: boolean;
  fee_kept: number | null;
  to_platform: number | null;
  to_helper: number | null;
  reason: string | null;
  started_by: RefundStarter;
  cancelled_at: string | null;
  hours_to_refund: number | null;
  title: string;
  category: string;
  work_status: string;
  customer_name: string;
  customer_phone: string;
  customer_key: string;
  city: string;
  area: string;
  booked_at: string | null;
  scheduled_at: string | null;
  scheduled_slot: string;
  helper_name: string;
  booking_source: string;
}

export interface RefundedWorks {
  loading?: boolean;
  fetched_at?: string;
  total?: number;
  amount?: number;
  left_out?: { team_or_test: number; work_missing: number; not_read_yet: number };
  work_missing_amount?: number;
  rows?: RefundRow[];
}

/* ------------------------------------------------------------------ Customer Engagement: cancellation follow-up */

export interface WaCancelFollowupRow {
  id: number;
  task_id: string;
  is_test: boolean;
  customer_name: string | null;
  customer_phone: string | null;
  task_title: string | null;
  category: string | null;
  city: string | null;
  cancelled_at: string | null;
  /** the reason recorded on ExtraHand when they cancelled */
  cancel_reason: string | null;
  /** sending | sent | failed | no_phone | skipped_repeat | answered */
  status: string;
  /** Meta's delivery report: sent | delivered | read | failed */
  delivery: string | null;
  error: string | null;
  sent_at: string | null;
  answered_at: string | null;
  answer_reason: string | null;
  answer_reason_label: string | null;
  answer_note: string | null;
  created_at: string | null;
}

export interface WaCancelFollowupSetup {
  flow: { id: string | null; status: string; error?: string; validation_errors?: unknown[] };
  template: { status: string; category?: string; language?: string; id?: string; rejected_reason?: string | null; error?: string };
  ready: boolean;
  /** when Meta was asked (India time shown on the page) */
  checked_at?: string;
}

export interface WaCancelFollowupOverview {
  active: boolean;
  since: string | null;
  setup: WaCancelFollowupSetup;
  template: { name: string; body: string; footer: string; button: string };
  form: {
    title: string; question: string; question_te: string; select: string; select_te: string;
    note: string; note_te: string; submit: string;
    reasons: { id: string; en: string; te: string }[];
  };
  rules: { max_age_days: number; repeat_gap_days: number; check_every_seconds: number };
  quiet_hours: { open: boolean | null; window: string | null; next_open: string | null };
  last_check: string | null;
  stats: WaCancelFollowupStats;
  recent: WaCancelFollowupRow[];
}

export interface WaCancelFollowupStats {
  sent: number; delivered: number; read: number; answered: number; waiting: number;
  answer_rate: number | null; read_rate: number | null; with_note: number;
  failed: number; no_phone: number; skipped_repeat: number;
  /** test sends (Test mode), counted in the numbers above only when tests are included */
  tests: number;
  reasons: { id: string; label: string; count: number }[];
}

/** Message Status & Reviews: every follow-up (our records only, refreshed often) */
export interface WaCancelFollowupMessages {
  active: boolean;
  since: string | null;
  last_check: string | null;
  stats: WaCancelFollowupStats;
  rows: WaCancelFollowupRow[];
  /** when Meta's webhook (delivery reports, read receipts, replies) last reached this backend */
  webhook_last_seen: string | null;
}

/** Customer Replies: one conversation per follow-up — the form answer and anything the customer typed back */
export interface WaCancelReplyConversation extends WaCancelFollowupRow {
  texts: { id: number; at: string | null; text: string; kind: string }[];
  replied: boolean;
  last_activity: string | null;
}
export interface WaCancelReplies {
  counts: { all: number; replied: number; form: number; typed: number; no_reply: number };
  reply_window_days: number;
  conversations: WaCancelReplyConversation[];
  /** customers who cancelled but were not messaged: failed, no phone, already messaged this week */
  not_sent?: WaCancelFollowupRow[];
  /** every follow-up send with its cost (INR): Meta's pricing report when it arrived, else the category rate */
  costs: { items: { at: string | null; cost: number; category: string; status: string; test: boolean; reported: boolean }[];
    rates: { utility: number; marketing: number } };
  webhook_last_seen: string | null;
}

/* ------------------------------------------------------------------ WhatsApp Support (AI customer support agent) */
export type WsLang = "te" | "hi" | "en" | "te-latn" | "hi-latn";
export interface WsHealth {
  ai_configured: boolean; ai_model: string; whatsapp_configured: boolean; whatsapp_simulated: boolean;
  signature_check: boolean; extrahand_live: boolean; webhook_last_seen: string | null;
}
export interface WsSettings {
  active: boolean; test_mode: boolean; test_numbers: string[]; notify_care: boolean; health: WsHealth;
}
export interface WsPeriod {
  conversations: number; customers: number; messages_in: number; ai_replies: number; team_replies: number;
  solved_by_ai: number; handed_to_team: number; cases: number; ai_share: number | null; ai_cost_usd: number; failed_sends: number;
}
export interface WsCount { key: string; label: string; count: number }
export interface WsOverview {
  periods: Record<"today" | "week" | "month" | "all", WsPeriod>;
  languages: WsCount[]; intents: WsCount[]; case_categories: WsCount[];
  avg_ai_ms: number | null;
  open_now: { with_team: number; waiting_yes: number; open_cases: number };
  days: { day: string; messages: number; cases: number }[];
  health: WsHealth; settings: Omit<WsSettings, "health">;
}
export interface WsConversation {
  id: number; phone: string; is_test: boolean; customer_name: string | null; customer_id: string | null;
  language: WsLang | null; language_label: string | null; mode: "ai" | "human"; status: "open" | "closed";
  assigned_to: string | null; last_intent: string | null; last_intent_label: string | null; escalation_id: number | null;
  waiting_yes: boolean; last_message_at: string | null; created_at: string | null;
  last_message: { text: string; sender: string; at: string | null } | null; messages_since_reply: number;
}
export interface WsMessage {
  id: number; direction: "in" | "out"; sender: "customer" | "ai" | "human" | "system"; text: string; status: string | null;
  language: string | null; intent: string | null; intent_label: string | null; action: string | null; error: string | null;
  author: string | null; llm_ms: number | null; llm_cost: number | null; created_at: string | null;
}
export interface WsBooking {
  booking_id: string; booking_ref?: string; service?: string; category?: string; status?: string; booked_on?: string;
  scheduled_date?: string; scheduled_time?: string; amount_rupees?: number; payment_type?: string; payment_status?: string;
  helper_assigned?: boolean; helper_name?: string; area?: string; city?: string; cancelled_on?: string;
  cancellation_reason?: string; refund?: { refunded: boolean; amount_rupees?: number; refunded_on?: string; note?: string };
}
export interface WsCaseLite {
  id: number; category: string | null; category_label: string; status: "open" | "in_progress" | "resolved";
  outcome: string | null; booking_id: string | null; assigned_to: string | null; created_at: string | null;
}
export interface WsConversationDetail extends WsConversation {
  messages: WsMessage[]; cases: WsCaseLite[]; window_open: boolean;
  customer: { found: boolean; customer: { name?: string; email?: string; city?: string; member_since?: string } | null;
    bookings: WsBooking[]; total_bookings: number; as_of: string; error: string | null };
}
export interface WsCase extends WsCaseLite {
  customer_name: string | null; customer_phone: string | null; details: string | null; notes: string | null;
  conversation_id: number | null; is_test: boolean; resolved_at: string | null;
}
export interface WsTestReply {
  reply?: string; language?: string; intent?: string; action?: string; case_id?: number | null; used_ai?: boolean;
  llm_ms?: number | null; error?: string | null; skipped?: string; conversation_id?: number;
}
