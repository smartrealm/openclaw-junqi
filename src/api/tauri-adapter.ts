// ═══════════════════════════════════════════════════════════
// JunQi Desktop — Tauri Adapter
// Replaces Electron preload (window.aegis) with Tauri APIs.
// Requires @tauri-apps/api externalized in vite.config.ts
// ═══════════════════════════════════════════════════════════

import { invoke } from "@tauri-apps/api/core";
import { checkOpenclaw } from './tauri-commands';
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { APP_VERSION } from '../version';
import type { AegisAPI } from '@/types/global';
import {
  parseStorageRuntimePaths,
  parseSystemMetricsPayload,
  parseTauriPlatformInfo,
  type SystemMetricsPayload,
} from './tauriAdapterContracts';
import { debugWarn } from '@/utils/debugLog';

export type { SystemMetricsPayload } from './tauriAdapterContracts';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "darwin";
  if (ua.includes("Win")) return "win32";
  if (ua.includes("Linux")) return "linux";
  return "unknown";
}

async function readStorageRuntimePaths() {
  try {
    return parseStorageRuntimePaths(await invoke<unknown>('get_storage_setup_status'));
  } catch {
    return null;
  }
}

// Guard: in a plain browser (no Tauri runtime, e.g. headless screenshots),
// getCurrentWindow()/listen() throw at module load. Wrap so the adapter boots.
let appWindow: TauriWindow | null = null;
try {
  appWindow = getCurrentWindow();
} catch {
  appWindow = null;
}

const aegisBridge: AegisAPI = {
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
        const info = parseTauriPlatformInfo(await invoke<unknown>("get_platform_info"));
        return `${info.os} (${info.arch})`;
      } catch { return `${navigator.platform}`; }
    },
  },

  window: {
    minimize: async () => { if (appWindow) await appWindow.minimize(); },
    maximize: async () => { if (!appWindow) return false; await appWindow.toggleMaximize(); return await appWindow.isMaximized(); },
    close: async () => { if (appWindow) await appWindow.close(); },
    isMaximized: async () => appWindow ? appWindow.isMaximized() : false,
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
      return subscribeTauriEvent<unknown>("system-metrics", (event) => {
        const metrics = parseSystemMetricsPayload(event.payload);
        if (!metrics) {
          debugWarn('app', '[Tauri] Ignored invalid system metrics event');
          return;
        }
        cb(metrics);
      });
    },
  },
};

window.aegis = aegisBridge;
