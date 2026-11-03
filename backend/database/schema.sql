-- =============================================================================
-- ExtraHand Intelligence Platform: Helper Dispatch Database Schema
-- Database: PostgreSQL (Database name: INT)
-- Description: DDL scripts for all tables, indexes, and foreign keys.
-- =============================================================================

-- 1. APP SETTINGS TABLE
-- Stores runtime dynamic configuration overrides (e.g., followup reminder offsets, auto-dispatch)
CREATE TABLE IF NOT EXISTS public.app_settings (
    key VARCHAR(80) PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. CUSTOMERS TABLE
-- Stores customer profiles retrieved from ExtraHand (GET /users/{customerId})
CREATE TABLE IF NOT EXISTS public.customers (
    id VARCHAR(64) PRIMARY KEY,             -- Firebase UID or MongoDB ObjectId
    name VARCHAR(200),                      -- Customer full name
    phone VARCHAR(32),                      -- Primary contact number
    alt_phone VARCHAR(32),                  -- Alternate phone number
    email VARCHAR(200),                     -- Email address
    raw JSON,                               -- Original ExtraHand customer payload
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- 3. HELPERS TABLE
-- Stores service partners and taskers retrieved from ExtraHand (GET /users?role=partner)
CREATE TABLE IF NOT EXISTS public.helpers (
    id VARCHAR(64) PRIMARY KEY,             -- Helper UID
    profile_id VARCHAR(64),                 -- Helper Profile / Document ObjectId
    name VARCHAR(200),                      -- Helper full name
    phone VARCHAR(32),                      -- Primary phone number
    alt_phone VARCHAR(32),                  -- Secondary contact number
    email VARCHAR(200),                     -- Email address
    skills JSON,                            -- Specialized skills list (e.g. ["Deep Cleaning", "Wiring"])
    categories JSON,                        -- Service categories list (e.g. ["Cleaning", "Electrical"])
    work_areas JSON,                        -- Supported local operational zones (e.g. ["Madhapur", "Gachibowli"])
    address VARCHAR(500),                   -- Physical address or locality
    city VARCHAR(100),                      -- Primary operational city
    state VARCHAR(100),                     -- State or region
    pincode VARCHAR(20),                    -- Postal PIN code
    lat DOUBLE PRECISION,                   -- GPS latitude
    lng DOUBLE PRECISION,                   -- GPS longitude
    status VARCHAR(50) DEFAULT 'active',    -- Account status ('active', etc.)
    is_active BOOLEAN DEFAULT TRUE,         -- Whether helper account is active
    is_verified BOOLEAN DEFAULT FALSE,      -- Aadhaar / KYC verification status
    can_accept_tasks BOOLEAN DEFAULT TRUE,  -- Whether helper is marked ready for dispatch calls
    work_shift_type VARCHAR(50),            -- Work shift ('full_time', 'part_time')
    raw JSON,                               -- Raw ExtraHand partnerProfile object
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS ix_helpers_city ON public.helpers(city);
CREATE INDEX IF NOT EXISTS ix_helpers_name ON public.helpers(name);

-- 4. TICKETS TABLE
-- Stores work bookings pulled from ExtraHand (GET /tasks?postedBy=team)
CREATE TABLE IF NOT EXISTS public.tickets (
    id VARCHAR(64) PRIMARY KEY,             -- ExtraHand Task ID
    title VARCHAR(300),                     -- Work title / summary
    description TEXT,                       -- Detailed task scope
    category VARCHAR(120),                  -- Work category (e.g., Cleaning, Plumbing, Electrical)
    status VARCHAR(50),                     -- Original ExtraHand status (open, assigned, completed, etc.)
    budget DOUBLE PRECISION,                -- Offered payout amount (INR)
    address VARCHAR(500),                   -- Service location address
    city VARCHAR(100),                      -- City
    lat DOUBLE PRECISION,                   -- Location latitude
    lng DOUBLE PRECISION,                   -- Location longitude
    scheduled_at TIMESTAMP WITHOUT TIME ZONE, -- Scheduled start date and time
    booking_source VARCHAR(60),             -- Booking source ('team', etc.)

    -- Customer details
    customer_id VARCHAR(64),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(32),
    customer_email VARCHAR(200),

    -- Assigned helper details
    assignee_id VARCHAR(64),
    assignee_profile_id VARCHAR(64),
    assignee_name VARCHAR(200),
    assignee_phone VARCHAR(32),
    assignment_local_only BOOLEAN NOT NULL DEFAULT FALSE,
    ignored_remote_assignee_id VARCHAR(64),

    -- Internal dispatch lifecycle
    -- 'new' -> 'dispatching' -> 'assigned' -> 'escalated' -> 'closed'
    dispatch_status VARCHAR(30) NOT NULL DEFAULT 'new',
    remote_updated_at VARCHAR(64),
    raw JSON,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    synced_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_tickets_dispatch_status ON public.tickets(dispatch_status);
CREATE INDEX IF NOT EXISTS ix_tickets_scheduled_at ON public.tickets(scheduled_at);
CREATE INDEX IF NOT EXISTS ix_tickets_assignee_id ON public.tickets(assignee_id);

-- 5. DISPATCH RUNS TABLE
-- Tracks candidate helper calling passes for an unassigned ticket
CREATE TABLE IF NOT EXISTS public.dispatch_runs (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running', 'accepted', 'escalated', 'cancelled'
    candidates JSON NOT NULL DEFAULT '[]'::json,    -- Ordered candidate list (nearest first)
    current_index INTEGER NOT NULL DEFAULT -1,      -- Index of the candidate currently being called
    candidate_source VARCHAR(40),                   -- 'matching_api' or 'helper_list'
    reason VARCHAR(300),
    started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    finished_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_dispatch_runs_ticket_id ON public.dispatch_runs(ticket_id);

-- 6. FOLLOW-UPS TABLE
-- Schedules reminder IVR calls to assigned helpers before the booking start time
CREATE TABLE IF NOT EXISTS public.followups (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    helper_id VARCHAR(64),
    helper_name VARCHAR(200),
    phone VARCHAR(32),
    offset_minutes INTEGER NOT NULL,                -- Reminder lead time in minutes (e.g. 120, 60, 30)
    due_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,    -- Exact timestamp when the reminder call is due
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',-- 'scheduled', 'calling', 'done', 'missed', 'cancelled'
    outcome VARCHAR(20),                            -- 'confirmed', 'declined', 'no_answer', etc.
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS ix_followups_ticket_id ON public.followups(ticket_id);
CREATE INDEX IF NOT EXISTS ix_followups_due_at ON public.followups(due_at);
CREATE INDEX IF NOT EXISTS ix_followups_status ON public.followups(status);

-- 7. CALL ATTEMPTS TABLE
-- Logs every automated IVR / Keypad phone call placed to helpers
CREATE TABLE IF NOT EXISTS public.call_attempts (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL,                   -- 'dispatch' or 'followup'
    run_id INTEGER REFERENCES public.dispatch_runs(id) ON DELETE SET NULL,
    followup_id INTEGER REFERENCES public.followups(id) ON DELETE SET NULL,
    helper_id VARCHAR(64),
    helper_name VARCHAR(200),
    phone VARCHAR(32),
    provider VARCHAR(20) NOT NULL,                  -- 'simulator' or 'twilio'
    provider_call_id VARCHAR(64),                   -- Twilio Call SID
    status VARCHAR(20) NOT NULL DEFAULT 'queued',   -- 'queued', 'ringing', 'in_progress', 'ended'
    outcome VARCHAR(20),                            -- 'accepted', 'rejected', 'no_input', 'no_answer', 'busy', 'failed'
    prompts_played INTEGER NOT NULL DEFAULT 0,      -- Keypad prompt repeat count (max 3)
    digits VARCHAR(50) NOT NULL DEFAULT '',         -- DTMF keypress digits collected ('1', '2')
    script TEXT,                                    -- Spoken audio script read by IVR agent
    error VARCHAR(500),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    answered_at TIMESTAMP WITHOUT TIME ZONE,
    ended_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_call_attempts_ticket_id ON public.call_attempts(ticket_id);
CREATE INDEX IF NOT EXISTS ix_call_attempts_helper_id ON public.call_attempts(helper_id);
CREATE INDEX IF NOT EXISTS ix_call_attempts_status ON public.call_attempts(status);
CREATE INDEX IF NOT EXISTS ix_call_attempts_provider_call_id ON public.call_attempts(provider_call_id);

-- 8. ESCALATIONS TABLE
-- Unplaced tickets or cancelled attendance escalated to human customer care agents
CREATE TABLE IF NOT EXISTS public.escalations (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    reason VARCHAR(40) NOT NULL,                    -- 'no_helper_accepted', 'no_eligible_helpers', 'helper_declined'
    details TEXT,                                   -- Contextual notes on why dispatch failed
    status VARCHAR(20) NOT NULL DEFAULT 'open',     -- 'open', 'in_progress', 'resolved'
    assigned_to VARCHAR(120),                       -- Customer care agent name
    notes TEXT,                                     -- Resolution / operator notes
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    resolved_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_escalations_ticket_id ON public.escalations(ticket_id);
CREATE INDEX IF NOT EXISTS ix_escalations_status ON public.escalations(status);

-- 9. EVENTS TABLE
-- Immutable timeline audit trail of all platform actions
CREATE TABLE IF NOT EXISTS public.events (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64),
    kind VARCHAR(40) NOT NULL,                      -- 'dispatch_started', 'helper_accepted', 'escalated', etc.
    message TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS ix_events_ticket_id ON public.events(ticket_id);
CREATE INDEX IF NOT EXISTS ix_events_created_at ON public.events(created_at);

-- 10. CUSTOMER FEEDBACK TABLE
-- Post-service voice call & WhatsApp customer feedback and complaint tracking
CREATE TABLE IF NOT EXISTS public.customer_feedback (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    customer_id VARCHAR(64),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(32),
    helper_id VARCHAR(64),
    helper_name VARCHAR(200),
    rating INTEGER,                                 -- 1 to 5 stars
    feedback_text TEXT,
    channel VARCHAR(20) NOT NULL DEFAULT 'voice',   -- 'voice', 'whatsapp', 'web'
    language VARCHAR(20) NOT NULL DEFAULT 'en',     -- 'en', 'te', 'hi'
    sentiment VARCHAR(20) NOT NULL DEFAULT 'positive', -- 'positive', 'neutral', 'negative'
    complaint_category VARCHAR(40) NOT NULL DEFAULT 'none', -- 'none', 'late_arrival', 'poor_service', 'incomplete_work', etc.
    complaint_details TEXT,
    resolution_status VARCHAR(20) NOT NULL DEFAULT 'resolved', -- 'new', 'in_progress', 'resolved'
    assigned_agent VARCHAR(120),
    resolution_notes TEXT,
    callback_requested BOOLEAN NOT NULL DEFAULT FALSE,
    callback_scheduled_at TIMESTAMP WITHOUT TIME ZONE,
    callback_completed BOOLEAN NOT NULL DEFAULT FALSE,
    call_attempt_id INTEGER REFERENCES public.call_attempts(id) ON DELETE SET NULL,
    call_duration_seconds INTEGER NOT NULL DEFAULT 0,
    audio_recording_url VARCHAR(500),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    resolved_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_customer_feedback_ticket_id ON public.customer_feedback(ticket_id);
CREATE INDEX IF NOT EXISTS ix_customer_feedback_rating ON public.customer_feedback(rating);
CREATE INDEX IF NOT EXISTS ix_customer_feedback_complaint ON public.customer_feedback(complaint_category);

-- 11. AUDIT LOGS TABLE
-- Security compliance and operational audit trails
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(100) NOT NULL DEFAULT 'system',
    user_role VARCHAR(50) NOT NULL DEFAULT 'admin',
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(64),
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON public.audit_logs(action);

