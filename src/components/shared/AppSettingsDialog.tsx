// ── AppSettingsDialog — 1:1 nezha modal settings ─────────────────────────────
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
  CheckCircle2, AlertCircle, Upload, Trash2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { gateway } from '@/services/gateway';
import { notifications } from '@/services/notifications';
import { SKIN_REGISTRY, type PetSkin } from '@/pet/skins';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { changeLanguage } from '@/i18n';
import { applyTheme } from '@/theme/apply';
import type { ThemeSetting, AegisTheme } from '@/theme';
import { StatusDot } from '@/components/shared/StatusDot';
import clsx from 'clsx';

// ── Nav ─────────────────────────────────────────────────────────────────────

type NavSection = 'application' | 'connectivity' | 'agents' | 'about';
type NavKey = 'general' | 'theme' | 'fonts' | 'shortcuts' | 'connect' | 'notify' | 'pet' | 'hooks' | 'claude' | 'codex' | 'about';

interface NavItem { key: NavKey; label: string; icon: React.ReactNode; section: NavSection; }

const SECTION_ORDER: NavSection[] = ['application', 'connectivity', 'agents', 'about'];
const SECTION_LABELS: Record<NavSection, string> = { application: 'Application', connectivity: 'Connectivity', agents: 'Agents', about: 'About' };
const THEME_I18N: Record<AegisTheme, string> = { 'aegis-dark': 'theme.dark', 'aegis-light': 'theme.light', 'aegis-eyecare': 'theme.eyecare', 'aegis-midnight': 'theme.midnight' };

// ── Shell ───────────────────────────────────────────────────────────────────

export interface AppSettingsDialogProps { onClose: () => void; }

export function AppSettingsDialog({ onClose }: AppSettingsDialogProps) {
  const { t } = useTranslation();
  const [activeNav, setActiveNav] = useState<NavKey>('general');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const navItems: NavItem[] = [
    { key: 'general', label: t('appSettings.general', 'General'), icon: <Globe size={14} />, section: 'application' },
    { key: 'theme', label: t('appSettings.theme', 'Theme'), icon: <Palette size={14} />, section: 'application' },
    { key: 'fonts', label: t('appSettings.fonts', 'Fonts'), icon: <Type size={14} />, section: 'application' },
    { key: 'shortcuts', label: t('appSettings.shortcuts', 'Shortcuts'), icon: <Keyboard size={14} />, section: 'application' },
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgb(0 0 0 / 0.55)' }} onClick={onClose}>
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
                <div className="text-[9.5px] font-bold uppercase tracking-wider px-2 pt-1 pb-1" style={{ color: 'rgb(var(--aegis-text-dim))' }}>{SECTION_LABELS[section]}</div>
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
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.general', 'General')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-6">{t('appSettings.generalDesc', 'Application-wide preferences.')}</p>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{t('settings.language')}</label>
          <select value={language} onChange={(e) => { setLanguage(e.target.value as 'en'|'zh'|'ar'); changeLanguage(e.target.value as 'en'|'zh'|'ar'); }}
            className="px-3 py-2 rounded-md text-[13px] w-[200px]" style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }}>
            <option value="en">English</option><option value="zh">中文</option><option value="ar">العربية</option>
          </select>
          <p className="text-[11px] text-aegis-text-dim mt-1">{t('appSettings.languageHint', 'Reload required for changes to take effect.')}</p>
        </div>
      </div>
    </div>
  );
}

function ThemePanel() {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const followSystem = theme === 'system';
  const THEME_PRESETS: AegisTheme[] = ['aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare'];
  const icons: Record<string, React.ReactNode> = { 'aegis-dark': <Moon size={14} />, 'aegis-light': <Sun size={14} />, 'aegis-eyecare': <Eye size={14} />, 'aegis-midnight': <Moon size={14} /> };
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('appSettings.theme', 'Theme')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('appSettings.themeDesc', 'Choose how JunQi looks.')}</p>
      <label className="flex items-center gap-3 mb-5 p-3 rounded-xl cursor-pointer transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.03)]"
        style={{ background: followSystem ? 'rgb(var(--aegis-primary) / 0.06)' : 'transparent', border: followSystem ? '1px solid rgb(var(--aegis-primary) / 0.2)' : '1px solid transparent' }}>
        <input type="checkbox" checked={followSystem} onChange={() => { const next = followSystem ? 'aegis-dark' : 'system'; if (next !== 'system') applyTheme(next as AegisTheme); setTheme(next); }} className="w-4 h-4 rounded accent-aegis-primary" />
        <div><div className="text-[12px] font-semibold text-aegis-text">{t('theme.followSystem', 'Follow System')}</div><div className="text-[11px] text-aegis-text-dim">{t('theme.followSystemDesc', 'Match your OS light/dark preference.')}</div></div>
      </label>
      <div className="grid grid-cols-2 gap-3">
        {THEME_PRESETS.map((key) => {
          const active = theme === key;
          return <button key={key} type="button" onClick={() => { applyTheme(key); setTheme(key); }}
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
  const uiFont = useSettingsStore((s) => s.uiFont);
  const monoFont = useSettingsStore((s) => s.monoFont);
  const setUiFont = useSettingsStore((s) => s.setUiFont);
  const setMonoFont = useSettingsStore((s) => s.setMonoFont);
  const apply = (key: string, value: string, setter: (v: string) => void) => { localStorage.setItem(key, value); setter(value); };
  const suggestions = ['', 'Inter', 'SF Pro', 'IBM Plex Sans', 'Geist', 'Manrope'];
  const monoSuggestions = ['', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'IBM Plex Mono'];
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">Fonts</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">Customize UI and code font families.</p>
      {[['UI Font', 'aegis-font-ui', uiFont, setUiFont, suggestions], ['Mono Font', 'aegis-font-mono', monoFont, setMonoFont, monoSuggestions]].map(([label, key, value, setter, list]: any[]) => (
        <div key={key} className="mb-4">
          <label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">{label}</label>
          <input value={value} onChange={(e) => apply(key, e.target.value, setter)} placeholder="system default" spellCheck={false}
            className="px-3 py-2 rounded-md text-[13px] font-mono w-full mb-1.5" style={{ background: 'rgb(var(--aegis-input))', border: '1px solid rgb(var(--aegis-border))', color: 'rgb(var(--aegis-text))' }} />
          <div className="flex flex-wrap gap-1">
            {list.map((s: string) => <button key={s} type="button" onClick={() => apply(key, s ? `'${s}', sans-serif` : '', setter)}
              className="px-2 py-1 rounded-md text-[10px] transition-colors"
              style={{ background: value === (s ? `'${s}', sans-serif` : '') ? 'rgb(var(--aegis-primary)/0.12)' : 'rgb(var(--aegis-overlay)/0.03)', color: value === (s ? `'${s}', sans-serif` : '') ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))', border: value === (s ? `'${s}', sans-serif` : '') ? '1px solid rgb(var(--aegis-primary)/0.2)' : '1px solid transparent' }}>
              {s || 'Default'}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ShortcutsPanel() {
  const [send, setSend] = useState('mod_enter');
  const [shiftEnter, setShiftEnter] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');
  useEffect(() => { let c = false; invoke<{send_shortcut?:string;terminal_shift_enter_newline?:boolean}>('load_app_settings').then(s => { if(!c){ setSend(s.send_shortcut||'mod_enter'); setShiftEnter(s.terminal_shift_enter_newline??true); } }).catch(()=>{}).finally(()=>{ if(!c) setLoading(false); }); return ()=>{c=true}; }, []);
  const save = async () => { setSaving(true); try { await invoke('save_app_settings',{settings:{send_shortcut:send,terminal_shift_enter_newline:shiftEnter}}); setSaved(true); setTimeout(()=>setSaved(false),1500); } catch {} finally { setSaving(false); } };
  return loading ? <div className="p-6"><Loader2 size={14} className="animate-spin text-aegis-text-dim"/></div> : (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">Shortcuts</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">Customize keyboard shortcuts.</p>
      <div className="flex flex-col gap-4">
        <div><label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">Send prompt shortcut</label>
          <select value={send} onChange={e=>setSend(e.target.value)} className="px-3 py-2 rounded-md text-[13px] w-[240px]" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}>
            <option value="mod_enter">{isMac?'⌘+Enter':'Ctrl+Enter'}</option><option value="enter">Enter</option></select></div>
        <div><label className="text-[11px] font-semibold text-aegis-text-secondary mb-1.5 block">Terminal newline</label>
          <div className="flex items-center gap-2"><Toggle enabled={shiftEnter} onChange={setShiftEnter}/><span className="text-[12px] text-aegis-text-dim">Shift+Enter inserts newline</span></div></div>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all w-fit" style={{background:'rgb(var(--aegis-primary))',color:'rgb(var(--aegis-on-primary))',opacity:saving?0.5:1}}>
          {saved?<CheckCircle2 size={13}/>:<Save size={13}/>}{saving?'Saving…':saved?'Saved':'Save'}</button>
      </div>
    </div>
  );
}

function ConnectPanel() {
  const { t } = useTranslation();
  const { connected, connecting } = useChatStore();
  const gatewayUrl = useSettingsStore((s) => s.gatewayUrl);
  const gatewayToken = useSettingsStore((s) => s.gatewayToken);
  const setGatewayUrl = useSettingsStore((s) => s.setGatewayUrl);
  const setGatewayToken = useSettingsStore((s) => s.setGatewayToken);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState(gatewayToken);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean|null>(null);
  const dirty = editUrl !== gatewayUrl || editToken !== gatewayToken;
  const handleSave = () => { setGatewayUrl(editUrl.trim()); setGatewayToken(editToken.trim()); gateway.connect(editUrl.trim()||'ws://127.0.0.1:18789',editToken.trim()); };
  const handleTest = async () => { setTesting(true); setTestOk(null); try { gateway.connect(editUrl.trim()||'ws://127.0.0.1:18789',editToken.trim()); await new Promise(r=>setTimeout(r,2500)); setTestOk(useChatStore.getState().connected); } catch { setTestOk(false); } finally { setTesting(false); } };
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
        <div><label className="text-[11px] text-aegis-text-dim mb-1 block">WebSocket URL</label><input value={editUrl} onChange={e=>setEditUrl(e.target.value)} placeholder="ws://127.0.0.1:18789" className="w-full px-3 py-2 rounded-md text-[13px] font-mono" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}/></div>
        <div><label className="text-[11px] text-aegis-text-dim mb-1 block">Token</label><input type="password" value={editToken} onChange={e=>setEditToken(e.target.value)} placeholder="••••••••" className="w-full px-3 py-2 rounded-md text-[13px] font-mono" style={{background:'rgb(var(--aegis-input))',border:'1px solid rgb(var(--aegis-border))',color:'rgb(var(--aegis-text))'}}/></div>
        <div className="flex items-center gap-2">
          {dirty && <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-aegis-primary/15 text-aegis-primary border border-aegis-primary/25">Save & Reconnect</button>}
          <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{testing?<Loader2 size={13} className="animate-spin"/>:<Wifi size={13}/>}{t('settings.testConnection')}</button>
          {testOk!==null && <span className={testOk?'text-aegis-success':'text-aegis-danger'}>{testOk?'✓':'✗'}</span>}
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
          className="text-[12px] px-4 py-2 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors w-fit">🔔 {t('settings.testSound')}</button>
      </div>
    </div>
  );
}

function PetPanel() {
  const { t } = useTranslation();
  const { enabled:petEnabled,setEnabled:setPetEnabled,skin:petSkin,setSkin:setPetSkin,customAsset:petCustomAsset,setCustomAsset:setPetCustomAsset,pomodoro:petPomodoro,setPomodoro:setPetPomodoro,petVisible,setPetVisible } = usePetStore();
  const [uploadErr,setUploadErr]=useState<string|null>(null);
  const [now,setNow]=useState(Date.now());
  const skins=['lobster','robot','cat','jellyfish','ghost'] as PetSkin[];
  const names:Record<PetSkin,string>={lobster:'龙虾',robot:'机器人',cat:'猫咪',jellyfish:'水母',ghost:'幽灵'};
  useEffect(()=>{if(!petPomodoro.running||petPomodoro.paused)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[petPomodoro.running,petPomodoro.paused]);
  return (
    <div className="p-6">
      <h2 className="text-[16px] font-bold text-aegis-text mb-1">{t('pet.settings.title')}</h2>
      <p className="text-[12px] text-aegis-text-dim mb-5">{t('pet.settings.enabledHint')}</p>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.enabled')}</div></div><Toggle enabled={petEnabled} onChange={setPetEnabled}/></div>
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{petVisible?t('pet.settings.hidePet'):t('pet.settings.showPet')}</div></div>
          <button disabled={!petEnabled} onClick={()=>invoke(petVisible?'close_pet_window':'open_pet_window').catch(()=>undefined)}
            className={clsx('text-[12px] px-3 py-1.5 rounded-xl border transition-colors',petEnabled?'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10':'border-aegis-border/20 text-aegis-text-dim opacity-40 cursor-not-allowed')}>{petVisible?t('pet.settings.hide'):t('pet.settings.show')}</button></div>
        <div><div className="text-[13px] text-aegis-text mb-2">{t('pet.settings.skin')}</div><div className="flex gap-1 flex-wrap">{skins.map(s=><button key={s} onClick={()=>setPetSkin(s)} className={clsx('text-[12px] px-3 py-1.5 rounded-lg border transition-colors',petSkin===s?'border-aegis-primary/50 text-aegis-text bg-aegis-primary/10':'border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text')}>{t(`pet.settings.${s}`,names[s])}</button>)}</div></div>
        <div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">{t('pet.settings.custom')}</div></div>
          <div className="flex gap-2">
            <button onClick={async()=>{setUploadErr(null);try{const s=await openDialog({multiple:false,filters:[{name:'Image',extensions:['png','jpg','jpeg','gif','webp']}]});if(s&&!Array.isArray(s)){const url=await invoke<string>('save_pet_asset',{srcPath:s});setPetCustomAsset(url);}}catch(e){setUploadErr(e instanceof Error?e.message:String(e));}}}
              className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text">{petCustomAsset?t('pet.settings.replace'):t('pet.settings.upload')}</button>
            {petCustomAsset&&<button onClick={async()=>{setUploadErr(null);await invoke('clear_pet_asset').catch(()=>undefined);setPetCustomAsset(null);}} className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-danger">{t('pet.settings.clear')}</button>}</div></div>
        {uploadErr&&<div className="text-[11px] text-aegis-danger">{uploadErr}</div>}
        <div className="border-t pt-4" style={{borderColor:'rgb(var(--aegis-border))'}}><div className="flex items-center justify-between"><div><div className="text-[13px] text-aegis-text">🍅 {t('pet.pomodoro.title')}</div></div><Toggle enabled={petPomodoro.enabled} onChange={v=>setPetPomodoro({enabled:v})}/></div>
          <div className="flex items-center gap-2 mt-3"><input type="number" min={1} max={120} value={petPomodoro.workMin} disabled={petPomodoro.running} onChange={e=>setPetPomodoro({workMin:Math.max(1,Math.min(120,Number(e.target.value)||30))})} className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center"/><span className="text-[11px] text-aegis-text-dim">min work</span>
            <input type="number" min={1} max={60} value={petPomodoro.breakMin} disabled={petPomodoro.running} onChange={e=>setPetPomodoro({breakMin:Math.max(1,Math.min(60,Number(e.target.value)||5))})} className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center ml-2"/><span className="text-[11px] text-aegis-text-dim">min break</span></div>
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
  const [r, setR] = useState<HookReadiness[]|null>(null); const [l,setL]=useState(true);
  useEffect(()=>{let c=false;invoke<HookReadiness[]>('get_hook_readiness').then(x=>{if(!c)setR(x);}).catch(()=>{if(!c)setR([]);}).finally(()=>{if(!c)setL(false);});return()=>{c=true};},[]);
  return (
    <div className="p-6"><h2 className="text-[16px] font-bold text-aegis-text mb-1">Hooks</h2><p className="text-[12px] text-aegis-text-dim mb-6">Detected agent versions and hook readiness.</p>
      {l?<div className="flex items-center gap-2 text-[12px] text-aegis-text-dim"><Loader2 size={14} className="animate-spin"/>Checking…</div>
        :!r||r.length===0?<div className="text-[13px] text-aegis-text-dim py-4">No agent data available.</div>
        :<div className="flex flex-col gap-3">{r.map(x=><div key={x.agent} className="rounded-xl p-4 flex items-start gap-3" style={{background:'rgb(var(--aegis-overlay)/0.04)',border:'1px solid rgb(var(--aegis-border))'}}>
          {x.usable?<CheckCircle2 size={18} style={{color:'rgb(var(--aegis-success))',marginTop:2}}/>:<AlertCircle size={18} style={{color:'rgb(var(--aegis-warning))',marginTop:2}}/>}
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-aegis-text">{x.agent==='claude'?'Claude Code':x.agent==='codex'?'Codex':x.agent}</div>
            <div className="text-[11.5px] mt-0.5" style={{color:x.usable?'rgb(var(--aegis-success))':'rgb(var(--aegis-warning))'}}>{x.usable?'Ready':x.reason??'Unavailable'}</div>
            <div className="text-[11px] text-aegis-text-dim mt-1.5 font-mono">{x.detectedVersion?`detected ${x.detectedVersion}`:'not found'}{x.minVersion?` · min ${x.minVersion}`:''}</div></div>
        </div>)}</div>}</div>);
}

function FileEditor({ label, agent, lang }: { label: string; agent: 'claude'|'codex'; lang: 'json'|'toml' }) {
  const [c,setC]=useState<string|null>(null); const [orig,setOrig]=useState(''); const [fp,setFp]=useState('');
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [err,setErr]=useState<string|null>(null);
  const load=async()=>{setLoading(true);setErr(null);try{const[p,t]=await Promise.all([invoke<string>('get_agent_config_file_path',{agent}),invoke<string|null>('read_agent_config_file',{agent})]);setFp(p);setOrig(t??'');setC(t??'');}catch(e){setErr(String(e));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[agent]);
  const dirty=c!==null&&c!==orig;
  return (
    <div className="p-6 flex flex-col h-full"><div className="flex items-center gap-2 mb-1"><h2 className="text-[16px] font-bold text-aegis-text">{label}</h2><span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{background:'rgb(var(--aegis-overlay)/0.06)',color:'rgb(var(--aegis-text-secondary))',border:'1px solid rgb(var(--aegis-border))'}}>{lang}</span>{dirty&&<span className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{background:'rgb(var(--aegis-warning)/0.15)',color:'rgb(var(--aegis-warning))'}}>unsaved</span>}</div>
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
    <div className="p-6"><h2 className="text-[16px] font-bold text-aegis-text mb-1">About JunQi</h2><p className="text-[12px] text-aegis-text-dim mb-6">OpenClaw Gateway desktop client with Nezha-style AI tooling.</p>
      <div className="flex flex-col gap-3">
        {[['Version','0.5.0'],['Stack','React 19 · Tauri 2 · TypeScript · Vite · xterm.js'],['Backend','Rust · portable-pty · serde_json · chrono · toml · serde_yaml'],['Features','Gateway chat · 24+ pages · Nezha 39-feature port · Skill hub · Worktree · Session playback · Agent PTY · 14 agents']].map(([t,b])=>
          <div key={t} className="rounded-xl p-4" style={{background:'rgb(var(--aegis-overlay)/0.04)',border:'1px solid rgb(var(--aegis-border))'}}><div className="text-[12px] font-semibold text-aegis-text-secondary mb-1">{t}</div><div className="text-[12px] text-aegis-text-dim leading-relaxed">{b}</div></div>)}
        <a href="https://github.com/hanshuaikang/nezha" target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 px-3 py-2 rounded-md text-[12px] w-fit hover:bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors" style={{color:'rgb(var(--aegis-primary))',border:'1px solid rgb(var(--aegis-border))'}}><ExternalLink size={12}/>nezha on GitHub</a>
      </div>
    </div>);
}

export default AppSettingsDialog;
