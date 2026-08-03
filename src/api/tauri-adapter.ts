// ═══════════════════════════════════════════════════════════
// JunQi Desktop — Tauri Adapter
// Replaces Electron preload (window.aegis) with Tauri APIs.
// Requires @tauri-apps/api externalized in vite.config.ts
// ═══════════════════════════════════════════════════════════

export interface SystemMetricsPayload {
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
}

import { invoke } from "@tauri-apps/api/core";
import {
  checkOpenclaw,
} from './tauri-commands';
import { getCurrentWindow } from "@tauri-apps/api/window";
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import {
  loadOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signDevicePayload,
} from "./device-identity";
import type { DeviceIdentity } from "./device-identity";
import { APP_VERSION } from '../version';

const LEGACY_CONFIG_BACKUPS_STORAGE_KEY = 'aegis-config-backups';

function clearLegacyOpenClawConfigBackups(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_CONFIG_BACKUPS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in a browser preview; no config is retained there.
  }
}

clearLegacyOpenClawConfigBackups();

interface PlatformInfoPayload {
  os: string;
  arch: string;
  home_dir: string;
  desktop_dir: string;
}

interface DeviceSignParams {
  nonce?: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let _deviceIdentity: DeviceIdentity | null = null;
async function deviceIdentity() {
  if (!_deviceIdentity) _deviceIdentity = await loadOrCreateDeviceIdentity();
  return _deviceIdentity;
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "darwin";
  if (ua.includes("Win")) return "win32";
  if (ua.includes("Linux")) return "linux";
  return "unknown";
}

interface StorageRuntimePaths {
  stateDir: string;
  workspaceDir: string;
}

async function readStorageRuntimePaths(): Promise<StorageRuntimePaths | null> {
  try {
    const status = await invoke<Partial<StorageRuntimePaths>>('get_storage_setup_status');
    if (typeof status.stateDir !== 'string' || !status.stateDir.trim()) return null;
    if (typeof status.workspaceDir !== 'string' || !status.workspaceDir.trim()) return null;
    return { stateDir: status.stateDir, workspaceDir: status.workspaceDir };
  } catch {
    return null;
  }
}

// Guard: in a plain browser (no Tauri runtime, e.g. headless screenshots),
// getCurrentWindow()/listen() throw at module load. Wrap so the adapter boots.
let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
try {
  appWindow = getCurrentWindow();
} catch {
  appWindow = null;
}

window.aegis = {
  platform: detectPlatform(),

  app: {
    versions: async () => {
      // JunQi relies on the *local* OpenClaw (not a bundled copy), so the version
      // comes from the installed binary via `check_openclaw`
      // ("OpenClaw 2026.6.5 (hash)" → "2026.6.5").
      let openclaw: string | null = null;
      try {
        const st = await checkOpenclaw();
        if (st?.version) {
          const m = String(st.version).match(/(\d[\w.\-]*)/);
          openclaw = m ? m[1] : String(st.version);
        }
      } catch {}
      return { desktop: window.__APP_VERSION__ || APP_VERSION, openclaw };
    },
    platformInfo: async () => {
      try {
        const info = await invoke<PlatformInfoPayload>("get_platform_info");
        return `${info.os} (${info.arch})`;
      } catch { return `${navigator.platform}`; }
    },
  },

  window: {
    minimize: async () => { await appWindow?.minimize(); },
    maximize: async () => { if (!appWindow) return false; await appWindow.toggleMaximize(); return await appWindow.isMaximized(); },
    close: async () => { await appWindow?.close(); },
    isMaximized: async () => appWindow ? appWindow.isMaximized() : false,
  },

  device: {
    getIdentity: async () => { const id = await deviceIdentity(); return { deviceId: id.deviceId, publicKey: id.publicKey }; },
    sign: async (params: DeviceSignParams) => {
      const id = await deviceIdentity();
      const signedAtMs = Date.now();
      const nonce = params.nonce ?? "";
      const payload = buildDeviceAuthPayload({ deviceId: id.deviceId, clientId: params.clientId, clientMode: params.clientMode, role: params.role, scopes: params.scopes, signedAtMs, token: params.token, nonce });
      const signature = await signDevicePayload(id.privateKey, payload);
      return { deviceId: id.deviceId, publicKey: id.publicKey, signature, signedAt: signedAtMs, nonce: params.nonce };
    },
  },


  terminal: {
    // portable-pty backed PTY multiplexer in Rust. Each create() spawns a
    // login shell; stdout arrives via the "terminal-data" event, exits via
    // "terminal-exit". onData/onExit return unlisten functions that match
    // the Electron preload contract in src/types/global.d.ts.
    create: async (opts?: { cols?: number; rows?: number; cwd?: string }) => {
      try {
        const r = await invoke<{ id: string; pid: number }>("terminal_create", {
          cols: opts?.cols,
          rows: opts?.rows,
          cwd: opts?.cwd ?? null,
        });
        return { id: r.id, pid: r.pid };
      } catch (error: unknown) {
        return { id: "", pid: 0, error: errorMessage(error) };
      }
    },
    write: (id: string, data: string) => invoke<void>("terminal_write", { id, data }),
    resize: (id: string, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows }),
    kill: (id: string) => invoke<void>("terminal_kill", { id }),
    onData: (callback: (id: string, data: string) => void) => {
      return subscribeTauriEvent<{ id: string; data: string }>(
        "terminal-data",
        (event) => callback(event.payload.id, event.payload.data),
      );
    },
    onExit: (callback: (id: string, exitCode: number, signal?: number) => void) => {
      return subscribeTauriEvent<{ id: string; exit_code: number }>(
        "terminal-exit",
        (event) => callback(event.payload.id, event.payload.exit_code),
      );
    },
  },
  notify: async (t: string, b: string) => { if ("Notification" in window && Notification.permission === "granted") new Notification(t, { body: b }); },
  runtimeData: { openStateDirectory: async () => {
    const paths = await readStorageRuntimePaths();
    if (!paths?.stateDir) return { success: false, error: 'Storage location is unavailable' };
    try {
      await invoke<void>("open_folder", { path: paths.stateDir });
      return { success: true, path: paths.stateDir };
    } catch (error) {
      return { success: false, path: paths.stateDir, error: errorMessage(error) };
    }
  } },
  // JunQi-style system metrics event stream (background thread emits every 1s)
  systemMetrics: {
    onMetrics: (cb: (metrics: SystemMetricsPayload) => void) => {
      return subscribeTauriEvent<SystemMetricsPayload>("system-metrics", (event) => cb(event.payload));
    },
  },
};
