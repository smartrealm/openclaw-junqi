// ═══════════════════════════════════════════════════════════
// SettingsPage — Full settings with Gateway, Theme, Model
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings, Bell, BellOff, Globe, Volume2, VolumeX,
  Wifi, WifiOff, CheckCircle, Loader2, Copy, Sun, Moon,
  MonitorDot, FileText, HardDrive, RefreshCw, Type, Glasses, PawPrint, Info, Clock, Palette, Radio, KeyRound, Wallet, Wrench, Sparkles, FolderOpen, TerminalSquare, PanelTop,
} from 'lucide-react';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { GlassCard } from '@/components/shared/GlassCard';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { PageTransition } from '@/components/shared/PageTransition';
import { OpenClawUpdatePanel } from '@/components/shared/OpenClawUpdatePanel';
import { StatusDot } from '@/components/shared/StatusDot';
import { useSettingsStore } from '@/stores/settingsStore';
import { ensureGroupFresh, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { notifications } from '@/services/notifications';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { PET_SKIN_OPTIONS } from '@/pet/skins';
import { SkinPreview } from '@/pet/SkinPreview';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { changeLanguage } from '@/i18n';
import { formatBytes } from '@/utils/format';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { GatewayLogPanel } from '@/components/settings/GatewayLogPanel';
import { GatewayLifecyclePanel } from '@/components/settings/GatewayLifecyclePanel';
import { MaintenanceCenter } from '@/components/settings/MaintenanceCenter';
import { TerminalSettingsPanel } from '@/components/settings/TerminalSettingsPanel';
import { usePrefersDark } from '@/hooks/usePrefersDark';
import { ACCENT_COLORS, type AccentColor } from '@/theme/accent';
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from '@/i18n/languages';
import clsx from 'clsx';

type SettingsTab = 'appearance' | 'terminal' | 'notify' | 'pet' | 'connect' | 'storage' | 'maintenance' | 'about';
const SETTINGS_TABS: readonly SettingsTab[] = ['appearance', 'terminal', 'notify', 'pet', 'connect', 'storage', 'maintenance', 'about'];

export function SettingsPageFull() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    theme, setTheme,
    uiScale, setUiScale,
    language, setLanguage,
    notificationsEnabled, setNotificationsEnabled,
    soundEnabled, setSoundEnabled,
    dndMode, setDndMode,
    dynamicIslandEnabled, setDynamicIslandEnabled,
    dynamicIslandAutoExpand, setDynamicIslandAutoExpand,
    gatewayUrl, setGatewayUrl,
    budgetLimit, setBudgetLimit,
    gatewayToken, setGatewayToken,
    accentColor, setAccentColor,
    picovoiceAccessKey, setPicovoiceAccessKey,
    wakeWord, setWakeWord,
    wakeSensitivity, setWakeSensitivity,
  } = useSettingsStore();
  const costSummary = useGatewayDataStore((s) => s.costSummary);

  useEffect(() => {
    if (budgetLimit > 0) void ensureGroupFresh('cost');
  }, [budgetLimit]);
  const { connected, connecting } = useChatStore();
  const prefersDark = usePrefersDark();
  const { enabled: petEnabled, setEnabled: setPetEnabled, skin: petSkin, setSkin: setPetSkin, customAsset: petCustomAsset, setCustomAsset: setPetCustomAsset, customPet, setCustomPet, pomodoro: petPomodoro, setPomodoro: setPetPomodoro, petVisible, setPetVisible, soundEnabled: petSoundEnabled, setSoundEnabled: setPetSoundEnabled } = usePetStore();
  const [petUploadError, setPetUploadError] = useState<string | null>(null);
  const [petIdea, setPetIdea] = useState('');
  const [preparingPetSkill, setPreparingPetSkill] = useState(false);
  const [availablePets, setAvailablePets] = useState<Array<{ id: string; displayName: string; description: string; manifestPath: string }>>([]);
  const [selectedPetManifest, setSelectedPetManifest] = useState('');
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
      setCustomPet(null);
    } catch (e) {
      setPetUploadError(e instanceof Error ? e.message : String(e));
    }
  };
  const importAnimatedPet = async (manifestPath?: string) => {
    setPetUploadError(null);
    try {
      let selected = manifestPath;
      if (!selected) {
        const picked = await openDialog({
          multiple: false,
          filters: [{ name: 'JunQi Pet', extensions: ['json'] }],
        });
        if (!picked || Array.isArray(picked)) return;
        selected = picked;
      }
      const pet = await invoke<import('@/stores/petStore').CustomPetPackage>('import_pet_package', {
        manifestPath: selected,
        locale: i18n.resolvedLanguage ?? i18n.language,
      });
      setCustomPet(pet);
      setPetCustomAsset(null);
    } catch (e) {
      setPetUploadError(e instanceof Error ? e.message : String(e));
    }
  };
  const refreshPetPackages = async () => {
    setPetUploadError(null);
    try {
      const pets = await invoke<typeof availablePets>('list_pet_packages');
      setAvailablePets(pets);
      setSelectedPetManifest((current) => current || pets[0]?.manifestPath || '');
    } catch (e) {
      setPetUploadError(e instanceof Error ? e.message : String(e));
    }
  };
  const createAnimatedPet = async () => {
    const idea = petIdea.trim();
    if (!idea) {
      setPetUploadError(t('pet.settings.describeFirst'));
      return;
    }
    setPetUploadError(null);
    setPreparingPetSkill(true);
    try {
      // PetWindow uses this timestamp to promote only the package generated
      // by this chat request, never an older library item the user selected.
      localStorage.setItem('junqi:pet-package-pending-after', String(Date.now()));
      await invoke('install_builtin_skill_for_chat', {
        skillId: 'hatch-pet',
      });
      const { activeSessionKey, setDraft } = useChatStore.getState();
      setDraft(activeSessionKey, `@hatch-pet ${idea}`);
      navigate('/chat');
    } catch (error) {
      localStorage.removeItem('junqi:pet-package-pending-after');
      setPetUploadError(t('pet.settings.builtinSkillError', {
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setPreparingPetSkill(false);
    }
  };
  const handlePetClear = async () => {
    setPetUploadError(null);
    await invoke('clear_pet_asset').catch(() => undefined);
    await invoke('clear_pet_package').catch(() => undefined);
    setPetCustomAsset(null);
    setCustomPet(null);
  };

  const [openclawVersion, setOpenclawVersion] = useState<string | null>(null);
  const [platformLabel, setPlatformLabel] = useState<string>('—');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState(gatewayToken);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => (
    SETTINGS_TABS.includes(requestedTab as SettingsTab) ? requestedTab as SettingsTab : 'appearance'
  ));

  useEffect(() => {
    if (SETTINGS_TABS.includes(requestedTab as SettingsTab)) setActiveTab(requestedTab as SettingsTab);
  }, [requestedTab]);

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    if (activeTab !== 'pet') return;
    void invoke<import('@/stores/petStore').CustomPetPackage | null>('load_pet_package')
      .then((pet) => {
        setCustomPet(pet);
        if (pet) setPetCustomAsset(null);
      })
      .catch(() => undefined);
    void refreshPetPackages();
  // The pet tab is the ownership boundary for loading package metadata.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  const refreshManagedIndexInfo = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
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
    } catch (error: unknown) {
      setManagedIndexInfo(null);
      const message = error instanceof Error ? error.message : '';
      return { success: false, error: message || t('settings.managedFilesListFailed') };
    }
  }, [t]);

  useEffect(() => {
    refreshManagedIndexInfo().then((r) => {
      if (!r.success && r.error) setAttachmentsStatus(r.error);
    });
  }, [refreshManagedIndexInfo]);

  const handleLanguageChange = (lang: AppLanguage) => {
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

  const openControlUi = async () => {
    try {
      const result = await window.aegis?.consoleUi?.open();
      if (result?.success) return;
    } catch {
      // Fall through to the normal Gateway recovery path below.
    }
    notifyInfo(
      t('settings.controlUi', 'Control UI'),
      t('settings.controlUiRecovering', 'Gateway 正在恢复，连接完成后将自动打开 Control UI。'),
    );
    window.dispatchEvent(new CustomEvent('aegis:manual-reconnect', {
      detail: { action: 'reconnect', source: 'settings-control-ui', openControlUi: true },
    }));
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
      gatewayManager.connect(url, token);
      // Poll the store for up to 5 s (50 × 100 ms) instead of a fixed 2.5 s sleep.
      // This resolves faster on quick connections and is more reliable on slow ones.
      let connected = false;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (useChatStore.getState().connected) { connected = true; break; }
      }
      setTestResult(connected ? 'success' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleReconnect = async () => {
    const { url, token } = await resolveConnectionUrl();
    gatewayManager.connect(url, token);
  };

  const handleSaveConnection = () => {
    setGatewayUrl(editUrl.trim());
    setGatewayToken(editToken.trim());
    setConnectionDirty(false);
    // Reconnect with new settings
    const url = editUrl.trim() || 'ws://127.0.0.1:18789';
    gatewayManager.connect(url, editToken.trim());
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

      {/* Horizontal tab bar */}
      <div className="flex gap-1 border-b border-aegis-border pb-0 overflow-x-auto" role="tablist" aria-label={t('settings.title')}>
        {([
          ['appearance', t('settings.tab.appearance', '外观'), Sun],
          ['terminal', t('settings.tab.terminal', '终端'), TerminalSquare],
          ['notify', t('settings.tab.notify', '通知'), Bell],
          ['pet', t('settings.tab.pet', '萌宠'), PawPrint],
          ['connect', t('settings.tab.connect', '连接'), Wifi],
          ['storage', t('settings.tab.storage', '存储'), HardDrive],
          ['maintenance', t('settings.tab.maintenance', '检修'), Wrench],
          ['about', t('settings.tab.about', '关于'), Info],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => selectTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-[13px] font-medium transition-colors border-b-2 -mb-[1px] whitespace-nowrap',
              activeTab === key
                ? 'text-aegis-primary border-aegis-primary bg-aegis-primary/[0.06]'
                : 'text-aegis-text-muted border-transparent hover:text-aegis-text hover:border-aegis-border'
            )}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-6">

      {activeTab === 'terminal' && <TerminalSettingsPanel />}

      {activeTab === 'maintenance' && <MaintenanceCenter />}

      {activeTab === 'appearance' && (
        <>
      {/* Language */}
      <GlassCard delay={0.05}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Globe size={16} className="text-aegis-primary" />
          {t('settings.language')}
        </h3>
        <div className="flex items-center gap-3">
          {APP_LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleLanguageChange(option.value)}
              className={clsx(
                'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
                language === option.value
                  ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                  : 'border-aegis-border/20 text-aegis-text-dim hover:border-aegis-border/40',
              )}
            >
              {option.label}
            </button>
          ))}
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

      {/* Budget Limit */}
      <GlassCard delay={0.09}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Wallet size={16} className="text-aegis-primary" />
          {t('chat.budgetLimit', '30-day budget limit ($)')}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-aegis-text-muted">$</span>
          <input
            type="number"
            min={0}
            step={1}
            value={budgetLimit || 0}
            onChange={(e) => setBudgetLimit(Math.max(0, Number(e.target.value) || 0))}
            className="w-28 bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border rounded-lg px-3 py-1.5 text-[13px] text-aegis-text outline-none focus:border-aegis-primary/50"
          />
          <span className="text-[11px] text-aegis-text-dim">
            {t('chat.budgetLimitHint', '0 = no limit. New messages are blocked once exceeded.')}
          </span>
        </div>
        {budgetLimit > 0 && (() => {
          const used = costSummary?.totals?.totalCost ?? 0;
          const pct = Math.min(100, Math.round((used / budgetLimit) * 100));
          const over = used >= budgetLimit;
          return (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className={over ? 'text-aegis-danger' : 'text-aegis-text-dim'}>
                  {'$' + used.toFixed(2) + ' / $' + budgetLimit.toFixed(2)}
                </span>
                <span className={over ? 'text-aegis-danger font-bold' : 'text-aegis-text-muted'}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[rgb(var(--aegis-overlay)/0.06)] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: pct + '%', background: over ? 'rgb(var(--aegis-danger))' : 'rgb(var(--aegis-primary))' }} />
              </div>
            </div>
          );
        })()}
      </GlassCard>

      {/* Accent Color */}
      <GlassCard delay={0.10}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Palette size={16} className="text-aegis-primary" />
          {t('settings.accentColor', 'Accent Color')}
        </h3>
        <div className="flex gap-3 flex-wrap">
          {ACCENT_COLORS.map((color: AccentColor) => (
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

      <GlassCard delay={0.12}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <PanelTop size={16} className="text-aegis-primary" />
          {t('settings.dynamicIsland', '灵动岛')}
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-5">
            <div>
              <div className="text-[13px] text-aegis-text">{t('settings.dynamicIslandEnabled', '启用灵动岛')}</div>
              <div className="text-[11px] leading-5 text-aegis-text-dim">{t('settings.dynamicIslandDesc', '主窗口最小化且会话正在执行时显示；拖入文件时临时显示接收状态。')}</div>
            </div>
            <Toggle enabled={dynamicIslandEnabled} onChange={setDynamicIslandEnabled} />
          </div>

          <div className="flex items-center justify-between gap-5">
            <div>
              <div className="text-[13px] text-aegis-text">{t('settings.dynamicIslandAutoExpand', '重要状态自动展开')}</div>
              <div className="text-[11px] leading-5 text-aegis-text-dim">{t('settings.dynamicIslandAutoExpandDesc', '等待输入、执行完成、失败或接收文件时短暂展开，随后自动收起。')}</div>
            </div>
            <Toggle enabled={dynamicIslandAutoExpand} onChange={setDynamicIslandAutoExpand} disabled={!dynamicIslandEnabled} />
          </div>

          <button
            type="button"
            disabled={!dynamicIslandEnabled}
            onClick={() => invoke('open_dynamic_island').catch(() => undefined)}
            className={clsx(
              'text-[12px] px-4 py-2 rounded-lg border transition-colors',
              dynamicIslandEnabled
                ? 'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10'
                : 'border-aegis-border/20 text-aegis-text-dim opacity-40 cursor-not-allowed',
            )}
          >
            {t('settings.dynamicIslandPreview', '预览灵动岛')}
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
          <PawPrint size={15} className="text-aegis-text-dim" />
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

        {/* Skin picker — live thumbnails so the choice is visual, not just a word. */}
        <div className="mt-4">
          <div className="text-[13px] text-aegis-text mb-2">{t('pet.settings.skin', '皮肤')}</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {PET_SKIN_OPTIONS.map(({ id, label }) => (
              <button key={id} onClick={() => setPetSkin(id)}
                aria-pressed={petSkin === id}
                className={clsx('flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors',
                  petSkin === id ? 'border-aegis-primary/60 bg-aegis-primary/10' : 'border-aegis-border/20 hover:border-aegis-border/50')}>
                <SkinPreview skin={id} size={44} />
                <span className={clsx('text-[11px] leading-none', petSkin === id ? 'text-aegis-text' : 'text-aegis-text-dim')}>
                  {t(`pet.settings.${id}`, label)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Sound effects toggle — drives the WebAudio cues played during
            drag-drop. Persists via the pet store's partialize list so the
            preference survives an app restart. */}
        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.settings.sound', '提示音')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.soundHint', '拖动文件时播放轻柔提示音')}</div>
          </div>
          <button
            onClick={() => setPetSoundEnabled(!petSoundEnabled)}
            aria-pressed={petSoundEnabled}
            className={clsx(
              'relative w-10 h-6 rounded-full transition-colors',
              petSoundEnabled ? 'bg-aegis-primary' : 'bg-aegis-border/40',
            )}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: petSoundEnabled ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </button>
        </div>

        {/* Custom static upload */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-aegis-border/20">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.settings.custom', '自定义素材')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.customHint', '上传 PNG/JPG/GIF/WebP，≤2MB')}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePetUpload}
              className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors">
              {petCustomAsset ? t('pet.settings.replace', '更换') : t('pet.settings.upload', '上传')}
            </button>
            {(petCustomAsset || customPet) && (
              <button onClick={handlePetClear}
                className="text-[12px] px-3 py-1.5 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-danger transition-colors">
                {t('pet.settings.clear', '清除')}
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[13px] text-aegis-text">{t('pet.settings.animatedTitle')}</div>
              <div className="text-[11px] text-aegis-text-dim">
                {customPet
                  ? t('pet.settings.animatedUsing', { name: customPet.displayName })
                  : t('pet.settings.animatedHint')}
              </div>
            </div>
            <button onClick={() => void importAnimatedPet()}
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-aegis-border/30 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/60 transition-colors">
              <FolderOpen size={13} />{t('pet.settings.importManifest')}
            </button>
          </div>
          <div className="flex gap-2">
            <input value={petIdea} onChange={(event) => setPetIdea(event.target.value)}
              placeholder={t('pet.settings.ideaPlaceholder')}
              className="min-w-0 flex-1 px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text placeholder:text-aegis-text-dim" />
            <button onClick={() => void createAnimatedPet()} disabled={preparingPetSkill}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] bg-aegis-primary text-white hover:opacity-90 transition-opacity disabled:cursor-wait disabled:opacity-60">
              {preparingPetSkill ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {preparingPetSkill ? t('pet.settings.preparingBuiltinSkill') : t('pet.settings.createInChat')}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void refreshPetPackages()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-aegis-border/30 text-aegis-text-dim hover:text-aegis-text">
              <RefreshCw size={12} />{t('pet.settings.refreshLibrary')}
            </button>
            {availablePets.length > 0 && (
              <>
                <select value={selectedPetManifest} onChange={(event) => setSelectedPetManifest(event.target.value)}
                  className="min-w-0 flex-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text">
                  {availablePets.map((pet) => <option key={pet.manifestPath} value={pet.manifestPath}>{pet.displayName}</option>)}
                </select>
                <button onClick={() => void importAnimatedPet(selectedPetManifest)} disabled={!selectedPetManifest}
                  className="px-3 py-1.5 rounded-lg text-[11px] border border-aegis-primary/40 text-aegis-primary hover:bg-aegis-primary/10 disabled:opacity-40">
                  {t('pet.settings.useAnimatedPet')}
                </button>
              </>
            )}
          </div>
        </div>
        {petUploadError && <div className="text-[11px] text-aegis-danger mt-2">{petUploadError}</div>}
      </GlassCard>

      {/* Pomodoro */}
      <GlassCard delay={0.14}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Clock size={15} className="text-aegis-text-dim" />
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
            {t('pet.pomodoro.completedToday', '今日')} {petPomodoro.completedDate === new Date().toISOString().slice(0, 10) ? petPomodoro.completedToday : 0} <Clock size={12} className="inline" />
          </span>
        </div>
      </GlassCard>

      {/* Voice Wake (phase 2 config) */}
      <GlassCard delay={0.14}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Radio size={16} className="text-aegis-primary" />
          {t('voiceWake.title', '语音唤醒')}
        </h3>
        <div className="space-y-4">
          <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.02)] p-3 text-[11px] leading-relaxed text-aegis-text-dim">
            {t('voiceWake.hint', '语音唤醒使用 Porcupine 引擎。在 Picovoice Console 免费注册获取 AccessKey，填入后启用真唤醒词；未配置时回退到 VAD 占位（检测到说话即触发）。')}
          </div>

          <div>
            <label className="text-[12px] text-aegis-text-dim mb-1.5 flex items-center gap-1.5">
              <KeyRound size={12} />
              {t('voiceWake.accessKey', 'Picovoice AccessKey')}
            </label>
            <input
              type="password"
              value={picovoiceAccessKey}
              onChange={(e) => setPicovoiceAccessKey(e.target.value)}
              placeholder={t('voiceWake.accessKeyPlaceholder', '在 console.picovoice.ai 免费获取')}
              className="w-full bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border/30 rounded-lg px-3 py-2 text-[13px] text-aegis-text outline-none focus:border-aegis-primary/40 font-mono"
            />
          </div>

          <div>
            <label className="text-[12px] text-aegis-text-dim mb-1.5">{t('voiceWake.keyword', '唤醒词')}</label>
            <input
              type="text"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              placeholder={t('voiceWake.keywordPlaceholder', '内置词如 porcupine / hey google，留空用默认')}
              className="w-full bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border/30 rounded-lg px-3 py-2 text-[13px] text-aegis-text outline-none focus:border-aegis-primary/40"
            />
          </div>

          <div>
            <label className="text-[12px] text-aegis-text-dim mb-1.5 flex items-center justify-between">
              <span>{t('voiceWake.sensitivity', '灵敏度')}</span>
              <span className="font-mono text-aegis-text-muted">{wakeSensitivity.toFixed(2)}</span>
            </label>
            <input
              type="range" min="0" max="1" step="0.05" value={wakeSensitivity}
              onChange={(e) => setWakeSensitivity(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, rgb(var(--aegis-primary)) 0%, rgb(var(--aegis-primary)) ${wakeSensitivity * 100}%, rgb(var(--aegis-overlay) / 0.15) ${wakeSensitivity * 100}%, rgb(var(--aegis-overlay) / 0.15) 100%)`,
                accentColor: 'rgb(var(--aegis-primary))',
              }}
            />
            <div className="flex justify-between text-[10px] text-aegis-text-dim mt-1">
              <span>{t('voiceWake.sensLow', '低误触')}</span>
              <span>{t('voiceWake.sensHigh', '高灵敏')}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <StatusDot status={picovoiceAccessKey.trim() ? 'active' : 'idle'} size={8} />
            <span className="text-aegis-text-dim">
              {picovoiceAccessKey.trim()
                ? t('voiceWake.configured', '已配置 AccessKey，将使用 Porcupine 真唤醒词')
                : t('voiceWake.notConfigured', '未配置，使用 VAD 占位（检测说话即触发）')}
            </span>
          </div>
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
      <GatewayLifecyclePanel variant="full" />

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

      {/* Gateway Log (SPEC §M6, T5) — 200-entry circular buffer viewer. */}
      <GatewayLogPanel />
        </>
      )}

      {activeTab === 'about' && (
        <>
      {/* About + System Info */}
      <GlassCard delay={0.3}>
        <div className="text-center py-4 mb-4">
          <div className="mb-4 flex justify-center">
            <div className="rounded-xl border border-aegis-border/50 bg-aegis-elevated px-5 py-3 shadow-sm">
              <JunQiLogo
                variant="full"
                className="h-[64px] w-[320px] max-w-full"
                title="陕西浚启智境科技有限公司"
              />
            </div>
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
              <span className="text-[10px] font-mono text-aegis-text-muted truncate max-w-[250px]">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <OpenClawUpdatePanel
            compact
            currentVersion={openclawVersion}
            onUpdated={(version) => {
              if (version) setOpenclawVersion(version);
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <button
            onClick={() => { void copyDiagnosticInfo(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors">
            <Copy size={12} /> {t('settingsExtra.copySystemInfo')}
          </button>

          <button
            onClick={() => selectTab('maintenance')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors"
          >
            <Wrench size={12} />
            {t('settings.openMaintenance', '打开检修')}
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
              onClick={() => { void openControlUi(); }}
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
    </PageTransition>
  );
}
