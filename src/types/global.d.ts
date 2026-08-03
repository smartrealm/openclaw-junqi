// OpenClaw Desktop — Global Type Declarations

interface AegisAPI {
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
  // Gateway IPC removed — all WS handled by src/services/gateway.ts
  device: {
    getIdentity: () => Promise<{ deviceId: string; publicKey: string }>;
    sign: (params: {
      nonce?: string;
      clientId: string;
      clientMode: string;
      role: string;
      scopes: string[];
      token: string;
    }) => Promise<{
      deviceId: string;
      publicKey: string;
      signature: string;
      signedAt: number;
      nonce?: string;
    }>;
  };
  terminal: {
    create: (opts?: { cols?: number; rows?: number; cwd?: string }) => Promise<{ id: string; pid: number; error?: string }>;
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    kill: (id: string) => Promise<void>;
    onData: (callback: (id: string, data: string) => void) => () => void;
    onExit: (callback: (id: string, exitCode: number, signal?: number) => void) => () => void;
  };
  notify: (title: string, body: string) => Promise<void>;
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
}

declare global {
  interface Window {
    aegis: AegisAPI;
    __APP_VERSION__?: string;
  }

}

export {};
