import { create } from 'zustand';
import {
  DEFAULT_SETTING,
  STORAGE_KEY as THEME_STORAGE_KEY,
} from '@/theme/constants';
import {
  AEGIS_FONTS_STORAGE_KEYS,
  isThemeSetting,
  type ThemeSetting,
} from '@/theme/types';
import {
  DEFAULT_ACCENT_COLOR,
  applyAccentColor,
  normalizeAccentColor,
  readPersistedAccentColor,
  type AccentColor,
} from '@/theme/accent';
import { applyTheme } from '@/theme/apply';
import { detectOSPreference, resolveTheme } from '@/theme/resolver';
import { resolveTab, type SidebarTab } from '@/components/Layout/tab-utils';
import {
  applyDocumentLanguage,
  browserDefaultLanguage,
  isAppLanguage,
  persistLanguagePreference,
  type AppLanguage,
} from '@/i18n/languages';
import {
  deleteGatewayDeviceCredential,
  resolveGatewayCredentialRuntimeKey,
  storeGatewayDeviceCredential,
} from '@/services/gateway/credentialProvider';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import { buildFontStack } from '@/utils/fonts';

// ═══════════════════════════════════════════════════════════
// Settings Store
// ═══════════════════════════════════════════════════════════

/** Three-stage sidebar: full → icons-only → fully hidden, cycled by the topbar toggle. */
export type SidebarMode = 'expanded' | 'mini' | 'hidden';

export const AUDIO_AUTO_PLAY_STORAGE_KEY = 'aegis-audio-autoplay';
export const VOICE_AUTO_SPEAK_STORAGE_KEY = 'aegis-voice-auto-speak';

interface SettingsState {
  /** User-selected theme. Concrete themes are derived from {@link AEGIS_THEMES}; `system` follows the OS. */
  theme: ThemeSetting;
  /** Whole-UI scale in percent (80–150). Applied via CSS `zoom` on #app-root. */
  uiScale: number;
  /** UI font family (CSS font stack). Empty string means "use platform default". */
  uiFont: string;
  /** Monospace font family (CSS font stack). Empty string means "use platform default". */
  monoFont: string;
  /** File editor and diff font stack. Empty string means "follow monospace font". */
  editorFont: string;
  terminalFontSize: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  language: AppLanguage;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  dndMode: boolean;
  dynamicIslandEnabled: boolean;
  dynamicIslandAutoExpand: boolean;
  openClawSessionObserverEnabled: boolean;
  budgetLimit: number;
  commandPaletteOpen: boolean;
  context1mEnabled: boolean;
  toolIntentEnabled: boolean;
  audioAutoPlay: boolean;
  voiceAutoSpeak: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  sidebarCollapsed: boolean;
  sidebarMode: SidebarMode;
  /** Explicitly selected sidebar section (decoupled from URL for direct selection). */
  activeSidebarTab: SidebarTab;

  setTheme: (theme: ThemeSetting) => void;
  setUiScale: (scale: number) => void;
  setUiFont: (font: string) => void;
  setMonoFont: (font: string) => void;
  setEditorFont: (font: string) => void;
  setTerminalFontSize: (size: number) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setLanguage: (lang: AppLanguage) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setDndMode: (dnd: boolean) => void;
  setDynamicIslandEnabled: (enabled: boolean) => void;
  setDynamicIslandAutoExpand: (enabled: boolean) => void;
  setOpenClawSessionObserverEnabled: (enabled: boolean) => void;
  setBudgetLimit: (n: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setContext1mEnabled: (enabled: boolean) => void;
  setToolIntentEnabled: (enabled: boolean) => void;
  setAudioAutoPlay: (enabled: boolean) => void;
  setVoiceAutoSpeak: (enabled: boolean) => void;
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  cycleSidebar: () => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
}


// -- applyUiZoom
// Applies UI scale via native webview zoom factor.
// TopBar cancels it for traffic lights (zoom: 100/uiScale).
async function applyUiZoom(scale: number): Promise<void> {
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().setZoom(scale / 100);
  } catch {
    // browser / Storybook: no-op
  }
}

// Auto-detect language on first run: check saved → system language → fallback to English
const detectLang = (): AppLanguage => {
  const saved = localStorage.getItem('aegis-language');
  if (isAppLanguage(saved)) return saved;
  // First run — detect from system/browser language
  const language = browserDefaultLanguage();
  persistLanguagePreference(language);
  return language;
};
const savedLang = detectLang();

for (const key of ['aegis-picovoice-access-key', 'aegis-wake-word', 'aegis-wake-sensitivity']) {
  localStorage.removeItem(key);
}

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

// Read the persisted theme exactly once at store init; fall back to the
// canonical default if storage is empty / unreadable / contains a value
// from a no-longer-supported theme (e.g. after a migration).
const readPersistedTheme = (): ThemeSetting => {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeSetting(raw) ? raw : DEFAULT_SETTING;
  } catch {
    return DEFAULT_SETTING;
  }
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: readPersistedTheme(),
  uiScale: savedUiScale,
  uiFont: buildFontStack(localStorage.getItem(AEGIS_FONTS_STORAGE_KEYS.uiFont) || '', 'ui'),
  monoFont: buildFontStack(localStorage.getItem(AEGIS_FONTS_STORAGE_KEYS.monoFont) || '', 'mono'),
  editorFont: buildFontStack(localStorage.getItem(AEGIS_FONTS_STORAGE_KEYS.editorFont) || '', 'editor'),
  terminalFontSize: Math.min(20, Math.max(10, Number(localStorage.getItem('junqi:terminalFontSize')) || 12)),
  sidebarOpen: true,
  sidebarWidth: 280,
  language: savedLang,
  notificationsEnabled: localStorage.getItem('aegis-notifications') !== 'false',
  soundEnabled: localStorage.getItem('aegis-sound') !== 'false',
  dndMode: localStorage.getItem('aegis-dnd-mode') === 'true',
  dynamicIslandEnabled: localStorage.getItem('junqi:dynamic-island-enabled') !== 'false',
  dynamicIslandAutoExpand: localStorage.getItem('junqi:dynamic-island-auto-expand') !== 'false',
  openClawSessionObserverEnabled: localStorage.getItem('junqi:openclaw-session-observer-enabled') === 'true',
  budgetLimit: parseFloat(localStorage.getItem('aegis-budget-limit') || '0') || 0,
  commandPaletteOpen: false,
  context1mEnabled: localStorage.getItem('aegis-context1m') === 'true',
  toolIntentEnabled: localStorage.getItem('aegis-tool-intent') === 'true',
  audioAutoPlay: localStorage.getItem(AUDIO_AUTO_PLAY_STORAGE_KEY) === 'true',
  voiceAutoSpeak: localStorage.getItem(VOICE_AUTO_SPEAK_STORAGE_KEY) === 'true',
  gatewayUrl: localStorage.getItem('aegis-gateway-url') || '',
  // Gateway 凭据只在 runtime 目标确认后通过原生凭据边界恢复，浏览器存储不承载凭据。
  gatewayToken: '',
  sidebarCollapsed: savedSidebarMode === 'mini',
  sidebarMode: savedSidebarMode,
  activeSidebarTab: (typeof window !== 'undefined' && window.location) ? resolveTab(window.location.pathname) : 'workbench',
  accentColor: readPersistedAccentColor() ?? DEFAULT_ACCENT_COLOR,

  setTheme: (theme) => {
    if (!isThemeSetting(theme)) return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    set({ theme });
    const resolvedTheme = resolveTheme(theme, detectOSPreference());
    applyTheme(resolvedTheme, theme);
    // Notify same-document listeners; companion windows also observe the
    // persisted theme through localStorage.
    window.dispatchEvent(new CustomEvent('aegis:theme-changed', { detail: { theme, resolvedTheme } }));
  },
  setUiScale: (scale) => {
    const v = clampScale(scale);
    localStorage.setItem('aegis-ui-scale', String(v));
    set({ uiScale: v });
    void applyUiZoom(v);
  },
  setUiFont: (font) => {
    const next = buildFontStack(font, 'ui');
    localStorage.setItem(AEGIS_FONTS_STORAGE_KEYS.uiFont, next);
    set({ uiFont: next });
    if (next) {
      document.documentElement.style.setProperty('--font-ui', next);
      document.documentElement.style.setProperty('--font-sans', next);
    } else {
      document.documentElement.style.removeProperty('--font-ui');
      document.documentElement.style.removeProperty('--font-sans');
    }
  },
  setMonoFont: (font) => {
    const next = buildFontStack(font, 'mono');
    localStorage.setItem(AEGIS_FONTS_STORAGE_KEYS.monoFont, next);
    set({ monoFont: next });
    if (next) document.documentElement.style.setProperty('--font-mono', next);
    else document.documentElement.style.removeProperty('--font-mono');
  },
  setEditorFont: (font) => {
    const next = buildFontStack(font, 'editor');
    localStorage.setItem(AEGIS_FONTS_STORAGE_KEYS.editorFont, next);
    set({ editorFont: next });
    if (next) document.documentElement.style.setProperty('--font-editor', next);
    else document.documentElement.style.removeProperty('--font-editor');
  },
  setTerminalFontSize: (size) => {
    const next = Math.min(20, Math.max(10, Math.round(size)));
    localStorage.setItem('junqi:terminalFontSize', String(next));
    set({ terminalFontSize: next });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setLanguage: (lang) => {
    if (!isAppLanguage(lang)) return;
    persistLanguagePreference(lang);
    applyDocumentLanguage(lang);
    set({ language: lang });
  },
  setNotificationsEnabled: (enabled) => { localStorage.setItem('aegis-notifications', String(enabled)); set({ notificationsEnabled: enabled }); },
  setSoundEnabled: (enabled) => { localStorage.setItem('aegis-sound', String(enabled)); set({ soundEnabled: enabled }); },
  setDndMode: (dnd) => { localStorage.setItem('aegis-dnd-mode', String(dnd)); set({ dndMode: dnd }); },
  setDynamicIslandEnabled: (enabled) => { localStorage.setItem('junqi:dynamic-island-enabled', String(enabled)); set({ dynamicIslandEnabled: enabled }); },
  setDynamicIslandAutoExpand: (enabled) => { localStorage.setItem('junqi:dynamic-island-auto-expand', String(enabled)); set({ dynamicIslandAutoExpand: enabled }); },
  setOpenClawSessionObserverEnabled: (enabled) => { localStorage.setItem('junqi:openclaw-session-observer-enabled', String(enabled)); set({ openClawSessionObserverEnabled: enabled }); },
  setBudgetLimit: (n) => { localStorage.setItem('aegis-budget-limit', String(n)); set({ budgetLimit: n }); },
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setContext1mEnabled: (enabled) => { localStorage.setItem('aegis-context1m', String(enabled)); set({ context1mEnabled: enabled }); },
  setToolIntentEnabled: (enabled) => { localStorage.setItem('aegis-tool-intent', String(enabled)); set({ toolIntentEnabled: enabled }); },
  setAudioAutoPlay: (enabled) => { localStorage.setItem(AUDIO_AUTO_PLAY_STORAGE_KEY, String(enabled)); set({ audioAutoPlay: enabled }); },
  setVoiceAutoSpeak: (enabled) => { localStorage.setItem(VOICE_AUTO_SPEAK_STORAGE_KEY, String(enabled)); set({ voiceAutoSpeak: enabled }); },
  setGatewayUrl: (url) => {
    localStorage.setItem('aegis-gateway-url', url);
    set({ gatewayUrl: url });
  },
  setGatewayToken: (token) => {
    const normalized = token.trim();
    set({ gatewayToken: normalized });
    const runtimeKey = resolveGatewayCredentialRuntimeKey(
      get().gatewayUrl || defaultGatewayWsUrl(),
    );
    if (normalized) {
      void storeGatewayDeviceCredential(runtimeKey, normalized);
    } else {
      void deleteGatewayDeviceCredential(runtimeKey);
    }
  },
  setSidebarCollapsed: (collapsed) => {
    const mode: SidebarMode = collapsed ? 'mini' : 'expanded';
    localStorage.setItem('aegis-sidebar-collapsed', String(collapsed));
    localStorage.setItem('aegis-sidebar-mode', mode);
    set({ sidebarCollapsed: collapsed, sidebarMode: mode });
  },
  // Three-stage cycle: expanded → mini → hidden → expanded …
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  cycleSidebar: () => set((s) => {
    const next: SidebarMode =
      s.sidebarMode === 'expanded' ? 'mini'
        : s.sidebarMode === 'mini' ? 'hidden'
          : 'expanded';
    localStorage.setItem('aegis-sidebar-mode', next);
    localStorage.setItem('aegis-sidebar-collapsed', String(next === 'mini'));
    return { sidebarMode: next, sidebarCollapsed: next === 'mini' };
  }),
  setAccentColor: (color) => {
    const normalized = normalizeAccentColor(color);
    localStorage.setItem('aegis-accent-color', normalized);
    set({ accentColor: normalized });
    applyAccentColor(normalized);
  },
}));

// WebViews share persistent storage but have separate Zustand instances.
// Mirror voice-related changes so an already-open Quick Chat observes them.
export function syncVoiceSettingFromStorage(key: string | null, newValue: string | null): void {
  if (key === AUDIO_AUTO_PLAY_STORAGE_KEY) {
    useSettingsStore.setState({ audioAutoPlay: newValue === 'true' });
  } else if (key === VOICE_AUTO_SPEAK_STORAGE_KEY) {
    useSettingsStore.setState({ voiceAutoSpeak: newValue === 'true' });
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    syncVoiceSettingFromStorage(event.key, event.newValue);
  });
}

// Apply saved accent on load
const savedAccent = readPersistedAccentColor();
if (savedAccent) applyAccentColor(savedAccent);

// Restore saved UI zoom on load (savedUiScale already clamped above).
// 100 is the default — skip the setZoom(1.0) no-op on every cold start.
if (savedUiScale !== 100) {
  void applyUiZoom(savedUiScale);
}
