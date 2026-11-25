/**
 * Service 2: WhatsApp Dispatch & Meta Cloud Service
 * 
 * Manages official Meta WhatsApp Cloud API broadcasts,
 * task dispatch messages to helpers, and automated acceptance callbacks.
 */

import type {
  BulkMessageRequest,
  BulkMessageResponse,
  ParseContactsResponse,
  TaskLocationCandidates,
  WhatsAppBroadcastResult,
  WhatsAppChannelControls,
  WhatsAppSendResult,
  WhatsAppStatus,
  WhatsAppFlow,
  WhatsAppTemplate,
  WaAutomationReport,
  WaBulkReport,
  WaRates,
  WaSentMessagesPage,
  WaAudience,
  WaWelcomerDashboard,
  WaWelcomerCommercials,
  WaWelcomerDetail,
  WaWelcomerHistory,
  WaWelcomerPeople,
  WaTaskAlertTemplate,
  WaFeedbackOverview,
  WaCancelFollowupOverview,
  WaCancelFollowupMessages,
  WaCancelReplies,
  WsSettings,
  WsOverview,
  WsConversation,
  WsConversationDetail,
  WsMessage,
  WsCase,
  WsTestReply,
  WaIncompleteCompletedPage,
  WaIncompleteDashboard,
  WaIncompleteUsersPage,
  WaIncompleteHistoryPage,
  WaIncompleteCommercials,
  WaCancelFollowupSetup,
  WaFeedbackPage,
  WaFeedbackTab,
  FbTasksPage,
  FbTemplateExample,
  FbCommercials,
  FbWhen,
  WaWelcomerState,
} from "../types";

export function createWhatsAppService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, serviceUrl);

  return {
    status: () => get<WhatsAppStatus>("/api/whatsapp/status"),
    commercialsAutomation: () => get<WaAutomationReport>("/api/whatsapp/commercials/automation"),
    commercialsBulk: () => get<WaBulkReport>("/api/whatsapp/commercials/bulk"),
    /** Welcomers: welcome template to helpers / customers who register after activation */
    /** Reviews & Feedback: WhatsApp feedback form after a task is completed */
    feedbackOverview: () => get<WaFeedbackOverview>("/api/whatsapp/feedback/overview"),
    feedbackRequests: (tab: WaFeedbackTab, q = "", offset = 0) =>
      get<WaFeedbackPage>(`/api/whatsapp/feedback/requests?${new URLSearchParams({ tab, q, offset: String(offset) })}`),
    feedbackTasks: (when: FbWhen, state: string, q = "", offset = 0, fb = "all") =>
      get<FbTasksPage>(`/api/whatsapp/feedback/tasks?${new URLSearchParams({ when, state, fb, q, offset: String(offset) })}`),
    feedbackCommercials: () => get<FbCommercials>("/api/whatsapp/feedback/commercials"),
    feedbackExample: () => get<FbTemplateExample>("/api/whatsapp/feedback/example"),
    feedbackSetup: () => post<WaFeedbackOverview["setup"]>("/api/whatsapp/feedback/setup"),
    activateFeedback: () => post<{ active: boolean }>("/api/whatsapp/feedback/activate"),
    deactivateFeedback: () => post<{ active: boolean }>("/api/whatsapp/feedback/deactivate"),
    feedbackCheckNow: () => post<{ sent: number }>("/api/whatsapp/feedback/check-now"),
    /** Cancellation Follow-up: "what went wrong?" message to customers who cancel a Work (Customer Engagement) */
    cancelFollowup: () => get<WaCancelFollowupOverview>("/api/whatsapp/cancel-followup/overview"),
    cancelFollowupMessages: (includeTests = false) =>
      get<WaCancelFollowupMessages>(`/api/whatsapp/cancel-followup/messages${includeTests ? "?include_tests=true" : ""}`),
    cancelFollowupReplies: (includeTests = false) =>
      get<WaCancelReplies>(`/api/whatsapp/cancel-followup/replies${includeTests ? "?include_tests=true" : ""}`),
    cancelFollowupSetup: () => post<WaCancelFollowupSetup>("/api/whatsapp/cancel-followup/setup"),
    activateCancelFollowup: () => post<{ active: boolean; since: string | null }>("/api/whatsapp/cancel-followup/activate"),
    deactivateCancelFollowup: () => post<{ active: boolean; since: string | null }>("/api/whatsapp/cancel-followup/deactivate"),
    cancelFollowupCheckNow: () => post<{ sent: number }>("/api/whatsapp/cancel-followup/check-now"),
    /** WhatsApp Support: the AI customer support agent (Customer Engagement → WhatsApp Support) */
    supportSettings: () => get<WsSettings>("/api/whatsapp/support/settings"),
    saveSupportSettings: (body: Partial<Omit<WsSettings, "health">>) => post<WsSettings>("/api/whatsapp/support/settings", body),
    supportOverview: (includeTests = false) => get<WsOverview>(`/api/whatsapp/support/overview${includeTests ? "?include_tests=true" : ""}`),
    supportConversations: (p: { status?: string; mode?: string; q?: string; includeTests?: boolean } = {}) =>
      get<WsConversation[]>(`/api/whatsapp/support/conversations?${new URLSearchParams({
        ...(p.status ? { status: p.status } : {}), ...(p.mode ? { mode: p.mode } : {}), ...(p.q ? { q: p.q } : {}),
        ...(p.includeTests ? { include_tests: "true" } : {}) })}`),
    supportConversation: (id: number) => get<WsConversationDetail>(`/api/whatsapp/support/conversations/${id}`),
    supportReply: (id: number, text: string, by?: string) => post<WsMessage>(`/api/whatsapp/support/conversations/${id}/reply`, { text, by }),
    supportTakeover: (id: number, by?: string) => post<WsConversation>(`/api/whatsapp/support/conversations/${id}/takeover`, { by }),
    supportHandback: (id: number) => post<WsConversation>(`/api/whatsapp/support/conversations/${id}/handback`),
    supportClose: (id: number) => post<WsConversation>(`/api/whatsapp/support/conversations/${id}/close`),
    supportCases: (includeTests = false) => get<WsCase[]>(`/api/whatsapp/support/cases${includeTests ? "?include_tests=true" : ""}`),
    supportTestChat: (phone: string, text: string) => post<WsTestReply>("/api/whatsapp/support/test-chat", { phone, text }),
    supportTestHistory: (phone: string) =>
      get<{ conversation_id: number | null; messages: WsMessage[]; mode: string }>(`/api/whatsapp/support/test-chat?phone=${encodeURIComponent(phone)}`),
    supportTestReset: (phone: string) => post<{ ok: boolean }>("/api/whatsapp/support/test-chat/reset", { phone, text: "" }),
    cancelFollowupTest: (phone: string, name: string) => post<{ ok: boolean }>("/api/whatsapp/cancel-followup/test", { phone, name }),
    feedbackSendNow: (ticketId: string) => post<{ ok: boolean }>(`/api/whatsapp/feedback/send/${encodeURIComponent(ticketId)}`),
    /** Task alert template (new task -> matching helpers) as shown on the Dispatch dashboard */
    taskAlertTemplate: (ticketId?: string) =>
      get<WaTaskAlertTemplate>(`/api/whatsapp/task-alert-template${ticketId ? `?ticket_id=${encodeURIComponent(ticketId)}` : ""}`),
    welcomerDashboard: (refresh = false) =>
      get<WaWelcomerDashboard>(`/api/whatsapp/welcomers/dashboard${refresh ? "?refresh=true" : ""}`),
    welcomer: (audience: WaAudience) => get<WaWelcomerDetail>(`/api/whatsapp/welcomers/${audience}`),
    activateWelcomer: (audience: WaAudience) => post<WaWelcomerState>(`/api/whatsapp/welcomers/${audience}/activate`),
    deactivateWelcomer: (audience: WaAudience) => post<WaWelcomerState>(`/api/whatsapp/welcomers/${audience}/deactivate`),
    /** Submits the Telugu version of this welcome template to Meta for review */
    submitWelcomerTelugu: (audience: WaAudience) =>
      post<{ ok: boolean; already: boolean; status: string }>(`/api/whatsapp/welcomers/${audience}/telugu`),
    welcomerHistory: (audience: WaAudience, refresh = false) =>
      get<WaWelcomerHistory>(`/api/whatsapp/welcomers/${audience}/history${refresh ? "?refresh=true" : ""}`),
    welcomerPeople: (audience: WaAudience, params: { day?: string; status?: string; q?: string; offset?: number; limit?: number }) =>
      get<WaWelcomerPeople>(
        `/api/whatsapp/welcomers/${audience}/people?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
        )}`,
      ),
    checkWelcomersNow: () => post<Record<string, number>>("/api/whatsapp/welcomers/check-now"),
    welcomerCommercials: () => get<WaWelcomerCommercials>("/api/whatsapp/welcomer-commercials"),
    incompleteRegDashboard: (refresh = false) =>
      get<WaIncompleteDashboard>(`/api/whatsapp/incomplete-reg/dashboard${refresh ? "?refresh=true" : ""}`),
    incompleteRegUsers: (params: { audience?: string; stage?: string; status?: string; location?: string; q?: string; offset?: number; limit?: number; refresh?: boolean }) =>
      get<WaIncompleteUsersPage>(
        `/api/whatsapp/incomplete-reg/users?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== false).map(([k, v]) => [k, String(v)]),
        )}`,
      ),
    incompleteRegCompleted: (params: { audience?: string; reminded?: string; status?: string; q?: string; offset?: number; limit?: number }) =>
      get<WaIncompleteCompletedPage>(
        `/api/whatsapp/incomplete-reg/completed?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
        )}`,
      ),
    incompleteRegHistory: (params: { audience?: string; status?: string; include_tests?: boolean; q?: string; offset?: number; limit?: number }) =>
      get<WaIncompleteHistoryPage>(
        `/api/whatsapp/incomplete-reg/history?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
        )}`,
      ),
    incompleteRegCommercials: () => get<WaIncompleteCommercials>("/api/whatsapp/incomplete-reg/commercials"),
    activateIncompleteReg: () => post<{ active: boolean; activated_at: string | null }>("/api/whatsapp/incomplete-reg/activate"),
    deactivateIncompleteReg: () => post<{ active: boolean; activated_at: string | null }>("/api/whatsapp/incomplete-reg/deactivate"),
    setupIncompleteRegTemplates: () => post<{ ok: boolean; templates: Record<string, { ok: boolean; already: boolean; status: string }> }>("/api/whatsapp/incomplete-reg/setup"),
    checkIncompleteRegNow: () => post<Record<string, number>>("/api/whatsapp/incomplete-reg/check-now"),
    testIncompleteReg: (phone: string, audience: WaAudience, name: string) =>
      post<{ ok: boolean; status: string }>("/api/whatsapp/incomplete-reg/test", { phone, audience, name }),
    /** Messages the platform sent, split by Meta category (utility / marketing / other). */
    sentMessages: (params: Record<string, string | number>) =>
      get<WaSentMessagesPage>(
        `/api/whatsapp/messages?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
      ),
    saveCommercialRates: (body: WaRates) => request<WaRates>("PUT", "/api/whatsapp/commercials/rates", body, serviceUrl),
    /** Today's WhatsApp dispatch pipeline from real data (real-customer orders, real / simulated / failed sends). */
    flow: () => get<WhatsAppFlow>("/api/whatsapp/flow"),
    templates: () => get<WhatsAppTemplate[]>("/api/whatsapp/templates"),
    /** Templates offered in Bulk Msgs (marketing allow-list) with their Meta review status. */
    bulkTemplates: () => get<WhatsAppTemplate[]>("/api/whatsapp/bulk-templates"),
    /** Submits a new MARKETING template to Meta for approval and adds it to the bulk list. */
    /** Removes a template from Bulk Msgs; fromMeta also deletes it permanently at Meta. */
    deleteBulkTemplate: (name: string, fromMeta: boolean) =>
      request<{ ok: boolean; name: string; deleted_from_meta: boolean }>(
        "DELETE", `/api/whatsapp/bulk-templates/${encodeURIComponent(name)}${fromMeta ? "?from_meta=true" : ""}`, undefined, serviceUrl,
      ),
    createBulkTemplate: (body: {
      name: string;
      body: string;
      examples: string[];
      footer?: string;
      language?: string;
      header_image?: "none" | "brand" | "banner";
      banner_filename?: string;
    }) =>
      post<{ ok: boolean; name: string; id: string; status: string }>("/api/whatsapp/bulk-templates", body),
    sendTemplate: (to: string, template_id: string, variables: Record<string, string>, ticket_id?: string) =>
      post<WhatsAppSendResult>("/api/whatsapp/send-template", { to, template_id, variables, ticket_id }),
    sendMessage: (to: string, message: string) => post<WhatsAppSendResult>("/api/whatsapp/send-message", { to, message }),
    sendDispatch: (payload: {
      ticket_id: string;
      helper_id: string;
      helper_phone: string;
      helper_name?: string;
      task_title: string;
      location: string;
      scheduled_time: string;
      payout: string;
    }) => post<WhatsAppSendResult>("/api/whatsapp/send-dispatch", payload),
    notifyAssigned: (payload: {
      ticket_id: string;
      helper_id: string;
      helper_phone: string;
      helper_name?: string;
      task_title: string;
      location: string;
      scheduled_time: string;
      payout: string;
    }) => post<WhatsAppSendResult>("/api/whatsapp/notify-assigned", payload),
    taskCandidates: (ticketId: string, radiusKm?: number) =>
      get<TaskLocationCandidates>(
        `/api/whatsapp/task-candidates/${encodeURIComponent(ticketId)}${radiusKm ? `?radius_km=${radiusKm}` : ""}`
      ),
    broadcastTask: (ticketId: string, radiusKm?: number) =>
      post<WhatsAppBroadcastResult>("/api/whatsapp/broadcast-task", { ticket_id: ticketId, radius_km: radiusKm }),
    parseContacts: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return post<ParseContactsResponse>("/api/whatsapp/parse-contacts", formData);
    },
    uploadBanner: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return post<{ url: string; preview_url?: string; filename: string; meta_media_id?: string }>("/api/whatsapp/upload-banner", formData);
    },
    sendBulk: (payload: BulkMessageRequest) => post<BulkMessageResponse>("/api/whatsapp/send-bulk", payload),
    channelControls: () => get<WhatsAppChannelControls>("/api/whatsapp/channel-controls"),
    toggleChannel: (payload: { automation_active?: boolean; bulk_active?: boolean }) =>
      post<WhatsAppChannelControls>("/api/whatsapp/channel-controls", payload),
    simulateReply: (from: string, body: string) =>
      post<{ status: string; result?: unknown }>("/api/whatsapp/webhook", {
        event: "message.received",
        from,
        body,
      }),
  };
}

