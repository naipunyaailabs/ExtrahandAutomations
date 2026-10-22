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
  purpose: "dispatch" | "followup";
  run_id: number | null;
  followup_id: number | null;
  helper_id: string | null;
  helper_name: string | null;
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
}

export interface AppConfig {
  extrahand_mode: "mock" | "live";
  telephony_provider: "simulator" | "twilio";
  assignment_enabled: boolean;
  matching_api_configured: boolean;
  ivr_max_prompts: number;
  sync_interval_seconds: number;
  runtime: RuntimeSettings;
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
