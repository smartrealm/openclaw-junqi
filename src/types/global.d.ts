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
  runtimeData?: {
    openStateDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
  };
  systemMetrics: {
    onMetrics: (callback: (metrics: {
      cpu: number;
      cpu_count: number;
      mem_used: number;
      mem_total: number;
      disk_used: number;
      disk_total: number;
      net_up_speed: number;
      net_down_speed: number;
      uptime: number;
      load1: number;
      load5: number;
      load15: number;
      platform: string;
      platform_version: string;
      arch: string;
    }) => void) => () => void;
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
