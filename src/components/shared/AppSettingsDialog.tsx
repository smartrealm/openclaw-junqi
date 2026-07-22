// ── AppSettingsDialog — 1:1 junqi modal settings ─────────────────────────────
//
// Full settings modal with 11-panel sidebar nav:
//   Application: General, Theme, Fonts, Shortcuts
//   Connectivity: Connect, Notifications, Pet
//   Agents: Hooks, Claude Code, Codex
//   About
//
// Backed by useSettingsStore, useChatStore, usePetStore, and Tauri backend.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Globe, Monitor, Zap, Info, Code,
  Save, RefreshCw, ExternalLink, Loader2,
  Sun, Moon, Eye, Palette, Type, Keyboard,
  Wifi, Bell, BellOff, Volume2, VolumeX, PawPrint,
  CheckCircle2, AlertCircle, Upload, Trash2, Blocks, FolderOpen, RotateCcw, Timer,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { setThemeWithTransition } from '@/motion/themeTransition';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { notifications } from '@/services/notifications';
import { PET_SKIN_OPTIONS } from '@/pet/skins';
import { SkinPreview } from '@/pet/SkinPreview';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { changeLanguage } from '@/i18n';
import type { AegisTheme } from '@/theme/types';
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from '@/i18n/languages';
import { StatusDot } from '@/components/shared/StatusDot';
import { APP_VERSION } from '@/version';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import clsx from 'clsx';
import {
  readAttentionBadge,
  readTaskDisplayWindow,
  TASK_DISPLAY_WINDOWS,
  type TaskDisplayWindow,
  writeAttentionBadge,
  writeTaskDisplayWindow,
} from '@/workspace/agentWorkspacePreferences';

// ── Nav ─────────────────────────────────────────────────────────────────────

type NavSection = 'application' | 'connectivity' | 'agents' | 'about';
type NavKey = 'general' | 'theme' | 'fonts' | 'shortcuts' | 'skills' | 'connect' | 'notify' | 'pet' | 'hooks' | 'claude' | 'codex' | 'about';

interface NavItem { key: NavKey; label: string; icon: React.ReactNode; section: NavSection; }

const SECTION_ORDER: NavSection[] = ['application', 'connectivity', 'agents', 'about'];
const THEME_I18N: Record<AegisTheme, string> = { 'aegis-dark': 'theme.dark', 'aegis-light': 'theme.light', 'aegis-eyecare': 'theme.eyecare', 'aegis-midnight': 'theme.midnight' };

// ── Shell ───────────────────────────────────────────────────────────────────

export interface AppSettingsDialogProps { onClose: () => void; }

export function AppSettingsDialog({ onClose }: AppSettingsDialogProps) {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState<NavKey>('general');
  const sectionLabels: Record<NavSection, string> = {
    application: t('appSettings.sectionApplication', 'Application'),
    connectivity: t('appSettings.sectionConnectivity', 'Connectivity'),
    agents: t('appSettings.sectionAgents', 'Agents'),
    about: t('appSettings.sectionAbout', 'About'),
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const navItems: NavItem[] = [
    { key: 'general', label: t('appSettings.general', 'General'), icon: <Globe size={14} />, section: 'application' },
    { key: 'theme', label: t('appSettings.theme', 'Theme'), icon: <Palette size={14} />, section: 'application' },
    { key: 'fonts', label: t('appSettings.fonts', 'Fonts'), icon: <Type size={14} />, section: 'application' },
    { key: 'shortcuts', label: t('appSettings.shortcuts', 'Shortcuts'), icon: <Keyboard size={14} />, section: 'application' },
    { key: 'skills', label: t('skill.settings.navLabel', 'Skills'), icon: <Blocks size={14} />, section: 'application' },
    { key: 'connect', label: t('appSettings.connect', 'Connect'), icon: <Wifi size={14} />, section: 'connectivity' },
    { key: 'notify', label: t('appSettings.notify', 'Notifications'), icon: <Bell size={14} />, section: 'connectivity' },
    { key: 'pet', label: t('appSettings.pet', 'Pet'), icon: <PawPrint size={14} />, section: 'connectivity' },
    { key: 'hooks', label: t('appSettings.hooks', 'Hooks'), icon: <Zap size={14} />, section: 'agents' },
    { key: 'claude', label: 'Claude Code', icon: <Code size={14} />, section: 'agents' },
    { key: 'codex', label: 'Codex', icon: <Code size={14} />, section: 'agents' },
    { key: 'about', label: t('appSettings.about', 'About'), icon: <Info size={14} />, section: 'about' },
  ];

  const grouped = useMemo(() => {
    const out: Record<NavSection, NavItem[]> = { application: [], connectivity: [], agents: [], about: [] };
    for (const item of navItems) out[item.section].push(item);
    return out;
  }, [navItems]);

  return (
    <div className="fixed inset-0 z-[2147481000] flex items-center justify-center" style={{ background: 'rgb(0 0 0 / 0.55)' }} onClick={onClose}>
      <div className="w-[min(960px,calc(100vw-48px))] max-h-[calc(100vh-96px)] rounded-2xl overflow-hidden flex"
        style={{ background: 'rgb(var(--aegis-card))', border: '1px solid rgb(var(--aegis-border))', boxShadow: '0 32px 64px rgb(0 0 0 / 0.5)' }}
        onClick={(e) => e.stopPropagation()}>
        <aside className="w-[200px] flex flex-col border-r" style={{ background: 'rgb(var(--aegis-surface))', borderColor: 'rgb(var(--aegis-border))' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
            <span className="text-[13px] font-bold text-aegis-text">{t('settings.title')}</span>
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim"><X size={14} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
            {SECTION_ORDER.map((section) => (
              <div key={section} className="flex flex-col gap-0.5 mb-2">
                <div className="text-[9.5px] font-bold uppercase tracking-wider px-2 pt-1 pb-1" style={{ color: 'rgb(var(--aegis-text-dim))' }}>{sectionLabels[section]}</div>
                {grouped[section].map((item) => {
                  const active = activeNav === item.key;
                  return <button key={item.key} type="button" onClick={() => setActiveNav(item.key)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-start transition-colors"
                    style={{ background: active ? 'rgb(var(--aegis-overlay) / 0.12)' : 'transparent', color: active ? 'rgb(var(--aegis-text))' : 'rgb(var(--aegis-text-secondary))', fontWeight: active ? 600 : 500 }}>
                    {item.icon}<span>{item.label}</span>
                  </button>;
                })}
              </div>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto">
          {activeNav === 'general' && <GeneralPanel />}
          {activeNav === 'theme' && <ThemePanel />}
          {activeNav === 'fonts' && <FontsPanel />}
          {activeNav === 'shortcuts' && <ShortcutsPanel />}
          {activeNav === 'skills' && <SkillsPanel />}
          {activeNav === 'connect' && <ConnectPanel />}
          {activeNav === 'notify' && <NotifyPanel />}
          {activeNav === 'pet' && <PetPanel />}
          {activeNav === 'hooks' && <HooksPanel />}
          {activeNav === 'claude' && <ClaudeCodePanel />}
          {activeNav === 'codex' && <CodexPanel />}
          {activeNav === 'about' && <AboutPanel />}
        </main>
      </div>
    </div>
  );
}

interface SkillHubConfig {
  hubPath?: string | null;
}

function SkillsPanel() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SkillHubConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<SkillHubConfig>('get_skill_hub_config')
      .then((next) => { if (!cancelled) setConfig(next); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);

  const notifyChanged = () => window.dispatchEvent(new Event('junqi:skill-hub-changed'));
  const chooseHub = async () => {
    setError(null);
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string') return;
    setBusy(true);
    try {
      const result = await invoke<{ config: SkillHubConfig }>('set_skill_hub_path', { path: selected });
      setConfig(result.config);
      notifyChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const clearHub = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke('clear_skill_hub');
      setConfig(null);
      notifyChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const hubPath = config?.hubPath ?? '';
  return (
    <div className="p-6">
      <h2 className="mb-1 text-[16px] font-bold text-aegis-text">{t('skill.settings.navLabel', 'Skills')}</h2>
      <p className="mb-5 text-[12px] text-aegis-text-dim">{t('skill.settings.hubPathHint', 'Choose the folder that stores shared skills.')}</p>
      <label className="mb-1.5 block text-[11px] font-semibold text-aegis-text-secondary">{t('skill.settings.hubPath', 'Skill hub path')}</label>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-md border border-aegis-border bg-aegis-input px-3 py-2 font-mono text-[12px] text-aegis-text" title={hubPath}>
          {hubPath || <span className="font-sans text-aegis-text-dim">{t('skill.settings.notConfigured', 'Not configured')}</span>}
        </div>
        <button type="button" onClick={() => void chooseHub()} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[12px] text-aegis-text-secondary hover:bg-aegis-hover disabled:opacity-50">
          <FolderOpen size={13} />{t('skill.settings.choose', 'Choose')}
        </button>
        {hubPath && (
          <button type="button" title={t('skill.settings.reset', 'Reset')} onClick={() => void clearHub()} disabled={busy} className="flex h-9 w-9 items-center justify-center rounded-md border border-aegis-border text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-50">
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      {error && <div className="mt-3 text-[12px] text-aegis-danger" role="alert">{error}</div>}
    </div>
  );
}

// ── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button onClick={() => !disabled && onChange(!enabled)} className={clsx('w-[42px] h-[24px] rounded-full relative transition-all shrink-0 border', enabled ? 'bg-aegis-primary/30 border-aegis-primary/40' : 'bg-[rgb(var(--aegis-overlay)/0.08)] border-[rgb(var(--aegis-overlay)/0.1)]', disabled && 'opacity-50 cursor-not-allowed')}>
    <div className={clsx('absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all duration-300', enabled ? 'left-[21px] bg-aegis-primary shadow-[0_0_8px_rgb(var(--aegis-primary)/0.5)]' : 'left-[2px] bg-[rgb(var(--aegis-overlay)/0.3)]')} />
  </button>;
}

// ── Panels ─────────────────────────────────────────────────────────────────

function GeneralPanel() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [terminalScrollback, setTerminalScrollback] = useState(1000);
  const [savingScrollback, setSavingScrollback] = useState(false);
  const [taskDisplayWindow, setTaskDisplayWindow] = useState<TaskDisplayWindow>(readTaskDisplayWindow);
  const [attentionBadge, setAttentionBadge] = useState(readAttentionBadge);
  useEffect(() => {
    let cancelled = false;
    void invoke<{ terminal_scrollback?: number }>('load_app_settings').then((settings) => {
      if (!cancelled) setTerminalScrollback(settings.terminal_scrollback ?? 1000);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const saveScrollback = async (value: number) => {
    const next = Math.round(Math.min(5000, Math.max(500, value)) / 500) * 500;
    setTerminalScrollback(next);
    setSavingScrollback(true);
    try {
      await invoke('save_terminal_scrollback', { scrollback: next });
      window.dispatchEvent(new Event('junqi:app-settings-changed'));
    } finally { setSavingScrollback(false); }
  };
  const handleLanguageChange = (lang: AppLanguage) => {
    setLanguage(lang);
    changeLanguage(lang);
  };
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.general', 'General')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-6">{t('appSettings.generalDesc', 'Application-wide preferences.')}</p>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('settings.language')}</label>
          <select value={language} onChange={(e) => handleLanguageChange(e.target.value as AppLanguage)}
            className="px-3 py-2 rounded-md text-[13px] w-[200px]" style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }}>
            {APP_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-aegis-text-dim mt-1">{t('appSettings.languageHint', 'Applies immediately.')}</p>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('appSettings.terminalScrollback', 'Terminal scrollback')}</label>
          <div className="flex items-center gap-2">
            <input type="number" min={500} max={5000} step={500} value={terminalScrollback}
              disabled={savingScrollback}
              onChange={(event) => setTerminalScrollback(Number(event.target.value))}
              onBlur={() => void saveScrollback(terminalScrollback)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveScrollback(terminalScrollback); } }}
              className="w-28 rounded-md px-3 py-2 text-[13px] font-mono"
              style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
            <span className="text-[11px] text-aegis-text-dim">{t('appSettings.lines', 'lines')}</span>
            {savingScrollback && <Loader2 size={12} className="animate-spin text-aegis-text-dim" />}
          </div>
          <p className="mt-1 text-[11px] text-aegis-text-dim">{t('appSettings.terminalScrollbackHint', '500–5000 lines. Applies to newly opened terminals.')}</p>
          {terminalScrollback > 3000 && <p className="mt-1 text-[11px] text-aegis-warning">{t('appSettings.terminalScrollbackWarning', 'Large buffers use more memory.')}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-aegis-text-secondary">任务展示范围</label>
          <select
            value={taskDisplayWindow}
            onChange={(event) => {
              const value = event.target.value === 'all' ? 'all' : Number(event.target.value) as TaskDisplayWindow;
              setTaskDisplayWindow(value);
              writeTaskDisplayWindow(value);
            }}
            className="w-[200px] rounded-md border border-aegis-border bg-aegis-input px-3 py-2 text-[13px] text-aegis-text"
          >
            {TASK_DISPLAY_WINDOWS.map((value) => <option key={value} value={value}>{value === 'all' ? '全部' : `${value} 天`}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-aegis-text-dim">限制普通历史任务的展示时间，需要关注、待合并、收藏和待办任务始终显示。</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold text-aegis-text-secondary">待确认角标</div>
            <p className="mt-1 text-[11px] text-aegis-text-dim">在项目栏显示等待输入或审阅的任务数量。</p>
          </div>
          <Toggle enabled={attentionBadge} onChange={(enabled) => {
            setAttentionBadge(enabled);
            writeAttentionBadge(enabled);
          }} />
        </div>
      </div>
    </div>
  );
}

function ThemePanel() {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const followSystem = theme === 'system';
  const THEME_PRESETS: AegisTheme[] = ['aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare'];
  const icons: Record<string, React.ReactNode> = { 'aegis-dark': <Moon size={14} />, 'aegis-light': <Sun size={14} />, 'aegis-eyecare': <Eye size={14} />, 'aegis-midnight': <Moon size={14} /> };
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.theme', 'Theme')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('appSettings.themeDesc', 'Choose how JunQi looks.')}</p>
      <label className="flex items-center gap-3 mb-5 p-3 rounded-xl cursor-pointer transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.03)]"
        style={{ background: followSystem ? 'rgb(var(--aegis-primary) / 0.06)' : 'transparent', border: followSystem ? '1px solid rgb(var(--aegis-primary) / 0.2)' : '1px solid transparent' }}>
        <input type="checkbox" checked={followSystem} onChange={(event) => setThemeWithTransition(followSystem ? 'aegis-dark' : 'system', event.currentTarget)} className="w-4 h-4 rounded accent-aegis-primary" />
        <div><div className="text-[12px] font-semibold text-aegis-text">{t('theme.followSystem', 'Follow System')}</div><div className="text-[11px] text-aegis-text-dim">{t('theme.followSystemDesc', 'Match your OS light/dark preference.')}</div></div>
      </label>
      <div className="grid grid-cols-2 gap-3">
        {THEME_PRESETS.map((key) => {
          const active = theme === key;
          return <button key={key} type="button" onClick={(event) => setThemeWithTransition(key, event.currentTarget)}
            className="flex flex-col gap-2 p-3 rounded-xl text-start transition-all relative overflow-hidden"
            style={{ border: active ? '2px solid rgb(var(--aegis-primary))' : '1px solid rgb(var(--aegis-border))', background: 'rgb(var(--aegis-surface))', boxShadow: active ? '0 0 0 1px rgb(var(--aegis-primary) / 0.3)' : 'none' }}>
            <div className="w-full h-10 rounded-md" style={{ background: key === 'aegis-dark' ? 'linear-gradient(135deg, #0c1015, #1a2332)' : key === 'aegis-midnight' ? 'linear-gradient(135deg, #050510, #0d1b2a)' : key === 'aegis-light' ? 'linear-gradient(135deg, #f8fafc, #e2e8f0)' : 'linear-gradient(135deg, #f5f0e8, #e8dcc8)' }} />
            <div className="flex items-center gap-2">
              <span className="text-aegis-text-dim">{icons[key]}</span>
              <span className="text-[12px] font-semibold text-aegis-text">{t(THEME_I18N[key], key.replace('aegis-', ''))}</span>
              {active && <span className="ml-auto w-2 h-2 rounded-full" style={{ background: 'rgb(var(--aegis-primary))' }} />}
            </div>
          </button>;
        })}
      </div>
    </div>
  );
}

function FontsPanel() {
  const { t } = useTranslation();
  const uiFont = useSettingsStore((s) => s.uiFont);
  const monoFont = useSettingsStore((s) => s.monoFont);
  const setUiFont = useSettingsStore((s) => s.setUiFont);
  const setMonoFont = useSettingsStore((s) => s.setMonoFont);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const apply = (key: string, value: string, setter: (v: string) => void) => { localStorage.setItem(key, value); setter(value); };
  const suggestions = ['', 'Inter', 'SF Pro', 'IBM Plex Sans', 'Geist', 'Manrope'];
  const monoSuggestions = ['', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'IBM Plex Mono'];
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.fonts', 'Fonts')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('appSettings.fontsDesc', 'Customize UI and code font families.')}</p>
      <div className="mb-4">
        <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('font.terminalFontSize', 'Terminal font size')}</label>
        <div className="flex items-center gap-2">
          <input type="number" min={10} max={20} step={1} value={terminalFontSize}
            onChange={(event) => setTerminalFontSize(Number(event.target.value))}
            className="w-24 rounded-md px-3 py-2 text-[13px] font-mono"
            style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
          <span className="text-[11px] text-aegis-text-dim">px</span>
        </div>
        <p className="mt-1 text-[11px] text-aegis-text-dim">{t('font.terminalFontSizeHint', 'Applies to terminal panels only. Range: 10–20px.')}</p>
      </div>
      {[[t('appSettings.uiFont', 'UI Font'), 'aegis-font-ui', uiFont, setUiFont, suggestions], [t('appSettings.monoFont', 'Mono Font'), 'aegis-font-mono', monoFont, setMonoFont, monoSuggestions]].map(([label, key, value, setter, list]: any[]) => (
        <div key={key} className="mb-4">
          <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{label}</label>
          <input value={value} onChange={(e) => apply(key, e.target.value, setter)} placeholder={t('appSettings.systemDefault', 'system default')} spellCheck={false}
            className="px-3 py-2 rounded-md text-[13px] font-mono w-full mb-1.5" style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
          <div className="flex flex-wrap gap-1">
            {list.map((s: string) => <button key={s} type="button" onClick={() => apply(key, s ? `'${s}', sans-serif` : '', setter)}
              className="px-2 py-1 rounded-md text-[10px] transition-colors"
              style={{ background: value === (s ? `'${s}', sans-serif` : '') ? 'rgb(var(--aegis-primary)/0.12)' : 'rgb(var(--aegis-overlay)/0.03)', color: value === (s ? `'${s}', sans-serif` : '') ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))', border: value === (s ? `'${s}', sans-serif` : '') ? '1px solid rgb(var(--aegis-primary)/0.2)' : '1px solid transparent' }}>
              {s || t('appSettings.default', 'Default')}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ShortcutsPanel() {
  const { t } = useTranslation();
  const [send, setSend] = useState('mod_enter');
  const [shiftEnter, setShiftEnter] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadedSettings, setLoadedSettings] = useState<Record<string, unknown>>({});
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');
  useEffect(() => { let c = false; invoke<Record<string, unknown> & {send_shortcut?:string;terminal_shift_enter_newline?:boolean}>('load_app_settings').then(s => { if(!c){ setLoadedSettings(s); setSend(s.send_shortcut||'mod_enter'); setShiftEnter(s.terminal_shift_enter_newline??true); } }).catch(()=>{}).finally(()=>{ if(!c) setLoading(false); }); return ()=>{c=true}; }, []);
  const save = async () => { setSaving(true); try { const settings = {...loadedSettings,send_shortcut:send,terminal_shift_enter_newline:shiftEnter}; await invoke('save_app_settings',{settings}); setLoadedSettings(settings); window.dispatchEvent(new Event('junqi:app-settings-changed')); setSaved(true); setTimeout(()=>setSaved(false),1500); } catch {} finally { setSaving(false); } };
  return loading ? <div className="p-6"><Loader2 size={14} className="animate-spin text-aegis-text-dim"/></div> : (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.shortcuts', 'Shortcuts')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('appSettings.shortcutsDesc', 'Customize keyboard shortcuts.')}</p>
      <div className="flex flex-col gap-4">
        <div><label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('appSettings.sendPromptShortcut', 'Send prompt shortcut')}</label>
          <select value={send} onChange={e=>setSend(e.target.value)} className="px-3 py-2 rounded-md text-[13px] w-[240px]" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}>
            <option value="mod_enter">{isMac?'⌘+Enter':'Ctrl+Enter'}</option><option value="enter">{t('appSettings.enter', 'Enter')}</option></select></div>
        <div><label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('appSettings.terminalNewline', 'Terminal newline')}</label>
          <div className="flex items-center gap-2"><Toggle enabled={shiftEnter} onChange={setShiftEnter}/><span className="text-[12px] text-aegis-text-dim">{t('appSettings.shiftEnterNewline', 'Shift+Enter inserts newline')}</span></div></div>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all w-fit" style={{background:'rgb(var(--aegis-primary))',color:'rgb(var(--aegis-on-primary))',opacity:saving?0.5:1}}>
          {saved?<CheckCircle2 size={13}/>:<Save size={13}/>}{saving?t('appSettings.saving', 'Saving…'):saved?t('appSettings.saved', 'Saved'):t('appSettings.save', 'Save')}</button>
      </div>
    </div>
  );
}

function ConnectPanel() {
  const { t } = useTranslation();
  const { connected, connecting } = useChatStore();
  const gatewayUrl = useSettingsStore((s) => s.gatewayUrl);
  const setGatewayUrl = useSettingsStore((s) => s.setGatewayUrl);
  const setGatewayToken = useSettingsStore((s) => s.setGatewayToken);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState('');
  const [tokenDirty, setTokenDirty] = useState(false);
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean|null>(null);
  const dirty = editUrl !== gatewayUrl || tokenDirty;
  useEffect(() => {
    let cancelled = false;
    void window.aegis?.pairing?.getToken(gatewayUrl.trim() || undefined).then((token) => {
      if (!cancelled) setHasStoredToken(Boolean(token));
    }).catch(() => {
      if (!cancelled) setHasStoredToken(false);
    });
    return () => { cancelled = true; };
  }, [gatewayUrl]);
  const resolveTarget = async () => {
    const url = editUrl.trim();
    if (url) {
      if (tokenDirty) return { url, token: editToken.trim(), deviceToken: '' };
      const config = await window.aegis?.config?.get();
      const configUrl = config?.gatewayUrl || config?.gatewayWsUrl || '';
      const splitCredentials = config
        && ('gatewayBootstrapToken' in config || 'gatewayDeviceToken' in config);
      const sameTarget = url === configUrl;
      const storedDeviceToken = await window.aegis?.pairing?.getToken(url) || '';
      return {
        url,
        token: sameTarget
          ? (config?.gatewayBootstrapToken ?? (!splitCredentials ? config?.gatewayToken : '') ?? '')
          : '',
        deviceToken: sameTarget ? (config?.gatewayDeviceToken || storedDeviceToken) : storedDeviceToken,
      };
    }
    const config = await window.aegis?.config?.get();
    return {
      url: config?.gatewayUrl || config?.gatewayWsUrl || defaultGatewayWsUrl(),
      token: tokenDirty
        ? editToken.trim()
        : config?.gatewayBootstrapToken ?? config?.gatewayToken ?? '',
      deviceToken: tokenDirty ? '' : config?.gatewayDeviceToken ?? '',
    };
  };
  const handleSave = async () => {
    setGatewayUrl(editUrl.trim());
    if (tokenDirty) setGatewayToken(editToken.trim());
    const { url, token, deviceToken } = await resolveTarget();
    setEditToken('');
    setTokenDirty(false);
    setHasStoredToken(Boolean(token || deviceToken));
    gatewayManager.connect(url, token, deviceToken);
  };
  const handleTest = async () => {
    setTesting(true);
    setTestOk(null);
    try {
      const { url, token, deviceToken } = await resolveTarget();
      gatewayManager.connect(url, token, deviceToken);
      await new Promise(r=>setTimeout(r,2500));
      setTestOk(useChatStore.getState().connected);
    } catch {
      setTestOk(false);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.connect', 'Connect')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('settings.gateway', 'Gateway')}</p>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-aegis-text">{t('settingsExtra.connectionStatus')}</span>
        <span className="flex items-center gap-1.5 text-[12px]"><StatusDot status={connected?'active':connecting?'idle':'error'} size={7}/>
          <span className={connected?'text-aegis-success':connecting?'text-aegis-warning':'text-aegis-danger'}>{connected?t('connection.connected'):connecting?t('connection.connecting'):t('connection.disconnected')}</span></span>
      </div>
      <div className="flex flex-col gap-3">
        <div><label className="text-[11px] text-aegis-text-dim mb-1 block">{t('appSettings.webSocketUrl', 'WebSocket URL')}</label><input value={editUrl} onChange={e=>{setEditUrl(e.target.value);setEditToken('');setTokenDirty(false);setHasStoredToken(false);}} placeholder={defaultGatewayWsUrl()} className="w-full px-3 py-2 rounded-md text-[13px] font-mono" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}/></div>
        <div><label className="text-[11px] text-aegis-text-dim mb-1 block">{t('appSettings.token', 'Token')}</label><div className="flex items-center gap-2"><input type="password" value={editToken} onChange={e=>{setEditToken(e.target.value);setTokenDirty(true);}} placeholder={hasStoredToken?t('settingsExtra.tokenStoredPlaceholder','Stored securely; enter a replacement'):'••••••••'} className="min-w-0 flex-1 px-3 py-2 rounded-md text-[13px] font-mono" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}/>{hasStoredToken&&!tokenDirty&&<button type="button" onClick={()=>{setEditToken('');setTokenDirty(true);setHasStoredToken(false);}} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-dim hover:text-aegis-danger" title={t('settingsExtra.clearGatewayToken','Clear saved token')} aria-label={t('settingsExtra.clearGatewayToken','Clear saved token')}><Trash2 size={14}/></button>}</div></div>
        <div className="flex items-center gap-2">
          {dirty && <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-aegis-primary/15 text-aegis-primary border border-aegis-primary/25">{t('appSettings.saveReconnect', 'Save & Reconnect')}</button>}
          <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{testing?<Loader2 size={13} className="animate-spin"/>:<Wifi size={13}/>}{t('settings.testConnection')}</button>
          {testOk !== null && (
            <span className={testOk ? 'text-aegis-success' : 'text-aegis-danger'}>
              {testOk ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NotifyPanel() {
  const { t } = useTranslation();
  const dndMode = useSettingsStore((s) => s.dndMode);
  const setDndMode = useSettingsStore((s) => s.setDndMode);
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.notify', 'Notifications')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('settings.notificationsDesc')}</p>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div><div className="text-[13px] text-aegis-text">{t('settings.enableNotifications')}</div></div>
          <Toggle enabled={useSettingsStore((s)=>s.notificationsEnabled)} onChange={(v)=>{useSettingsStore.getState().setNotificationsEnabled(v);notifications.setEnabled(v);}} />
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-[13px] text-aegis-text flex items-center gap-2">{useSettingsStore((s)=>s.soundEnabled)?<Volume2 size={14}/>:<VolumeX size={14}/>}{t('settings.sound')}</div></div>
          <Toggle enabled={useSettingsStore((s)=>s.soundEnabled)} onChange={(v)=>{useSettingsStore.getState().setSoundEnabled(v);notifications.setSoundEnabled(v);}} />
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-[13px] text-aegis-text flex items-center gap-2"><BellOff size={14}/>{t('settings.dnd')}</div></div>
          <Toggle enabled={dndMode} onChange={(v)=>{setDndMode(v);notifications.setDndMode(v);}} />
        </div>
        <button onClick={()=>notifications.notify({type:'info',title:'JunQi Desktop',body:t('settings.testNotification')})}
          className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-aegis-border/20 px-4 py-2 text-[12px] text-aegis-text-dim transition-colors hover:border-aegis-border/40 hover:text-aegis-text"><Bell size={13} aria-hidden="true" />{t('settings.testSound')}</button>
      </div>
    </div>
  );
}

function PetPanel() {
  const { t, i18n } = useTranslation();
  const { enabled:petEnabled,setEnabled:setPetEnabled,skin:petSkin,setSkin:setPetSkin,customAsset:petCustomAsset,setCustomAsset:setPetCustomAsset,customPet,setCustomPet,pomodoro:petPomodoro,setPomodoro:setPetPomodoro,petVisible,backdropContrastEnabled,setBackdropContrastEnabled,captionScale:petCaptionScale,setCaptionScale:setPetCaptionScale } = usePetStore();
  const [uploadErr,setUploadErr]=useState<string|null>(null);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!petPomodoro.running||petPomodoro.paused)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[petPomodoro.running,petPomodoro.paused]);
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('pet.settings.title')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('pet.settings.enabledHint')}</p>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.enabled')}</div></div><Toggle enabled={petEnabled} onChange={setPetEnabled}/></div>
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.backdropContrast')}</div><div className="text-[11px] text-aegis-text-dim">{t('pet.settings.backdropContrastHint')}</div></div><Toggle enabled={backdropContrastEnabled} onChange={setBackdropContrastEnabled}/></div>
        <div><div className="flex items-center justify-between gap-3"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.captionScale','提示文字大小')}</div><div className="text-[11px] text-aegis-text-dim">{t('pet.settings.captionScaleHint','调整萌宠状态与提示文字的显示大小')}</div></div><span className="font-mono text-xs text-aegis-primary">{Math.round(petCaptionScale*100)}%</span></div><input className="mt-2 w-full accent-[rgb(var(--aegis-primary))]" type="range" min="0.85" max="1.35" step="0.05" value={petCaptionScale} onChange={(event)=>setPetCaptionScale(Number(event.target.value))} aria-label={t('pet.settings.captionScale','提示文字大小')}/></div>
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{petVisible?t('pet.settings.hidePet'):t('pet.settings.showPet')}</div></div>
          <button disabled={!petEnabled} onClick={()=>invoke(petVisible?'close_pet_window':'open_pet_window').catch(()=>undefined)}
            className={clsx('text-[12px] px-3 py-1.5 rounded-xl border transition-colors',petEnabled?'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10':'border-aegis-border/20 text-aegis-text-dim opacity-40 cursor-not-allowed')}>{petVisible?t('pet.settings.hide'):t('pet.settings.show')}</button></div>
        <div><div className="text-[13px] text-aegis-text mb-2">{t('pet.settings.skin')}</div><div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{PET_SKIN_OPTIONS.map(({id,label})=><button key={id} onClick={()=>setPetSkin(id)} aria-pressed={petSkin===id} className={clsx('flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors',petSkin===id?'border-aegis-primary/60 bg-aegis-primary/10':'border-aegis-border/20 hover:border-aegis-border/50')}><SkinPreview skin={id} size={44}/><span className={clsx('text-[11px] leading-none',petSkin===id?'text-aegis-text':'text-aegis-text-dim')}>{t(`pet.settings.${id}`,label)}</span></button>)}</div></div>
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.custom')}</div></div>
          <div className="flex gap-2">
            <button onClick={async()=>{setUploadErr(null);try{const s=await openDialog({multiple:false,filters:[{name:'Image',extensions:['png','jpg','jpeg','gif','webp']}]});if(s&&!Array.isArray(s)){const url=await invoke<string>('save_pet_asset',{srcPath:s});setPetCustomAsset(url);setCustomPet(null);}}catch(e){setUploadErr(e instanceof Error?e.message:String(e));}}}
              className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{petCustomAsset?t('pet.settings.replace'):t('pet.settings.upload')}</button>
            <button onClick={async()=>{setUploadErr(null);try{const s=await openDialog({multiple:false,filters:[{name:'JunQi Pet',extensions:['json']}]});if(s&&!Array.isArray(s)){const pet=await invoke<import('@/stores/petStore').CustomPetPackage>('import_pet_package',{manifestPath:s,locale:i18n.resolvedLanguage??i18n.language});setCustomPet(pet);setPetCustomAsset(null);}}catch(e){setUploadErr(e instanceof Error?e.message:String(e));}}}
              className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{t('pet.settings.animatedPackage')}</button>
            {(petCustomAsset||customPet)&&<button onClick={async()=>{setUploadErr(null);await Promise.all([invoke('clear_pet_asset').catch(()=>undefined),invoke('clear_pet_package').catch(()=>undefined)]);setPetCustomAsset(null);setCustomPet(null);}} className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-danger">{t('pet.settings.clear')}</button>}</div></div>
        {uploadErr&&<div className="text-[11px] text-aegis-danger">{uploadErr}</div>}
        <div className="border-t pt-4" style={{borderColor:'rgb(var(--aegis-border))'}}><div className="flex items-center justify-between"><div><div className="flex items-center gap-1.5 text-[13px] text-aegis-text"><Timer size={14} aria-hidden="true" />{t('pet.pomodoro.title')}</div></div><Toggle enabled={petPomodoro.enabled} onChange={v=>setPetPomodoro({enabled:v})}/></div>
          <div className="flex items-center gap-2 mt-3"><input type="number" min={1} max={120} value={petPomodoro.workMin} disabled={petPomodoro.running} onChange={e=>setPetPomodoro({workMin:Math.max(1,Math.min(120,Number(e.target.value)||30))})} className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center"/><span className="text-[11px] text-aegis-text-dim">{t('appSettings.workMinutes', 'min work')}</span>
            <input type="number" min={1} max={60} value={petPomodoro.breakMin} disabled={petPomodoro.running} onChange={e=>setPetPomodoro({breakMin:Math.max(1,Math.min(60,Number(e.target.value)||5))})} className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center ml-2"/><span className="text-[11px] text-aegis-text-dim">{t('appSettings.breakMinutes', 'min break')}</span></div>
          <div className="flex items-center gap-2 mt-3">
            <button disabled={!petPomodoro.enabled} onClick={()=>petPomodoro.running?stopPomodoro():startPomodoro()} className={clsx('text-[12px] px-4 py-2 rounded-xl border transition-colors',petPomodoro.running?'border-aegis-danger/30 text-aegis-danger hover:bg-aegis-danger/10':'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10',!petPomodoro.enabled&&'opacity-40 cursor-not-allowed')}>{petPomodoro.running?t('pet.pomodoro.stop'):t('pet.pomodoro.start')}</button>
            {petPomodoro.running&&<button onClick={()=>togglePausePomodoro()} className="text-[12px] px-3 py-2 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{petPomodoro.paused?t('pet.pomodoro.resume'):t('pet.pomodoro.pause')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reused panels ──────────────────────────────────────────────────────────

interface HookReadiness { agent: string; usable: boolean; reason: string|null; detectedVersion: string|null; minVersion: string|null; }
export function HooksPanel() {
  const { t } = useTranslation();
  const [r, setR] = useState<HookReadiness[]|null>(null); const [l,setL]=useState(true);
  useEffect(()=>{let c=false;invoke<HookReadiness[]>('get_hook_readiness').then(x=>{if(!c)setR(x);}).catch(()=>{if(!c)setR([]);}).finally(()=>{if(!c)setL(false);});return()=>{c=true};},[]);
  return (
    <div className="p-6"><h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.hooks', 'Hooks')}</h2><p className="text-[12px] text-aegis-text-dim mb-6">{t('appSettings.hooksDesc', 'Detected agent versions and hook readiness.')}</p>
      {l?<div className="flex items-center gap-2 text-[12px] text-aegis-text-dim"><Loader2 size={14} className="animate-spin"/>{t('appSettings.checking', 'Checking…')}</div>
        :!r||r.length===0?<div className="text-[13px] text-aegis-text-dim py-4">{t('appSettings.noAgentData', 'No agent data available.')}</div>
        :<div className="flex flex-col gap-3">{r.map(x=><div key={x.agent} className="rounded-xl p-4 flex items-start gap-3" style={{background:'rgb(var(--aegis-overlay)/0.04)',border:'1px solid rgb(var(--aegis-border))'}}>
          {x.usable?<CheckCircle2 size={18} style={{color:'rgb(var(--aegis-success))',marginTop:2}}/>:<AlertCircle size={18} style={{color:'rgb(var(--aegis-warning))',marginTop:2}}/>}
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-aegis-text">{x.agent==='claude'?'Claude Code':x.agent==='codex'?'Codex':x.agent}</div>
            <div className="text-[11.5px] mt-0.5" style={{color:x.usable?'rgb(var(--aegis-success))':'rgb(var(--aegis-warning))'}}>{x.usable?t('appSettings.ready', 'Ready'):x.reason??t('appSettings.unavailable', 'Unavailable')}</div>
            <div className="text-[11px] text-aegis-text-dim mt-1.5 font-mono">{x.detectedVersion?t('appSettings.detectedVersion', 'detected {{version}}', { version: x.detectedVersion }):t('appSettings.notFound', 'not found')}{x.minVersion?t('appSettings.minimumVersion', ' · min {{version}}', { version: x.minVersion }):''}</div></div>
        </div>)}</div>}</div>);
}

interface NativeAppSettings {
  language: string;
  claude_path: string;
  codex_path: string;
  send_shortcut: string;
  terminal_shift_enter_newline: boolean;
  claude_force_default_tui: boolean;
  terminal_scrollback: number;
}

function AgentProgramPathSection({ agent }: { agent: 'claude' | 'codex' }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NativeAppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = agent === 'claude' ? 'claude_path' : 'codex_path';

  useEffect(() => {
    let cancelled = false;
    void invoke<NativeAppSettings>('load_app_settings')
      .then((next) => { if (!cancelled) setSettings(next); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);

  const detect = async () => {
    setDetecting(true);
    setError(null);
    try {
      const next = await invoke<NativeAppSettings>('detect_agent_paths');
      setSettings(next);
      window.dispatchEvent(new Event('junqi:app-settings-changed'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDetecting(false);
    }
  };
  const save = async (nextSettings: NativeAppSettings | null = settings) => {
    if (!nextSettings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await invoke('save_app_settings', { settings: nextSettings });
      setSettings(nextSettings);
      window.dispatchEvent(new Event('junqi:app-settings-changed'));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-md border border-aegis-border bg-aegis-surface p-3">
      <div className="mb-2 text-[12px] font-semibold text-aegis-text">{agent === 'claude' ? 'Claude Code' : 'Codex'} {t('appSettings.executablePath', 'executable path')}</div>
      <div className="flex items-center gap-2">
        <input
          value={settings?.[field] ?? ''}
          disabled={!settings || saving || detecting}
          onChange={(event) => setSettings((current) => current ? { ...current, [field]: event.target.value } : current)}
          placeholder={agent}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-aegis-border bg-aegis-input px-3 py-2 font-mono text-[12px] text-aegis-text outline-none focus:border-aegis-primary"
        />
        <button type="button" onClick={() => void detect()} disabled={!settings || saving || detecting} className="flex h-9 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[12px] text-aegis-text-secondary hover:bg-aegis-hover disabled:opacity-50">
          <RefreshCw size={12} className={detecting ? 'animate-spin' : ''} />{t('appSettings.detect', 'Detect')}
        </button>
        <button type="button" onClick={() => void save()} disabled={!settings || saving || detecting} className="flex h-9 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[12px] font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
          {saved ? t('common.saved', 'Saved') : t('common.save', 'Save')}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-aegis-text-dim">{t('appSettings.executablePathHint', 'Leave empty to resolve the agent from the login-shell PATH.')}</p>
      {agent === 'claude' && settings && (
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-aegis-border pt-3">
          <div>
            <div className="text-[12px] font-medium text-aegis-text">{t('appSettings.claudeForceDefaultTui', 'Use Claude default terminal UI')}</div>
            <p className="mt-0.5 text-[11px] text-aegis-text-dim">{t('appSettings.claudeForceDefaultTuiHint', 'Avoid fullscreen terminal behavior that can interfere with scrolling and text selection.')}</p>
          </div>
          <Toggle enabled={settings.claude_force_default_tui} disabled={saving || detecting} onChange={(enabled) => {
            const next = { ...settings, claude_force_default_tui: enabled };
            setSettings(next);
            void save(next);
          }} />
        </div>
      )}
      {error && <div className="mt-2 text-[11px] text-aegis-danger" role="alert">{error}</div>}
    </div>
  );
}

function FileEditor({ label, agent, lang }: { label: string; agent: 'claude'|'codex'; lang: 'json'|'toml' }) {
  const [c,setC]=useState<string|null>(null); const [orig,setOrig]=useState(''); const [fp,setFp]=useState('');
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [err,setErr]=useState<string|null>(null);
  const load=async()=>{setLoading(true);setErr(null);try{const[p,t]=await Promise.all([invoke<string>('get_agent_config_file_path',{agent}),invoke<string|null>('read_agent_config_file',{agent})]);setFp(p);setOrig(t??'');setC(t??'');}catch(e){setErr(String(e));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[agent]);
  const dirty=c!==null&&c!==orig;
  return (
    <div className="p-6 flex flex-col h-full"><div className="flex items-center gap-2 mb-1"><h2 className="text-[16px] font-bold text-aegis-text">{label}</h2><span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{background:'rgb(var(--aegis-overlay)/0.06)',color:'rgb(var(--aegis-text-secondary))',border:'1px solid rgb(var(--aegis-border))'}}>{lang}</span>{dirty&&<span className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{background:'rgb(var(--aegis-warning)/0.15)',color:'rgb(var(--aegis-warning))'}}>unsaved</span>}</div>
      <AgentProgramPathSection agent={agent}/>
      <div className="text-[11px] text-aegis-text-dim font-mono mb-4 truncate" title={fp}>{fp||'(loading…)'}</div>
      {err&&<div className="mb-3 px-3 py-2 rounded-md text-[12px]" style={{background:'rgb(var(--aegis-danger)/0.1)',color:'rgb(var(--aegis-danger))'}}>{err}</div>}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={()=>void load()} disabled={loading||saving} className="px-3 py-1.5 rounded-md text-[12px] font-medium flex items-center gap-1.5" style={{background:'rgb(var(--aegis-overlay)/0.05)',color:'rgb(var(--aegis-text-secondary))',border:'1px solid rgb(var(--aegis-border))'}}><RefreshCw size={12} className={loading?'animate-spin':''}/>Reload</button>
        <button onClick={async()=>{if(c==null)return;setSaving(true);setErr(null);try{await invoke('write_agent_config_file',{agent,content:c});setOrig(c);}catch(e){setErr(String(e));}finally{setSaving(false);}}} disabled={!dirty||saving||loading}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5" style={{background:'rgb(var(--aegis-primary))',color:'rgb(var(--aegis-on-primary))',opacity:!dirty||saving||loading?0.5:1}}><Save size={12}/>{saving?'Saving…':'Save'}</button>
      </div>
      <textarea value={c??''} onChange={e=>setC(e.target.value)} spellCheck={false} className="flex-1 w-full p-3 rounded-md text-[12px] font-mono resize-none outline-none" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))',minHeight:280}}/>
    </div>);
}
export function ClaudeCodePanel() { return <FileEditor label="Claude Code" agent="claude" lang="json"/>; }
export function CodexPanel() { return <FileEditor label="Codex" agent="codex" lang="toml"/>; }

function AboutPanel() {
  return (
    <div className="p-6">
      <div className="flex gap-4 rounded-lg border border-aegis-border bg-aegis-surface p-5">
        <JunQiLogo variant="emblem" title="JunQi" className="h-16 w-16 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-bold text-aegis-text">JunQi</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-aegis-text-secondary">OpenClaw 桌面工作台</p>
          <div className="mt-4 grid gap-3">
            <div><div className="mb-1 text-[11px] text-aegis-text-dim">版本</div><div className="font-mono text-[12.5px] text-aegis-text">{APP_VERSION}</div></div>
            <div>
              <div className="mb-1 text-[11px] text-aegis-text-dim">GitHub</div>
              <a href="https://github.com/smartrealm/openclaw-junqi" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 break-all text-[12.5px] text-aegis-primary hover:underline">github.com/smartrealm/openclaw-junqi<ExternalLink size={13} /></a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppSettingsDialog;
