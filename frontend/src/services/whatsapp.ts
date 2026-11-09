/**
 * Service 2: WhatsApp Dispatch & Meta Cloud Service
 * 
 * Manages official Meta WhatsApp Cloud API broadcasts, QR pairing sessions,
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
} from "../types";

export function createWhatsAppService(
  request: <T>(method: string, path: string, body?: unknown, serviceUrl?: string) => Promise<T>,
  serviceUrl?: string
) {
  const get = <T>(path: string) => request<T>("GET", path, undefined, serviceUrl);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body, serviceUrl);

  return {
    status: () => get<WhatsAppStatus>("/api/whatsapp/status"),
    /** Today's WhatsApp dispatch pipeline from real data (real-customer orders, real / simulated / failed sends). */
    flow: () => get<WhatsAppFlow>("/api/whatsapp/flow"),
    qr: () =>
      get<{ session_id?: string; qr?: string; status?: string; simulated?: boolean; message?: string; error?: string }>(
        "/api/whatsapp/qr"
      ),
    start: () => post<{ session_id?: string; status?: string }>("/api/whatsapp/start"),
    pairingCode: (phone: string) => post<{ code?: string; error?: string }>("/api/whatsapp/pairing-code", { phone }),
    templates: () => get<WhatsAppTemplate[]>("/api/whatsapp/templates"),
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

