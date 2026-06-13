import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Settings Store
// ═══════════════════════════════════════════════════════════

type Lang = 'ar' | 'en' | 'zh';

/** Three-stage sidebar: full → icons-only → fully hidden, cycled by the topbar toggle. */
export type SidebarMode = 'expanded' | 'mini' | 'hidden';

interface SettingsState {
  theme: 'aegis-dark' | 'aegis-light' | 'system';
  /** Whole-UI scale in percent (80–150). Applied via CSS `zoom` on #app-root. */
  uiScale: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  settingsOpen: boolean;
  language: Lang;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  dndMode: boolean;
  budgetLimit: number;
  commandPaletteOpen: boolean;
  memoryExplorerEnabled: boolean;
  memoryMode: 'api' | 'local';
  memoryApiUrl: string;
  memoryLocalPath: string;
  context1mEnabled: boolean;
  toolIntentEnabled: boolean;
  audioAutoPlay: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  sidebarCollapsed: boolean;
  sidebarMode: SidebarMode;

  setTheme: (theme: string) => void;
  setUiScale: (scale: number) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setLanguage: (lang: Lang) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setDndMode: (dnd: boolean) => void;
  setBudgetLimit: (n: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMemoryExplorerEnabled: (enabled: boolean) => void;
  setMemoryMode: (mode: 'api' | 'local') => void;
  setMemoryApiUrl: (url: string) => void;
  setMemoryLocalPath: (path: string) => void;
  setContext1mEnabled: (enabled: boolean) => void;
  setToolIntentEnabled: (enabled: boolean) => void;
  setAudioAutoPlay: (enabled: boolean) => void;
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  cycleSidebar: () => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const ACCENT_SHADES: Record<string, { 400: string; 500: string; 600: string; raw400: string }> = {
  teal:    { 400: 'var(--color-teal-400)',    500: 'var(--color-teal-500)',    600: 'var(--color-teal-600)',    raw400: 'var(--color-teal-400)' },
  blue:    { 400: 'var(--color-blue-400)',    500: 'var(--color-blue-500)',    600: 'var(--color-blue-600)',    raw400: 'var(--color-blue-400)' },
  purple:  { 400: 'var(--color-purple-400)',  500: 'var(--color-purple-500)',  600: 'var(--color-purple-600)',  raw400: 'var(--color-purple-400)' },
  rose:    { 400: 'var(--color-rose-400)',    500: 'var(--color-rose-500)',    600: 'var(--color-rose-600)',    raw400: 'var(--color-rose-400)' },
  amber:   { 400: 'var(--color-amber-400)',   500: 'var(--color-amber-500)',   600: 'var(--color-amber-600)',   raw400: 'var(--color-amber-400)' },
  emerald: { 400: 'var(--color-emerald-400)', 500: 'var(--color-emerald-500)', 600: 'var(--color-emerald-600)', raw400: 'var(--color-emerald-400)' },
};

// Auto-detect language on first run: check saved → system language → fallback to English
const detectLang = (): Lang => {
  const saved = localStorage.getItem('aegis-language');
  if (saved === 'ar' || saved === 'en' || saved === 'zh') return saved;
  // First run — detect from system/browser language
  const sysLang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
  if (sysLang.startsWith('zh')) return 'zh';
  if (sysLang.startsWith('ar')) return 'ar';
  return 'en';
};
const savedLang = detectLang();

// UI scale persists across launches (unlike the old fontSize, which always reset).
// Symmetric around the 100% default so the slider midpoint == 100%.
export const UI_SCALE_MIN = 50;
export const UI_SCALE_MAX = 150;
const clampScale = (n: number): number =>
  Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n)));
const savedUiScale = clampScale(parseInt(localStorage.getItem('aegis-ui-scale') || '100', 10) || 100);

// Sidebar mode, migrating the legacy boolean (`aegis-sidebar-collapsed`) → 'mini'.
const readSidebarMode = (): SidebarMode => {
  const m = localStorage.getItem('aegis-sidebar-mode');
  if (m === 'expanded' || m === 'mini' || m === 'hidden') return m;
  return localStorage.getItem('aegis-sidebar-collapsed') === 'true' ? 'mini' : 'expanded';
};
const savedSidebarMode = readSidebarMode();

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: (localStorage.getItem('aegis-theme') || 'system') as 'aegis-dark' | 'aegis-light' | 'system',
  uiScale: savedUiScale,
  sidebarOpen: true,
  sidebarWidth: 280,
  settingsOpen: false,
  language: savedLang,
  notificationsEnabled: localStorage.getItem('aegis-notifications') !== 'false',
  soundEnabled: localStorage.getItem('aegis-sound') !== 'false',
  dndMode: false,
  budgetLimit: parseFloat(localStorage.getItem('aegis-budget-limit') || '0') || 0,
  commandPaletteOpen: false,
  memoryExplorerEnabled: localStorage.getItem('aegis-memory-explorer') === 'true',
  memoryMode: (localStorage.getItem('aegis-memory-mode') || 'local') as 'api' | 'local',
  memoryApiUrl: localStorage.getItem('aegis-memory-api-url') || 'http://localhost:3040',
  memoryLocalPath: localStorage.getItem('aegis-memory-local-path') || '',
  context1mEnabled: localStorage.getItem('aegis-context1m') === 'true',
  toolIntentEnabled: localStorage.getItem('aegis-tool-intent') === 'true',
  audioAutoPlay: localStorage.getItem('aegis-audio-autoplay') === 'true',
  gatewayUrl: localStorage.getItem('aegis-gateway-url') || '',
  gatewayToken: localStorage.getItem('aegis-gateway-token') || '',
  sidebarCollapsed: savedSidebarMode === 'mini',
  sidebarMode: savedSidebarMode,
  accentColor: localStorage.getItem('aegis-accent-color') || 'teal',

  setTheme: (theme) => {
    localStorage.setItem('aegis-theme', theme);
    set({ theme: theme as 'aegis-dark' | 'aegis-light' | 'system' });
    window.aegis?.settings?.save?.('theme', theme).catch?.(() => {});
  },
  setUiScale: (scale) => {
    const v = clampScale(scale);
    localStorage.setItem('aegis-ui-scale', String(v));
    set({ uiScale: v });
    window.aegis?.settings?.save?.('uiScale', v).catch?.(() => {});
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLanguage: (lang) => set({ language: lang }),
  setNotificationsEnabled: (enabled) => { localStorage.setItem('aegis-notifications', String(enabled)); set({ notificationsEnabled: enabled }); },
  setSoundEnabled: (enabled) => { localStorage.setItem('aegis-sound', String(enabled)); set({ soundEnabled: enabled }); },
  setDndMode: (dnd) => set({ dndMode: dnd }),
  setBudgetLimit: (n) => { localStorage.setItem('aegis-budget-limit', String(n)); set({ budgetLimit: n }); },
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setMemoryExplorerEnabled: (enabled) => { localStorage.setItem('aegis-memory-explorer', String(enabled)); set({ memoryExplorerEnabled: enabled }); },
  setMemoryMode: (mode) => { localStorage.setItem('aegis-memory-mode', mode); set({ memoryMode: mode }); },
  setMemoryApiUrl: (url) => { localStorage.setItem('aegis-memory-api-url', url); set({ memoryApiUrl: url }); },
  setMemoryLocalPath: (path) => { localStorage.setItem('aegis-memory-local-path', path); set({ memoryLocalPath: path }); },
  setContext1mEnabled: (enabled) => { localStorage.setItem('aegis-context1m', String(enabled)); set({ context1mEnabled: enabled }); },
  setToolIntentEnabled: (enabled) => { localStorage.setItem('aegis-tool-intent', String(enabled)); set({ toolIntentEnabled: enabled }); },
  setAudioAutoPlay: (enabled) => { localStorage.setItem('aegis-audio-autoplay', String(enabled)); set({ audioAutoPlay: enabled }); },
  setGatewayUrl: (url) => {
    localStorage.setItem('aegis-gateway-url', url);
    set({ gatewayUrl: url });
    window.aegis?.settings?.save?.('gatewayUrl', url).catch?.(() => {});
  },
  setGatewayToken: (token) => {
    localStorage.setItem('aegis-gateway-token', token);
    set({ gatewayToken: token });
    window.aegis?.settings?.save?.('gatewayToken', token).catch?.(() => {});
  },
  setSidebarCollapsed: (collapsed) => {
    const mode: SidebarMode = collapsed ? 'mini' : 'expanded';
    localStorage.setItem('aegis-sidebar-collapsed', String(collapsed));
    localStorage.setItem('aegis-sidebar-mode', mode);
    set({ sidebarCollapsed: collapsed, sidebarMode: mode });
    window.aegis?.settings?.save?.('sidebarCollapsed', collapsed).catch?.(() => {});
  },
  // Three-stage cycle: expanded → mini → hidden → expanded …
  cycleSidebar: () => set((s) => {
    const next: SidebarMode =
      s.sidebarMode === 'expanded' ? 'mini'
        : s.sidebarMode === 'mini' ? 'hidden'
          : 'expanded';
    localStorage.setItem('aegis-sidebar-mode', next);
    localStorage.setItem('aegis-sidebar-collapsed', String(next === 'mini'));
    window.aegis?.settings?.save?.('sidebarCollapsed', next === 'mini').catch?.(() => {});
    return { sidebarMode: next, sidebarCollapsed: next === 'mini' };
  }),
  setAccentColor: (color) => {
    localStorage.setItem('aegis-accent-color', color);
    set({ accentColor: color });
    // Apply CSS override
    const root = document.documentElement;
    const shades = ACCENT_SHADES[color as keyof typeof ACCENT_SHADES];
    if (shades) {
      root.style.setProperty('--aegis-primary', shades[400]);
      root.style.setProperty('--aegis-primary-hover', shades[500]);
      root.style.setProperty('--aegis-primary-deep', shades[600]);
      root.style.setProperty('--aegis-primary-glow', `rgb(${shades.raw400} / 0.16)`);
      root.style.setProperty('--aegis-primary-surface', `rgb(${shades.raw400} / 0.08)`);
    }
  },
}));

// Apply saved accent on load
const savedAccent = localStorage.getItem('aegis-accent-color');
if (savedAccent && savedAccent !== 'teal') {
  useSettingsStore.getState().setAccentColor(savedAccent);
}
