// OpenClaw Desktop — Global Type Declarations

import type { SystemMetricsPayload } from '@/api/tauriAdapterContracts';

export interface AegisAPI {
  platform: string;
  app: {
    versions: () => Promise<{ desktop: string; openclaw: string | null }>;
    platformInfo?: () => Promise<string>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  notify: (title: string, body: string) => Promise<void>;
  runtimeData?: {
    openStateDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
  };
  /**
   * Optional product/edition override (e.g. white-label build or preload-injected config).
   * Merged with defaults in `src/config/edition.ts` at startup.
   */
  edition?: import('@/config/edition').EditionConfigPatch;
  systemMetrics: {
    onMetrics: (callback: (metrics: SystemMetricsPayload) => void) => () => void;
  };
}

declare global {
  interface Window {
    aegis: AegisAPI;
    __APP_VERSION__?: string;
  }

}

export {};
