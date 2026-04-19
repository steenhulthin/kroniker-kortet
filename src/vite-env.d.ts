/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RUKS_LATEST_RELEASE_URL?: string;
  readonly VITE_RUKS_RELEASE_FALLBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
