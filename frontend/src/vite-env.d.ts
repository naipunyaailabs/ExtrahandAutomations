/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CALLING_SERVICE_URL?: string;
  readonly VITE_WHATSAPP_SERVICE_URL?: string;
  readonly VITE_MARKETING_SERVICE_URL?: string;
  readonly VITE_ENGAGEMENT_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

