/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API, e.g. https://book-the-court-api.onrender.com/api */
  readonly VITE_API_URL?: string;
  /** Public demo admin login shown on the login page (demo deployment only). */
  readonly VITE_DEMO_EMAIL?: string;
  readonly VITE_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
