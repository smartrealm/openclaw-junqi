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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  loadOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signDevicePayload,
} from "./device-identity";
import {
  ConfigResolverChain,
  CachedTokenResolver,
  EventPayloadResolver,
  FileReadResolver,
} from "../services/gateway/configResolvers";

let _deviceIdentity: any = null;
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

// Guard: in a plain browser (no Tauri runtime, e.g. headless screenshots),
// getCurrentWindow()/listen() throw at module load. Wrap so the adapter boots.
let appWindow: any = null;
try {
  appWindow = getCurrentWindow();
} catch {
  appWindow = null;
}

// ── Listen for gateway-config event (may arrive before or after listener) ──
let _gwConfig: any = null;
let _gwReady = false;
try {
  listen("gateway-config", (event: any) => {
    _gwConfig = event.payload;
    _gwReady = true;
  }).catch(() => {});
} catch {}

// ── Resolve gateway config via Chain of Responsibility ──
// Priority: cached token → event payload → file read (openclaw.json).
async function resolveGwConfig(): Promise<any> {
  const chain = new ConfigResolverChain([
    new CachedTokenResolver(() => _cachedGatewayToken, () => _cachedGatewayPort),
    new EventPayloadResolver(() => _gwConfig),
    new FileReadResolver(invoke),
  ]);
  const result = await chain.resolve();
  if (result) {
    // Cache for subsequent calls
    _cachedGatewayToken = result.token;
    const m = String(result.ws_url).match(/:(\d+)$/);
    if (m) _cachedGatewayPort = parseInt(m[1], 10);
  }
  return result;
}

// ── Cached gateway port — read once from config, reused across all calls ──
// We intentionally do NOT cache at module load time because config may not
// exist yet. Instead we cache on first successful read.
let _cachedGatewayPort: number | null = null;
/** Cached gateway token — populated by start_gateway result, used by resolveGwConfig. */
let _cachedGatewayToken: string | null = null;

/**
 * Returns the gateway port configured in openclaw.json.
 * Falls back to 18789 if the file is missing or the field is absent.
 * Result is cached for the process lifetime to avoid repeated disk reads.
 */
async function readGatewayPort(): Promise<number> {
  if (_cachedGatewayPort !== null) return _cachedGatewayPort;
  try {
    const d: any = await invoke("read_config");
    const port = JSON.parse(d.raw || "{}")?.gateway?.port;
    if (typeof port === "number" && port > 0 && port < 65536) {
      _cachedGatewayPort = port;
      return port;
    }
  } catch { /* config not yet written — use default */ }
  return 18789;
}

/**
 * Invalidate the port cache, e.g. after the user saves a new port in settings.
 * The next call to readGatewayPort() will re-read from disk.
 */
function invalidateGatewayPortCache(): void {
  _cachedGatewayPort = null;
  _cachedGatewayToken = null;
}

async function restartLocalGateway(): Promise<{ success: boolean; method?: string; error?: string }> {
  invalidateGatewayPortCache();
  const port = await readGatewayPort();
  try {
    const result: any = await invoke("restart_gateway", { port });
    if (result?.token) _cachedGatewayToken = result.token;
    return { success: true, method: "gateway-restart" };
  } catch (e: any) {
    return { success: false, error: String(e) };
  }
}

(window as any).aegis = {
  platform: detectPlatform(),

  app: {
    versions: async () => {
      // JunQi relies on the *local* OpenClaw (not a bundled copy), so the version
      // comes from the installed binary via `check_openclaw`
      // ("OpenClaw 2026.6.5 (hash)" → "2026.6.5").
      let openclaw: string | null = null;
      try {
        const st: any = await invoke("check_openclaw");
        if (st?.version) {
          const m = String(st.version).match(/(\d[\w.\-]*)/);
          openclaw = m ? m[1] : String(st.version);
        }
      } catch {}
      return { desktop: (window as any).__APP_VERSION__ || "0.5.0", openclaw };
    },
    platformInfo: async () => {
      try {
        const info: any = await invoke("get_platform_info");
        return `${info.os} (${info.arch})`;
      } catch { return `${navigator.platform}`; }
    },
  },

  window: {
    minimize: () => appWindow?.minimize(),
    maximize: async () => { if (!appWindow) return false; await appWindow.toggleMaximize(); return await appWindow.isMaximized(); },
    close: () => appWindow?.close(),
    isMaximized: () => appWindow?.isMaximized() ?? false,
  },

  config: {
    get: async () => {
      const gw = await resolveGwConfig();
      const r: any = {};
      if (gw?.token) r.gatewayToken = gw.token;
      if (gw?.ws_url) r.gatewayUrl = gw.ws_url;
      try { return { ...r, ...JSON.parse(localStorage.getItem("aegis-config") || "{}") }; } catch { return r; }
    },
    save: async (c: any) => { try { localStorage.setItem("aegis-config", JSON.stringify(c)); return { success: true }; } catch { return { success: false }; } },
    detect: async () => { try { const d: any = await invoke("read_config"); return { path: d.path, exists: !!(d.raw && d.raw !== "{}") }; } catch { return { path: "", exists: false }; } },
    read: async () => { try { const d: any = await invoke("read_config"); return { data: JSON.parse(d.raw || "{}"), path: d.path }; } catch { return { data: {}, path: "" }; } },
    write: async (_p: string, d: any) => { try { await invoke("write_config", { json: JSON.stringify(d, null, 2) }); return { success: true }; } catch (e: any) { return { success: false, error: String(e) }; } },
    restart: restartLocalGateway,
    validateOpenclawJson: async () => { try { const d: any = await invoke("read_config"); return { valid: true, path: d.path, exists: true }; } catch { return { valid: false, path: "", exists: false }; } },
    backupAndResetOpenclaw: async () => { try { await invoke("write_config", { json: "{}" }); return { success: true }; } catch (e: any) { return { success: false, error: String(e) }; } },
  },

  gateway: {
    getStatus: async () => {
      try {
        const s: any = await invoke("gateway_status");
        return { running: Boolean(s.running), ready: Boolean(s.running), error: null, logs: { stdout: "", stderr: "" } };
      } catch (e: any) {
        return { running: false, ready: false, error: String(e), logs: { stdout: "", stderr: "" } };
      }
    },
    start: async () => {
      const port = await readGatewayPort();
      try {
        const result: any = await invoke("start_gateway", { port });
        // Cache the token returned by the Rust side so resolveGwConfig() can
        // use it immediately without waiting for the gateway-config event.
        if (result?.token) {
          _cachedGatewayToken = result.token;
        }
        return { success: true };
      } catch (e: any) {
        return { success: false, error: String(e) };
      }
    },
    retry: restartLocalGateway,
    onStatusChanged: (cb: any) => {
      let unlistenFn: (() => void) | null = null;
      let lastLogs = { stdout: "", stderr: "" };
      let stopped = false;

      const emitRealStatus = async () => {
        if (stopped) return;
        try {
          const s: any = await invoke("gateway_status");
          cb({
            running: Boolean(s.running),
            ready: Boolean(s.running),
            error: null,
            logs: lastLogs,
          });
        } catch (e: any) {
          cb({
            running: false,
            ready: false,
            error: String(e),
            logs: lastLogs,
          });
        }
      };

      const handleProgress = (event: any) => {
        const line = String(event.payload ?? '');
        lastLogs = { stdout: line, stderr: "" };
        cb({ running: false, ready: false, retrying: true, error: null, logs: lastLogs });
        void emitRealStatus();
      };

      listen("gateway-log", handleProgress).then((fn: any) => { unlistenFn = fn; }).catch(() => {});
      let unlistenRestartFn: (() => void) | null = null;
      listen("gateway-restart-progress", handleProgress).then((fn: any) => { unlistenRestartFn = fn; }).catch(() => {});

      // Initial poll + periodic real status check (covers external gateway with no fresh logs)
      void emitRealStatus();
      const timer = setInterval(() => { void emitRealStatus(); }, 2000);

      return () => {
        stopped = true;
        clearInterval(timer);
        unlistenFn?.();
        unlistenRestartFn?.();
      };
    },
  },

  settings: { save: async (k: string, v: any) => { try { localStorage.setItem(`aegis-setting:${k}`, JSON.stringify(v)); return { success: true }; } catch { return { success: false }; } } },

  device: {
    getIdentity: async () => { const id = await deviceIdentity(); return { deviceId: id.deviceId, publicKey: id.publicKey }; },
    sign: async (params: any) => {
      const id = await deviceIdentity();
      const signedAtMs = Date.now();
      const nonce = params.nonce || "";
      const payload = buildDeviceAuthPayload({ deviceId: id.deviceId, clientId: params.clientId, clientMode: params.clientMode, role: params.role, scopes: params.scopes, signedAtMs, token: params.token, nonce });
      const signature = await signDevicePayload(id.privateKey, payload);
      return { deviceId: id.deviceId, publicKey: id.publicKey, signature, signedAt: signedAtMs, nonce: params.nonce };
    },
  },

  file: {
    openDialog: async () => { try { const { open } = await import("@tauri-apps/plugin-dialog"); const r = await open({ multiple: false }); return r ? { canceled: false, filePaths: [r] } : { canceled: true, filePaths: [] }; } catch { return { canceled: true, filePaths: [] }; } },
    read: async (path: string) => { try { const { readFile } = await import("@tauri-apps/plugin-fs"); const c = await readFile(path); const t = new TextDecoder().decode(c); const ext = path.split(".").pop()?.toLowerCase() || ""; const img = ["png","jpg","jpeg","gif","webp","svg"]; const is = img.includes(ext); return { name: path.split("/").pop()||path, path, base64: is ? btoa(String.fromCharCode(...c)) : btoa(t), mimeType: is ? `image/${ext}` : "application/octet-stream", isImage: is, size: c.length }; } catch { return null; } },
    openSharedFolder: async () => {
      try {
        // Read configured workspace from config, fall back to default
        const config = await invoke<{ raw: string }>("read_config");
        const parsed = JSON.parse(config.raw || "{}");
        const workspace = parsed?.agents?.defaults?.workspace || "~/.openclaw/workspace";
        await invoke("open_folder", { path: workspace });
      } catch {
        try { await invoke("open_folder", { path: "~/.openclaw/workspace" }); } catch {}
      }
    },
  },

  image: { save: async (src: string, suggestedName: string) => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      // Convert data URL to bytes and save
      const b64 = src.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = await save({ defaultPath: suggestedName, filters: [{ name: "Images", extensions: ["png"] }] });
      if (path) { await writeFile(path, bytes); return { success: true, path }; }
      return { success: false, error: "Cancelled" };
    } catch (e: any) { return { success: false, error: String(e) }; }
  } },
  screenshot: {
    // Check if Screen Recording permission is granted (captures to /dev/null)
    checkPermission: async () => { try { const r: any = await invoke("screenshot_check_permission"); return r ?? { granted: false }; } catch { return { granted: false }; } },
    // Interactive: native macOS screencapture -i (drag area / Space for window)
    captureInteractive: async () => { try { const r: any = await invoke("screenshot_interactive"); return r; } catch (e: any) {
      const msg = String(e || '');
      if (msg.includes("PERMISSION_DENIED")) { return { success: false, error: msg.replace("PERMISSION_DENIED:", ""), tccDenied: true }; }
      if (msg.includes("CANCELLED")) { return { success: false, cancelled: true }; }
      return { success: false };
    }},
    capture: async () => { try { const r: any = await invoke("screenshot_fullscreen"); return r; } catch (e: any) {
      const msg = String(e || '');
      if (msg.includes("PERMISSION_DENIED")) { return { success: false, error: msg.replace("PERMISSION_DENIED:", ""), tccDenied: true }; }
      return { success: false };
    }},
    // Window picker (for ScreenshotPicker compatibility)
    getWindows: async () => { try { const r: any = await invoke("screenshot_list_windows"); return Array.isArray(r) ? r : []; } catch { return []; } },
    captureWindow: async (id: string) => { try { const r: any = await invoke("screenshot_capture_window", { id }); return r; } catch { return { success: false }; } },
    captureSourceStream: async (sourceId: string): Promise<string | null> => {
      try { const r: any = await invoke("screenshot_capture_window", { id: sourceId }); return r?.data ?? null; } catch { return null; }
    },
    getSources: async () => { try { const r: any = await invoke("screenshot_list_windows"); return Array.isArray(r) ? r : []; } catch { return []; } },
  },
  memory: { browse: async () => null, readLocal: async () => ({ success: false, files: [] }) },
  pairing: { getToken: async () => { try { return await invoke("get_gateway_token"); } catch { return null; } }, saveToken: async () => ({ success: true }), requestPairing: async () => { const id = await deviceIdentity(); return { code: "", deviceId: id.deviceId }; }, poll: async () => ({ status: "timeout" }) },
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
      } catch (e: any) {
        return { id: "", pid: 0, error: String(e?.message ?? e) };
      }
    },
    write: (id: string, data: string) => invoke("terminal_write", { id, data }),
    resize: (id: string, cols: number, rows: number) => invoke("terminal_resize", { id, cols, rows }),
    kill: (id: string) => invoke("terminal_kill", { id }),
    onData: (callback: (id: string, data: string) => void) => {
      let unlisten: (() => void) | null = null;
      let pending = true;
      listen<{ id: string; data: string }>("terminal-data", (e) => callback(e.payload.id, e.payload.data))
        .then((fn) => { if (pending) unlisten = fn; else fn(); })
        .catch(() => {});
      return () => { pending = false; unlisten?.(); };
    },
    onExit: (callback: (id: string, exitCode: number, signal?: number) => void) => {
      let unlisten: (() => void) | null = null;
      let pending = true;
      listen<{ id: string; exit_code: number }>("terminal-exit", (e) => callback(e.payload.id, e.payload.exit_code))
        .then((fn) => { if (pending) unlisten = fn; else fn(); })
        .catch(() => {});
      return () => { pending = false; unlisten?.(); };
    },
  },
  artifact: { open: async () => ({ success: false }) },
  notify: async (t: string, b: string) => { if ("Notification" in window && Notification.permission === "granted") new Notification(t, { body: b }); },
  consoleUi: {
    // Open the gateway's Control UI in an in-app window (mirrors openclaw-desktop).
    // The Rust side injects the gateway token via the URL hash and a floating
    // "← 返回 JunQi" button. Falls back to the system browser on failure.
    open: async () => {
      try { await invoke("open_control_ui"); return { success: true }; }
      catch (e: any) {
        try { const { open } = await import("@tauri-apps/plugin-shell"); const _cp = await readGatewayPort(); await open(`http://127.0.0.1:${_cp}`); return { success: true }; }
        catch { return { success: false, error: String(e) }; }
      }
    },
  },
  logs: { openElectronLogFile: async () => { try { await invoke("open_folder", { path: "~/.openclaw" }); return { success: true }; } catch { return { success: false }; } } },
  secrets: { audit: async () => ({ success: false }), reload: async () => ({ success: false }) },
  agentAuth: { syncMain: async () => ({ success: true }), rehydrateMainRuntime: async () => ({ success: true }) },
  skills: { listManaged: async () => ({ success: true, skills: [] }), importFolder: async () => ({ success: false }), importZip: async () => ({ success: false }), delete: async () => ({ success: false }) },
  skillshub: { check: async () => ({ installed: false, path: null }), install: async () => ({ success: false }), installCli: async () => ({ success: false }) },
  clawhub: { openLogin: async () => ({ success: false }), loginCli: async () => ({ success: false }), authStatus: async () => ({ available: false, loggedIn: false, source: null, displayName: null }), searchCli: async () => ({ success: false, items: [] }), fetchJson: async () => ({ ok: false, status: 500, retryAfter: null }), install: async () => ({ success: false }) },
  managedFiles: {
    open: async (path: string) => { try { const v: any = await invoke('managed_file_open', { path }); return { success: v?.success ?? false }; } catch { return { success: false }; } },
    reveal: async (path: string) => { try { const v: any = await invoke('managed_file_reveal', { path }); return { success: v?.success ?? false }; } catch { return { success: false }; } },
    exists: async (path: string) => { try { const v: any = await invoke('managed_file_exists', { path }); return { success: v?.success ?? false, exists: v?.exists ?? false }; } catch { return { success: false, exists: false }; } },
    list: async (path: string) => { try { const v: any = await invoke('list_directory', { path }); return { success: v?.success ?? false, entries: v?.entries ?? [], error: v?.error ?? null }; } catch { return { success: false, entries: [], error: 'invoke failed' }; } },
	    read: async (path: string) => { try { const v: any = await invoke('read_file_text', { path }); return { success: v?.success ?? false, content: v?.content ?? null, byteSize: v?.byte_size ?? 0, truncated: v?.truncated ?? false, error: v?.error ?? null }; } catch { return { success: false, content: null, byteSize: 0, truncated: false, error: 'invoke failed' }; } },
    delete: async () => ({ success: false }),
  },
  attachments: { stage: async () => ({ success: false, staged: [] }), cleanup: async () => ({ success: true, removedFiles: 0, removedBytes: 0, scannedFiles: 0, totalBytes: 0, root: "", wouldRemoveFiles: 0, wouldRemoveBytes: 0 }), cleanupSession: async () => ({ success: false, removed: false, sessionKey: "" }) },
  uploads: { list: async () => ({ success: true, rows: [], total: 0, root: "" }), open: async () => ({ success: false }), reveal: async () => ({ success: false }), exists: async () => ({ success: false, exists: false }), read: async () => ({ success: false }), delete: async () => ({ success: false }), saveAs: async () => ({ success: false }), cleanup: async () => ({ success: true, removedFiles: 0, removedBytes: 0, scannedFiles: 0, totalBytes: 0, root: "", wouldRemoveFiles: 0, wouldRemoveBytes: 0 }), cleanupSession: async () => ({ success: false, removed: false, sessionKey: "" }) },
  // Nezha-style system metrics event stream (background thread emits every 1s)
  systemMetrics: {
    onMetrics: (cb: (metrics: SystemMetricsPayload) => void) => {
      const p = listen("system-metrics", (event: any) => cb(event.payload as SystemMetricsPayload));
      return () => { p.then((fn: any) => fn()).catch(() => {}); };
    },
  },
  voice: {
    // Rust-native recording via CoreAudio — TCC permission persists properly.
    startRecording: async () => { try { const r: any = await invoke("voice_start_recording"); return r; } catch (e: any) { return { success: false, error: String(e) }; } },
    stopRecording: async () => { try { const r: any = await invoke("voice_stop_recording"); return r; } catch (e: any) { return { success: false, error: String(e) }; } },
    isRecording: async () => { try { const r: any = await invoke("voice_is_recording"); return r; } catch { return { recording: false }; } },
    save: async (filename: string, base64: string, sessionKey?: string, agentId?: string) => {
      try {
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const { appDataDir } = await import("@tauri-apps/api/path");
        const dir = await appDataDir();
        const voiceDir = sessionKey ? `${dir}voice/${sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}` : `${dir}voice`;
        try { await invoke("open_folder", { path: voiceDir }); } catch {}
        const path = `${voiceDir}/${filename}`;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await writeFile(path, bytes);
        return path;
      } catch { return null; }
    },
    read: async (filePath: string) => {
      try {
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const bytes = await readFile(filePath);
        const b64 = btoa(String.fromCharCode(...bytes));
        return b64;
      } catch { return null; }
    },
  },
  update: { check: async () => null, download: async () => null, install: async () => {}, onAvailable: () => () => {}, onUpToDate: () => () => {}, onProgress: () => () => {}, onDownloaded: () => () => {}, onError: () => () => {} },
};
