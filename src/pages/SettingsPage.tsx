// ═══════════════════════════════════════════════════════════
// SettingsPage — Full settings with Gateway, Theme, Model
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings, Bell, BellOff, Globe, Volume2, VolumeX,
  Wifi, WifiOff, CheckCircle, Loader2, Copy, Sun, Moon,
  MonitorDot, FileText, HardDrive, RefreshCw, Type, Glasses, PawPrint, Info,
} from 'lucide-react';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { GlassCard } from '@/components/shared/GlassCard';
import { PageTransition } from '@/components/shared/PageTransition';
import { StatusDot } from '@/components/shared/StatusDot';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { gateway } from '@/services/gateway';
import { notifications } from '@/services/notifications';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { SKIN_REGISTRY, type PetSkin } from '@/pet/skins';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { changeLanguage } from '@/i18n';
import { formatBytes } from '@/utils/format';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { FontPanel } from '@/components/settings/FontPanel';
import { AegisIcon } from '@/components/shared/AegisIcon';
import { usePrefersDark } from '@/hooks/usePrefersDark';
import clsx from 'clsx';

/** Chinese fallback labels for the skin picker (i18n key: pet.settings.<skin>). */
const SKIN_FALLBACK: Record<PetSkin, string> = {
  lobster: '龙虾',
  robot: '机器人',
  cat: '猫咪',
  jellyfish: '水母',
  ghost: '幽灵',
};

export function SettingsPageFull() {
  const { t } = useTranslation();
  const {
    theme, setTheme,
    uiScale, setUiScale,
    uiFont, setUiFont,
    monoFont, setMonoFont,
    language, setLanguage,
    notificationsEnabled, setNotificationsEnabled,
    soundEnabled, setSoundEnabled,
    dndMode, setDndMode,
    gatewayUrl, setGatewayUrl,
    gatewayToken, setGatewayToken,
    accentColor, setAccentColor,
  } = useSettingsStore();
  const { connected, connecting } = useChatStore();
  const prefersDark = usePrefersDark();
  const { enabled: petEnabled, setEnabled: setPetEnabled, skin: petSkin, setSkin: setPetSkin, customAsset: petCustomAsset, setCustomAsset: setPetCustomAsset, pomodoro: petPomodoro, setPomodoro: setPetPomodoro, petVisible, setPetVisible } = usePetStore();
  const [petUploadError, setPetUploadError] = useState<string | null>(null);
  const [petNow, setPetNow] = useState(Date.now());
  useEffect(() => {
    // Pause freezes the countdown (shows pausedRemainingMs), so skip the tick.
    if (!petPomodoro.running || petPomodoro.paused) return;
    const id = setInterval(() => setPetNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [petPomodoro.running, petPomodoro.paused]);

  const handlePetUpload = async () => {
    setPetUploadError(null);
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const url = await invoke<string>('save_pet_asset', { srcPath: selected });
      setPetCustomAsset(url);
    } catch (e) {
      setPetUploadError(e instanceof Error ? e.message : String(e));
    }
  };
  const handlePetClear = async () => {
    setPetUploadError(null);
    await invoke('clear_pet_asset').catch(() => undefined);
    setPetCustomAsset(null);
  };

  const [openclawVersion, setOpenclawVersion] = useState<string | null>(null);
  const [platformLabel, setPlatformLabel] = useState<string>('—');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState(gatewayToken);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'appearance' | 'notify' | 'pet' | 'connect' | 'storage' | 'about'>('appearance');

  const handleCheckVersion = async () => {
    if (checkingVersion) return;
    setCheckingVersion(true);
    try {
      const [v, latest] = await Promise.all([
        window.aegis?.app?.versions(),
        fetch('https://registry.npmjs.org/openclaw/latest').then(r => r.json()).catch(() => null),
      ]);
      setOpenclawVersion(v?.openclaw ?? (v as any)?.runtime ?? null);
      if (latest?.version) setLatestVersion(latest.version);
    } catch {} finally {
      setCheckingVersion(false);
    }
  };

  const [managedFilesRefreshing, setManagedFilesRefreshing] = useState(false);
  const [attachmentsStatus, setAttachmentsStatus] = useState<string>('');

  const [managedIndexInfo, setManagedIndexInfo] = useState<{
    indexedTotal: number;
    indexedBytes: number;
    loadedRows: number;
    bytesIsPartial: boolean;
    workspaceSample: string;
  } | null>(null);

  useEffect(() => {
    window.aegis?.app?.versions()
      .then((v) => setOpenclawVersion(v.openclaw ?? (v as any).runtime ?? null))
      .catch(() => {});
    window.aegis?.app?.platformInfo?.().then(setPlatformLabel).catch(() => {});
  }, []);

  const refreshManagedIndexInfo = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!window.aegis?.managedFiles?.list) {
        setManagedIndexInfo(null);
        return { success: false, error: t('settings.managedFilesApiUnavailable') };
      }
      const result = await window.aegis.managedFiles.list({ limit: 500_000, offset: 0 });
      if (!result || !('success' in result) || !result.success) {
        setManagedIndexInfo(null);
        return { success: false, error: (result as { error?: string })?.error || t('settings.managedFilesListFailed') };
      }
      const rows = result.rows || [];
      const indexedTotal = typeof result.total === 'number' ? result.total : rows.length;
      let indexedBytes = 0;
      for (const r of rows) {
        indexedBytes += Number((r as { size?: number }).size || 0);
      }
      const bytesIsPartial = indexedTotal > rows.length;
      const workspaceSample = String((rows[0] as { workspaceRoot?: string })?.workspaceRoot || '');
      setManagedIndexInfo({
        indexedTotal,
        indexedBytes,
        loadedRows: rows.length,
        bytesIsPartial,
        workspaceSample,
      });
      return { success: true };
    } catch (error: any) {
      setManagedIndexInfo(null);
      return { success: false, error: error?.message || t('settings.managedFilesListFailed') };
    }
  };

  useEffect(() => {
    refreshManagedIndexInfo().then((r) => {
      if (!r.success && r.error) setAttachmentsStatus(r.error);
    });
    // Mount-only: avoid re-fetch loops when language/t changes (stats are language-agnostic).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLanguageChange = (lang: 'ar' | 'en' | 'zh') => {
    setLanguage(lang);
    changeLanguage(lang);
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    notifications.setEnabled(enabled);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    notifications.setSoundEnabled(enabled);
  };

  const handleDndToggle = (dnd: boolean) => {
    setDndMode(dnd);
    notifications.setDndMode(dnd);
  };

  const notifyInfo = (title: string, body: string) => {
    notifications.notify({ type: 'info', title, body });
  };

  const notifyError = (title: string, body: string) => {
    notifications.notify({ type: 'error', title, body });
  };

  const copyDiagnosticInfo = async () => {
    const gatewayUrl = localStorage.getItem('aegis-gateway-http')?.replace('http', 'ws') || 'ws://127.0.0.1:18789';
    const hasGatewayToken = Boolean((editToken || '').trim() || (gatewayToken || '').trim());
    const platformInfo = await window.aegis?.app?.platformInfo?.() ?? `${navigator.platform || '—'}`;
    const info = [
      `JunQi Desktop v${APP_VERSION}`,
      `OpenClaw: ${openclawVersion ? `v${openclawVersion}` : '—'}`,
      `${t('settingsExtra.platform', 'Platform')}: ${platformInfo}`,
      `Tauri: v2`,
      `${t('settingsExtra.wsUrlLabel', 'WebSocket URL')}: ${gatewayUrl}`,
      `${t('settingsExtra.gatewayTokenLabel', 'Gateway Token')}: ${hasGatewayToken ? 'configured' : 'empty'}`,
      `${t('settings.gateway', 'Gateway')}: ${connected ? t('connection.connected', 'connected') : t('connection.disconnected', 'disconnected')}`,
    ].join('\n');
    try {
      await navigator.clipboard?.writeText(info);
      notifyInfo(t('settingsExtra.copySystemInfo', 'Copy system info'), t('common.copied', 'Copied'));
      return;
    } catch {
      // Fallback for clipboard permission/availability edge cases
      try {
        const ta = document.createElement('textarea');
        ta.value = info;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          notifyInfo(t('settingsExtra.copySystemInfo', 'Copy system info'), t('common.copied', 'Copied'));
        } else {
          notifyError(t('settingsExtra.copySystemInfo', 'Copy system info'), t('settings.attachmentsOperationFailed', 'Operation failed'));
        }
      } catch {
        notifyError(t('settingsExtra.copySystemInfo', 'Copy system info'), t('settings.attachmentsOperationFailed', 'Operation failed'));
      }
    }
  };

  const openGatewayLogs = async () => {
    try {
      const res = await (window.aegis?.logs?.openGatewayLogFile?.() ?? window.aegis?.logs?.openElectronLogFile?.());
      if (res?.success) return;
      notifyError(t('settings.openGatewayLogs', '查看 Gateway 日志'), res?.error || t('settings.managedFilesListFailed'));
    } catch (err: any) {
      notifyError(t('settings.openGatewayLogs', '查看 Gateway 日志'), err?.message || t('settings.managedFilesListFailed'));
    }
  };

  const openDesktopLogs = async () => {
    try {
      // Fallback for stale preload in running app: at least open legacy log entrypoint.
      const res = await (window.aegis?.logs?.openDesktopLogFile?.() ?? window.aegis?.logs?.openElectronLogFile?.());
      if (res?.success) return;
      notifyError(t('settings.openDesktopLogs', '查看桌面日志'), res?.error || t('settings.managedFilesListFailed'));
    } catch (err: any) {
      const message = String(err?.message || err || '');
      if (message.includes("No handler registered for 'logs:openDesktopLogFile'")) {
        try {
          const fallback = await window.aegis?.logs?.openElectronLogFile?.();
          if (fallback?.success) return;
        } catch {
          // handled below
        }
      }
      notifyError(t('settings.openDesktopLogs', '查看桌面日志'), message || t('settings.managedFilesListFailed'));
    }
  };

  const resolveConnectionUrl = async (): Promise<{ url: string; token: string }> => {
    const userUrl = editUrl.trim();
    const userToken = editToken.trim();
    if (userUrl) return { url: userUrl, token: userToken };
    try {
      const config = await window.aegis?.config.get();
      return {
        url: config?.gatewayUrl || config?.gatewayWsUrl || 'ws://127.0.0.1:18789',
        token: config?.gatewayToken || '',
      };
    } catch {
      return { url: 'ws://127.0.0.1:18789', token: '' };
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const { url, token } = await resolveConnectionUrl();
      gateway.connect(url, token);
      await new Promise((r) => setTimeout(r, 2500));
      setTestResult(useChatStore.getState().connected ? 'success' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleReconnect = async () => {
    const { url, token } = await resolveConnectionUrl();
    gateway.connect(url, token);
  };

  const handleSaveConnection = () => {
    setGatewayUrl(editUrl.trim());
    setGatewayToken(editToken.trim());
    setConnectionDirty(false);
    // Reconnect with new settings
    const url = editUrl.trim() || 'ws://127.0.0.1:18789';
    gateway.connect(url, editToken.trim());
  };

  // Toggle switch — unified design (used everywhere in settings)
  const Toggle = ({
    enabled,
    onChange,
    disabled,
  }: {
    enabled: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      className={clsx(
        'w-[42px] h-[24px] rounded-full relative transition-all shrink-0 border',
        enabled
          ? 'bg-aegis-primary/30 border-aegis-primary/40'
          : 'bg-[rgb(var(--aegis-overlay)/0.08)] border-[rgb(var(--aegis-overlay)/0.1)]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className={clsx(
        'absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all duration-300',
        enabled
          ? 'left-[21px] bg-aegis-primary shadow-[0_0_8px_rgb(var(--aegis-primary)/0.5)]'
          : 'left-[2px] bg-[rgb(var(--aegis-overlay)/0.3)]'
      )} />
    </button>
  );

  return (
    <PageTransition className="p-6 space-y-6 max-w-[920px] mx-auto">
      <div>
        <h1 className="text-[22px] font-bold text-aegis-text flex items-center gap-3">
          <Settings size={24} className="text-aegis-text-dim" />
          {t('settings.title')}
        </h1>
      </div>

      {/* Layout: left nav (nezha-style vertical) + right panel */}
      <div className="flex gap-6 items-start">
        <nav className="w-44 shrink-0">
          <div className="flex flex-col gap-0.5">
            {([
              ['appearance', t('settings.tab.appearance', '外观'), Sun],
              ['notify', t('settings.tab.notify', '通知'), Bell],
              ['pet', t('settings.tab.pet', '萌宠'), PawPrint],
              ['connect', t('settings.tab.connect', '连接'), Wifi],
              ['storage', t('settings.tab.storage', '存储'), HardDrive],
              ['about', t('settings.tab.about', '关于'), Info],
            ] as const).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={clsx('flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left w-full',
                  activeTab === key
                    ? 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text font-medium'
                    : 'text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.03)]')}>
                <Icon size={15} className={clsx(activeTab === key ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                {label}
              </button>
            ))}
          </div>
        </nav>
        <div className="flex-1 min-w-0 space-y-6">

      {activeTab === 'appearance' && (
        <>
      {/* Language */}
      <GlassCard delay={0.05}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Globe size={16} className="text-aegis-primary" />
          {t('settings.language')}
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleLanguageChange('zh')}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              language === 'zh'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border/20 text-aegis-text-dim hover:border-aegis-border/40'
            )}
          >
            简体中文
          </button>
          <button
            onClick={() => handleLanguageChange('en')}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              language === 'en'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border/20 text-aegis-text-dim hover:border-aegis-border/40'
            )}
          >
            English
          </button>
        </div>
      </GlassCard>

      {/* Theme — 1:1 nezha ThemePanel: system toggle + 2×2 manual cards */}
      <GlassCard delay={0.08}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Moon size={16} className="text-aegis-primary" />
          {t('settings.theme')}
        </h3>
        <ThemePicker
          value={theme}
          onChange={setTheme}
          systemPrefersDark={prefersDark}
        />
      </GlassCard>

      {/* Font Settings — UI font + Mono font with live preview */}
      <GlassCard delay={0.085}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Type size={16} className="text-aegis-primary" />
          {t("settings.fonts", "Fonts")}
        </h3>
        <FontPanel
          uiFont={uiFont}
          monoFont={monoFont}
          onUiFontChange={setUiFont}
          onMonoFontChange={setMonoFont}
        />
      </GlassCard>

      {/* Display Scale (whole-UI zoom) */}
      <GlassCard delay={0.09}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-3 flex items-center gap-2">
          <Type size={16} className="text-aegis-primary" />
          {t('settings.displayScale', 'Display Scale')}
          <span className="ml-auto text-[11px] font-mono text-aegis-text-muted">{uiScale}%</span>
        </h3>
        <input
          type="range" min="50" max="150" step="10" value={uiScale}
          onChange={(e) => setUiScale(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, rgb(var(--aegis-primary)) 0%, rgb(var(--aegis-primary)) ${((uiScale - 50) / 100) * 100}%, rgb(var(--aegis-overlay) / 0.15) ${((uiScale - 50) / 100) * 100}%, rgb(var(--aegis-overlay) / 0.15) 100%)`,
            accentColor: 'rgb(var(--aegis-primary))',
          }}
        />
        <div className="flex justify-between text-[10px] text-aegis-text-dim mt-1">
          <span>50%</span>
          <button
            type="button"
            onClick={() => setUiScale(100)}
            className="font-mono text-aegis-text-muted hover:text-aegis-primary transition-colors"
            title={t('settings.displayScaleReset', 'Reset to 100%')}
          >
            100%
          </button>
          <span>150%</span>
        </div>
      </GlassCard>

      {/* Accent Color */}
      <GlassCard delay={0.10}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <span className="text-aegis-primary">🎨</span>
          {t('settings.accentColor', 'Accent Color')}
        </h3>
        <div className="flex gap-3 flex-wrap">
          {(['teal', 'blue', 'purple', 'rose', 'amber', 'emerald'] as const).map((color) => (
            <button
              key={color}
              onClick={() => setAccentColor(color)}
              className={clsx(
                'w-8 h-8 rounded-full border-2 transition-all',
                accentColor === color
                  ? 'border-aegis-text scale-110'
                  : 'border-transparent hover:border-aegis-text-dim hover:scale-105'
              )}
              style={{
                backgroundColor: {
                  teal: 'rgb(78, 201, 176)',
                  blue: 'rgb(96, 165, 250)',
                  purple: 'rgb(192, 132, 252)',
                  rose: 'rgb(251, 113, 133)',
                  amber: 'rgb(251, 191, 36)',
                  emerald: 'rgb(52, 211, 153)',
                }[color],
              }}
              title={t(`settings.accent.${color}`, color.charAt(0).toUpperCase() + color.slice(1))}
            />
          ))}
        </div>
      </GlassCard>
        </>
      )}

      {activeTab === 'notify' && (
        <>
      {/* Notifications */}
      <GlassCard delay={0.1}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Bell size={16} className="text-aegis-warning" />
          {t('settings.notifications')}
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text">{t('settings.enableNotifications')}</div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.notificationsDesc')}</div>
            </div>
            <Toggle enabled={notificationsEnabled} onChange={handleNotificationsToggle} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {t('settings.sound')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.soundDesc')}</div>
            </div>
            <Toggle enabled={soundEnabled} onChange={handleSoundToggle} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                <BellOff size={14} />
                {t('settings.dnd')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.dndDesc')}</div>
            </div>
            <Toggle enabled={dndMode} onChange={handleDndToggle} />
          </div>

          <button
            onClick={() => notifications.notify({ type: 'info', title: t('app.title', 'JunQi Desktop'), body: t('settings.testNotification') })}
            className="text-[12px] px-4 py-2 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors"
          >
            🔔 {t('settings.testSound')}
          </button>
        </div>
      </GlassCard>
        </>
      )}

      {activeTab === 'pet' && (
        <>
      {/* Desktop Pet */}
      <GlassCard delay={0.12}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <span className="text-base">🐾</span>
          {t('pet.settings.title')}
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.settings.enabled')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.enabledHint')}</div>
          </div>
          <Toggle enabled={petEnabled} onChange={setPetEnabled} />
        </div>

        {/* Toggle the pet window: shown → hide (close_pet_window), hidden → recall (open_pet_window). */}
        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-[13px] text-aegis-text">
              {petVisible ? t('pet.settings.hidePet', '隐藏萌宠') : t('pet.settings.showPet', '显示萌宠')}
            </div>
            <div className="text-[11px] text-aegis-text-dim">
              {petVisible ? t('pet.settings.hidePetHint', '点击隐藏(也可托盘图标 / ⌘⇧H)') : t('pet.settings.showPetHint', '隐藏后一键唤回(也可托盘图标 / ⌘⇧H)')}
            </div>
          </div>
          <button
            disabled={!petEnabled}
            onClick={() => invoke(petVisible ? 'close_pet_window' : 'open_pet_window').catch(() => undefined)}
            className={clsx('text-[12px] px-3 py-1.5 rounded-xl border transition-colors',
              petEnabled ? 'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10' : 'border-aegis-border/20 text-aegis-text-dim opacity-40 cursor-not-allowed')}>
            {petVisible ? t('pet.settings.hide', '隐藏') : t('pet.settings.show', '显示')}
          </button>
        </div>

        {/* Skin picker */}
        <div className="flex items-center justify-between mt-4">
          <div className="text-[13px] text-aegis-text">{t('pet.settings.skin', '皮肤')}</div>
          <div className="flex gap-1 flex-wrap justify-end">
            {(Object.keys(SKIN_REGISTRY) as PetSkin[]).map((s) => (
              <button key={s} onClick={() => setPetSkin(s)}
                className={clsx('text-[12px] px-3 py-1.5 rounded-lg border transition-colors',
                  petSkin === s ? 'border-aegis-primary/50 text-aegis-text bg-aegis-primary/10' : 'border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text')}>
                {t(`pet.settings.${s}`, SKIN_FALLBACK[s])}
              </button>
            ))}
          </div>
        </div>

        {/* Custom upload */}
        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.settings.custom', '自定义素材')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.customHint', '上传 PNG/JPG/GIF/WebP，≤2MB')}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePetUpload}
              className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors">
              {petCustomAsset ? t('pet.settings.replace', '更换') : t('pet.settings.upload', '上传')}
            </button>
            {petCustomAsset && (
              <button onClick={handlePetClear}
                className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-danger transition-colors">
                {t('pet.settings.clear', '清除')}
              </button>
            )}
          </div>
        </div>
        {petUploadError && <div className="text-[11px] text-aegis-danger mt-2">{petUploadError}</div>}
      </GlassCard>

      {/* Pomodoro */}
      <GlassCard delay={0.14}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <span className="text-base">🍅</span>
          {t('pet.pomodoro.title', '番茄钟')}
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.pomodoro.enable', '启用番茄钟')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.pomodoro.enableHint', '工作时长提醒，专注与休息循环')}</div>
          </div>
          <Toggle enabled={petPomodoro.enabled} onChange={(v) => setPetPomodoro({ enabled: v })} />
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <label className="text-[12px] text-aegis-text-dim">{t('pet.pomodoro.workMin', '工作')}</label>
          <input type="number" min={1} max={120} value={petPomodoro.workMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ workMin: Math.max(1, Math.min(120, Number(e.target.value) || 30)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">min</span>
          <label className="text-[12px] text-aegis-text-dim ms-2">{t('pet.pomodoro.breakMin', '休息')}</label>
          <input type="number" min={1} max={60} value={petPomodoro.breakMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ breakMin: Math.max(1, Math.min(60, Number(e.target.value) || 5)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">min</span>
          <label className="text-[12px] text-aegis-text-dim ms-2">{t('pet.pomodoro.longBreakMin', '长休')}</label>
          <input type="number" min={1} max={60} value={petPomodoro.longBreakMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ longBreakMin: Math.max(1, Math.min(60, Number(e.target.value) || 15)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">min</span>
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button
            onClick={() => (petPomodoro.running ? stopPomodoro() : startPomodoro())}
            disabled={!petPomodoro.enabled}
            className={clsx('text-[12px] px-4 py-2 rounded-xl border transition-colors',
              petPomodoro.running ? 'border-aegis-danger/30 text-aegis-danger hover:bg-aegis-danger/10' : 'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10',
              !petPomodoro.enabled && 'opacity-40 cursor-not-allowed')}>
            {petPomodoro.running ? t('pet.pomodoro.stop', '停止') : t('pet.pomodoro.start', '开始')}
          </button>
          {petPomodoro.running && (
            <button
              onClick={() => togglePausePomodoro()}
              className="text-[12px] px-3 py-2 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors">
              {petPomodoro.paused ? t('pet.pomodoro.resume', '继续') : t('pet.pomodoro.pause', '暂停')}
            </button>
          )}
          {petPomodoro.running && (
            <span className="text-[13px] font-mono text-aegis-text">
              {petPomodoro.paused
                ? t('pet.pomodoro.paused', '已暂停') + ' ' + String(Math.floor(Math.max(0, petPomodoro.pausedRemainingMs ?? 0) / 60000)).padStart(2, '0') + ':' + String(Math.floor((Math.max(0, petPomodoro.pausedRemainingMs ?? 0) % 60000) / 1000)).padStart(2, '0')
                : (petPomodoro.phase === 'work' ? t('pet.pomodoro.focusing', '专注中') : t('pet.pomodoro.resting', '休息中')) +
                  ' ' + (petPomodoro.endsAt ? String(Math.floor(Math.max(0, petPomodoro.endsAt - petNow) / 60000)).padStart(2, '0') + ':' + String(Math.floor((Math.max(0, petPomodoro.endsAt - petNow) % 60000) / 1000)).padStart(2, '0') : '')}
            </span>
          )}
          <span className="text-[11px] text-aegis-text-dim ms-auto flex items-center gap-2">
            {petPomodoro.running && (
              <span className="flex items-center gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((n) => (
                  <span key={n} className={clsx('w-1.5 h-1.5 rounded-full transition-colors', n <= petPomodoro.workRounds ? 'bg-aegis-primary' : 'bg-aegis-border/40')} />
                ))}
              </span>
            )}
            {t('pet.pomodoro.completedToday', '今日')} {petPomodoro.completedDate === new Date().toISOString().slice(0, 10) ? petPomodoro.completedToday : 0} 🍅
          </span>
        </div>
      </GlassCard>
        </>
      )}

      {activeTab === 'connect' && (
        <>
      {/* Gateway */}
      <GlassCard delay={0.15}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          {connected ? <Wifi size={16} className="text-aegis-success" /> : <WifiOff size={16} className="text-aegis-danger" />}
          {t('settings.gateway', 'Gateway')}
        </h3>
        <div className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-aegis-text">{t('settingsExtra.connectionStatus')}</div>
            <div className="flex items-center gap-2">
              <StatusDot status={connected ? 'active' : connecting ? 'idle' : 'error'} size={7} />
              <span className={clsx('text-[12px] font-medium',
                connected ? 'text-aegis-success' : connecting ? 'text-aegis-warning' : 'text-aegis-danger'
              )}>
                {connected ? t('connection.connected') : connecting ? t('connection.connecting') : t('connection.disconnected')}
              </span>
            </div>
          </div>

          {/* Gateway URL — editable */}
          <div>
            <label className="text-[12px] text-aegis-text-muted font-medium mb-1.5 block">
              {t('settingsExtra.wsUrlLabel', 'WebSocket URL')}
            </label>
            <input
              type="text"
              value={editUrl}
              onChange={(e) => { setEditUrl(e.target.value); setConnectionDirty(true); }}
              placeholder={t('settingsExtra.wsUrlPlaceholder', 'ws://127.0.0.1:18789')}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                text-aegis-text placeholder:text-aegis-text-dim
                outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
              dir="ltr"
            />
            <div className="text-[10px] text-aegis-text-dim mt-1">
              {t('settings.gatewayUrlHint', 'Leave empty to use default (ws://127.0.0.1:18789)')}
            </div>
          </div>

          {/* Gateway Token — editable */}
          <div>
            <label className="text-[12px] text-aegis-text-muted font-medium mb-1.5 block">
              {t('settingsExtra.gatewayTokenLabel', 'Gateway Token')}
            </label>
            <input
              type="password"
              value={editToken}
              onChange={(e) => { setEditToken(e.target.value); setConnectionDirty(true); }}
              placeholder={t('settingsExtra.tokenPlaceholder')}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                text-aegis-text placeholder:text-aegis-text-dim
                outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
              dir="ltr"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {connectionDirty && (
              <button
                onClick={handleSaveConnection}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold
                  bg-aegis-primary/15 text-aegis-primary border border-aegis-primary/25
                  hover:bg-aegis-primary/25 transition-colors"
              >
                <CheckCircle size={13} />
                {t('settingsExtra.saveReconnect')}
              </button>
            )}
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors disabled:opacity-40"
            >
              {testingConnection ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
              {t('settings.testConnection')}
            </button>
            {!connected && !connectionDirty && (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
              >
                <Wifi size={13} />
                {t('connection.reconnect')}
              </button>
            )}
            {testResult && (
              <span className={clsx('text-[11px] flex items-center gap-1',
                testResult === 'success' ? 'text-aegis-success' : 'text-aegis-danger'
              )}>
                <CheckCircle size={12} />
                {testResult === 'success' ? '✓' : '✗'}
              </span>
            )}
          </div>
        </div>
      </GlassCard>
        </>
      )}

      {activeTab === 'storage' && (
        <>
      {/* Conversation files — same managed index as File Manager */}
      <GlassCard delay={0.28}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-1 flex items-center gap-2">
          <HardDrive size={16} className="text-aegis-primary" />
          {t('settings.attachmentsTemp')}
        </h3>
        <p className="text-[11px] text-aegis-text-dim/70 mb-4 leading-relaxed">
          {t('settings.attachmentsSectionHint')}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-aegis-text-dim">{t('settings.attachmentsCount')}</span>
            <span className="text-aegis-text">{managedIndexInfo?.indexedTotal ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-aegis-text-dim">{t('settings.attachmentsSize')}</span>
            <span className="text-aegis-text">
              {managedIndexInfo ? formatBytes(managedIndexInfo.indexedBytes) : '—'}
              {managedIndexInfo?.bytesIsPartial && (
                <span className="text-[10px] text-aegis-text-dim ms-1">
                  ({t('settings.attachmentsSizePartial', { loaded: managedIndexInfo.loadedRows, total: managedIndexInfo.indexedTotal })})
                </span>
              )}
            </span>
          </div>
          {!!managedIndexInfo?.workspaceSample && (
            <div className="text-[10px] text-aegis-text-dim break-all">
              {t('settings.attachmentsWorkspaceSample')}: {managedIndexInfo.workspaceSample}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (managedFilesRefreshing) return;
                setManagedFilesRefreshing(true);
                setAttachmentsStatus('');
                try {
                  const r = await refreshManagedIndexInfo();
                  if (r.success) setAttachmentsStatus(t('settings.attachmentsReady'));
                  else setAttachmentsStatus(r.error || t('settings.managedFilesListFailed'));
                } catch {
                  setAttachmentsStatus(t('settings.managedFilesListFailed'));
                } finally {
                  setManagedFilesRefreshing(false);
                }
              }}
              disabled={managedFilesRefreshing}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border transition-colors',
                managedFilesRefreshing
                  ? 'text-aegis-text-dim/60 border-aegis-border/10 cursor-not-allowed'
                  : 'text-aegis-text-dim hover:text-aegis-text border-aegis-border/20 hover:border-aegis-border/40',
              )}
            >
              <RefreshCw size={12} className={managedFilesRefreshing ? 'animate-spin' : ''} />
              {managedFilesRefreshing ? t('settings.refreshing') : t('settings.refresh')}
            </button>
          </div>
          {!!attachmentsStatus && (
            <div className="text-[11px] text-aegis-text-dim">
              {attachmentsStatus}
            </div>
          )}
        </div>
      </GlassCard>
        </>
      )}

      {activeTab === 'about' && (
        <>
      {/* About + System Info */}
      <GlassCard delay={0.3}>
        <div className="text-center py-4 mb-4">
          {/* JunQi Desktop brand mark */}
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
            style={{ background: 'rgb(var(--aegis-primary) / 0.15)', border: '1px solid rgb(var(--aegis-primary) / 0.25)' }}>
            <span className="text-[22px] font-extrabold tracking-tight text-aegis-primary">JQ</span>
          </div>
          <div className="text-[15px] font-bold text-aegis-text">JunQi Desktop</div>
          <div className="text-[12px] text-aegis-text-dim mt-1">v{APP_VERSION}</div>
          <div className="text-[11px] text-aegis-text-dim mt-0.5">{t('app.clientSubtitle')}</div>
          <div className="text-[11px] text-aegis-text-muted mt-2">{t('app.company')}</div>
          <div className="text-[10px] text-aegis-text-dim mt-0.5">{t('app.copyright', { year: new Date().getFullYear() })}</div>
        </div>
        <div className="space-y-2 border-t border-aegis-border/15 pt-3">
          {[
            ['OpenClaw', openclawVersion ? `v${openclawVersion}` : '—'],
            [t('settingsExtra.platform', 'Platform'), platformLabel],
            [t('settings.gateway', 'Gateway'), connected ? `${localStorage.getItem('aegis-gateway-http')?.replace('http', 'ws') || 'ws://127.0.0.1:18789'} ✓` : '— ✗'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] text-aegis-text-dim">{label}</span>
              {label === 'OpenClaw' ? (
                <button onClick={handleCheckVersion} disabled={checkingVersion} className="flex items-center gap-1.5 text-[10px] font-mono truncate max-w-[250px] disabled:opacity-50 transition-colors" title="Click to check for updates">
                  <span className={latestVersion && openclawVersion && latestVersion !== openclawVersion ? 'text-aegis-warning' : 'text-aegis-text-muted hover:text-aegis-primary'}>
                    {checkingVersion ? 'Checking…' : value}
                  </span>
                  {latestVersion && openclawVersion && latestVersion !== openclawVersion && (
                    <span className="text-[9px] px-1 py-px rounded bg-aegis-warning/15 text-aegis-warning border border-aegis-warning/30">
                      v{latestVersion} available
                    </span>
                  )}
                </button>
              ) : (
                <span className="text-[10px] font-mono text-aegis-text-muted truncate max-w-[250px]">{value}</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <button
            onClick={() => { void copyDiagnosticInfo(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors">
            <Copy size={12} /> {t('settingsExtra.copySystemInfo')}
          </button>

          {window.aegis?.logs && (
            <>
              <button
                onClick={() => { void openGatewayLogs(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors"
              >
                <FileText size={12} /> {t('settings.openGatewayLogs', '查看 Gateway 日志')}
              </button>
              <button
                onClick={() => { void openDesktopLogs(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors"
              >
                <FileText size={12} /> {t('settings.openDesktopLogs', '查看桌面日志')}
              </button>
            </>
          )}
        </div>

        {window.aegis?.consoleUi && (
          <div className="mt-3 flex items-center justify-center">
            <button
              onClick={() => window.aegis?.consoleUi?.open()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold
                bg-aegis-primary/15 text-aegis-primary border border-aegis-primary/30
                hover:bg-aegis-primary/25 transition-colors"
            >
              <MonitorDot size={13} /> {t('settings.controlUi', 'Control UI')}
            </button>
          </div>
        )}
      </GlassCard>
        </>
      )}
        </div>
      </div>
    </PageTransition>
  );
}
