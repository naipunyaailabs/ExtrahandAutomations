/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** only when the dashboard is hosted apart from the backend; empty = same address */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
