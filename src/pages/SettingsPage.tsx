// ═══════════════════════════════════════════════════════════
// SettingsPage — Full settings with Gateway, Theme, Model
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings, Bell, BellOff, Globe, Volume2, VolumeX,
  Wifi, WifiOff, CheckCircle, Copy, Sun, Moon,
  MonitorDot, FileText, HardDrive, RefreshCw, Type, PawPrint, Info, Clock, Palette, Wallet, Wrench, Sparkles, FolderOpen, TerminalSquare, PanelTop, Trash2,
} from 'lucide-react';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { GlassCard, GlassCardEnterMotionScope } from '@/components/shared/GlassCard';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { PageTransition } from '@/components/shared/PageTransition';
import { OpenClawUpdatePanel } from '@/components/shared/OpenClawUpdatePanel';
import { StatusDot } from '@/components/shared/badge';
import { useSettingsStore } from '@/stores/settingsStore';
import { ensureGroupFresh, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { gatewayLifecycle } from '@/services/gateway/gatewayLifecycle';
import { openSelectedGatewayControlUi } from '@/services/gateway/GatewayControlUi';
import {
  getStoredGatewayCredentialToken,
  resolveGatewayConnectionTarget,
} from '@/services/gateway/GatewayConnectionTargetResolver';
import { notifications } from '@/services/notifications';
import { openRuntimeDataDirectory } from '@/services/runtimeDataDirectory';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from '@/pet/petActions';
import { PET_SKIN_OPTIONS } from '@/pet/skins';
import { SkinPreview } from '@/pet/SkinPreview';
import { invoke } from '@tauri-apps/api/core';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { changeLanguage } from '@/i18n';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { GatewayLogPanel } from '@/components/settings/GatewayLogPanel';
import { GatewayLifecyclePanel } from '@/components/settings/GatewayLifecyclePanel';
import { MaintenanceCenter } from '@/components/settings/MaintenanceCenter';
import { TerminalSettingsPanel } from '@/components/settings/TerminalSettingsPanel';
import { NpmCacheSettingsPanel } from '@/components/settings/NpmCacheSettingsPanel';
import { ManagedRuntimeSettingsPanel } from '@/components/settings/ManagedRuntimeSettingsPanel';
import { FontPanel } from '@/components/settings/FontPanel';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';
import { StructuredPlanSettingsPanel } from '@/components/settings/StructuredPlanSettingsPanel';
import { useOpenClawPlanToolSetting } from '@/hooks/useOpenClawPlanToolSetting';
import { usePrefersDark } from '@/hooks/usePrefersDark';
import { ACCENT_COLORS, type AccentColor } from '@/theme/accent';
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from '@/i18n/languages';
import clsx from 'clsx';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

type SettingsTab = 'appearance' | 'terminal' | 'notify' | 'pet' | 'connect' | 'storage' | 'maintenance' | 'about';
const SETTINGS_TABS: readonly SettingsTab[] = ['appearance', 'terminal', 'notify', 'pet', 'connect', 'storage', 'maintenance', 'about'];

export function SettingsPageFull() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    theme, setTheme,
    uiScale, setUiScale,
    uiFont, setUiFont,
    monoFont, setMonoFont,
    editorFont, setEditorFont,
    language, setLanguage,
    notificationsEnabled, setNotificationsEnabled,
    soundEnabled, setSoundEnabled,
    audioAutoPlay, setAudioAutoPlay,
    voiceAutoSpeak, setVoiceAutoSpeak,
    dndMode, setDndMode,
    dynamicIslandEnabled, setDynamicIslandEnabled,
    dynamicIslandAutoExpand, setDynamicIslandAutoExpand,
    gatewayUrl, setGatewayUrl,
    budgetLimit, setBudgetLimit,
    setGatewayToken,
    accentColor, setAccentColor,
  } = useSettingsStore();
  const costSummary = useGatewayDataStore((s) => s.costSummary);

  useEffect(() => {
    if (budgetLimit > 0) void ensureGroupFresh('cost');
  }, [budgetLimit]);
  const { connected, connecting } = useChatStore();
  const prefersDark = usePrefersDark();
  const { enabled: petEnabled, setEnabled: setPetEnabled, skin: petSkin, setSkin: setPetSkin, customAsset: petCustomAsset, setCustomAsset: setPetCustomAsset, customPet, setCustomPet, pomodoro: petPomodoro, setPomodoro: setPetPomodoro, petVisible, soundEnabled: petSoundEnabled, setSoundEnabled: setPetSoundEnabled, backdropContrastEnabled, setBackdropContrastEnabled, captionScale: petCaptionScale, setCaptionScale: setPetCaptionScale } = usePetStore();
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
    try {
      await Promise.all([
        invoke('clear_pet_asset'),
        invoke('clear_pet_package'),
      ]);
      setPetCustomAsset(null);
      setCustomPet(null);
    } catch (error) {
      setPetUploadError(error instanceof Error ? error.message : String(error));
    }
  };

  const [openclawVersion, setOpenclawVersion] = useState<string | null>(null);
  const [platformLabel, setPlatformLabel] = useState<string>('—');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState('');
  const [tokenDirty, setTokenDirty] = useState(false);
  const [hasStoredGatewayToken, setHasStoredGatewayToken] = useState(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const requestedTab = searchParams.get('tab');
  const activeTab: SettingsTab = SETTINGS_TABS.includes(requestedTab as SettingsTab)
    ? requestedTab as SettingsTab
    : 'appearance';
  const structuredPlans = useOpenClawPlanToolSetting(activeTab === 'connect' && connected);

  useEffect(() => {
    if (activeTab !== 'connect') return;
    let cancelled = false;
    void getStoredGatewayCredentialToken(gatewayUrl.trim()).then((token) => {
      if (!cancelled) setHasStoredGatewayToken(Boolean(token));
    }).catch(() => {
      if (!cancelled) setHasStoredGatewayToken(false);
    });
    return () => { cancelled = true; };
  }, [activeTab, gatewayUrl]);

  useEffect(() => {
    if (!connectionDirty) setEditUrl(gatewayUrl);
  }, [connectionDirty, gatewayUrl]);

  const selectTab = (tab: SettingsTab) => {
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
      .catch((error) => {
        setPetUploadError(error instanceof Error ? error.message : String(error));
      });
    void refreshPetPackages();
  // The pet tab is the ownership boundary for loading package metadata.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    window.aegis?.app?.versions()
      .then((v) => setOpenclawVersion(v.openclaw ?? (v as any).runtime ?? null))
      .catch(() => {});
    window.aegis?.app?.platformInfo?.().then(setPlatformLabel).catch(() => {});
  }, []);

  const handleLanguageChange = (lang: AppLanguage) => {
    setLanguage(lang);
    changeLanguage(lang);
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
  };

  const handleDndToggle = (dnd: boolean) => {
    setDndMode(dnd);
  };

  const notifyInfo = (title: string, body: string) => {
    notifications.notify({ type: 'info', title, body });
  };

  const notifyError = (title: string, body: string) => {
    notifications.notify({ type: 'error', title, body });
  };

  const openControlUi = async () => {
    try {
      const result = await openSelectedGatewayControlUi();
      if (result.success) return;
    } catch {
      // Fall through to the normal Gateway recovery path below.
    }
    notifyInfo(
      t('settings.controlUi', 'Control UI'),
      t('settings.controlUiRecovering'),
    );
    void gatewayLifecycle.recover('settings-control-ui').then((result) => {
      if (result.success) void openSelectedGatewayControlUi();
    });
  };

  const copyDiagnosticInfo = async () => {
    const gatewayUrl = localStorage.getItem('aegis-gateway-http')?.replace('http', 'ws') || defaultGatewayWsUrl();
    const hasGatewayToken = Boolean(editToken.trim() || hasStoredGatewayToken);
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

  const openRuntimeData = async () => {
    try {
      const res = await openRuntimeDataDirectory();
      if (res?.success) return;
      notifyError(t('settings.openRuntimeData', '打开运行数据目录'), res?.error || t('settings.managedFilesListFailed'));
    } catch (err: any) {
      notifyError(t('settings.openRuntimeData', '打开运行数据目录'), err?.message || t('settings.managedFilesListFailed'));
    }
  };

  const resolveConnectionUrl = () => resolveGatewayConnectionTarget({
    preferredUrl: editUrl,
    tokenOverride: editToken,
    useTokenOverride: tokenDirty,
  });

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const { wsUrl, token, deviceToken } = await resolveConnectionUrl();
      gatewayManager.connect(wsUrl, token, deviceToken);
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
    setTestResult(null);
    try {
      const { wsUrl, token, deviceToken } = await resolveConnectionUrl();
      gatewayManager.connect(wsUrl, token, deviceToken);
    } catch {
      setTestResult('fail');
    }
  };

  const handleSaveConnection = async () => {
    setTestResult(null);
    try {
      const { wsUrl, token, deviceToken } = await resolveConnectionUrl();
      setGatewayUrl(editUrl.trim());
      if (tokenDirty) setGatewayToken(editToken.trim());
      setHasStoredGatewayToken(Boolean(token || deviceToken));
      setEditToken('');
      setTokenDirty(false);
      setConnectionDirty(false);
      gatewayManager.connect(wsUrl, token, deviceToken);
    } catch {
      setTestResult('fail');
    }
  };

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
          ['appearance', t('settings.tab.appearance'), Sun],
          ['terminal', t('settings.tab.terminal'), TerminalSquare],
          ['notify', t('settings.tab.notify'), Bell],
          ['pet', t('settings.tab.pet'), PawPrint],
          ['connect', t('settings.tab.connect'), Wifi],
          ['storage', t('settings.tab.storage'), HardDrive],
          ['maintenance', t('settings.tab.maintenance'), Wrench],
          ['about', t('settings.tab.about'), Info],
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
      <GlassCardEnterMotionScope enabled={false}>
      <div className="space-y-6">

      {activeTab === 'terminal' && <TerminalSettingsPanel />}

      {activeTab === 'maintenance' && (
        <MaintenanceCenter
          onRecoverGateway={() => gatewayLifecycle.recover('settings-maintenance')}
          onOpenConfig={(category) => {
            const tab = category === 'mcp' ? 'tools' : category === 'security' ? 'secrets' : 'advanced';
            navigate(`/config?tab=${tab}`);
          }}
        />
      )}

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

      {/* Theme — 1:1 junqi ThemePanel: system toggle + 2×2 manual cards */}
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

      <GlassCard delay={0.1}>
        <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-aegis-text">
          <Type size={16} className="text-aegis-primary" />
          {t('font.title', 'Typography')}
        </h3>
        <FontPanel
          uiFont={uiFont}
          onUiFontChange={setUiFont}
          monoFont={monoFont}
          onMonoFontChange={setMonoFont}
          editorFont={editorFont}
          onEditorFontChange={setEditorFont}
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
              title={t(`settings.accent.${color}`)}
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
            <SettingsSwitch checked={notificationsEnabled} onCheckedChange={handleNotificationsToggle} label={t('settings.enableNotifications')} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {t('settings.sound')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.soundDesc')}</div>
            </div>
            <SettingsSwitch checked={soundEnabled} onCheckedChange={handleSoundToggle} label={t('settings.sound')} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                <Volume2 size={14} />
                {t('settings.audioAutoPlay', '自动播放实时回复音频')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">
                {t('settings.audioAutoPlayDesc', '自动播放助手实时回复携带的音频；历史录音仍需手动播放。')}
              </div>
            </div>
            <SettingsSwitch checked={audioAutoPlay} label={t('settings.audioAutoPlay', '自动播放实时回复音频')} onCheckedChange={(enabled) => {
              setAudioAutoPlay(enabled);
              if (!enabled) voiceRuntime.interruptAll();
            }} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                <Volume2 size={14} />
                {t('settings.voiceAutoSpeak', '自动语音回复')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">
                {t('settings.voiceAutoSpeakDesc', '用系统语音朗读当前会话的助手回复，可随时打断。')}
              </div>
            </div>
            <SettingsSwitch checked={voiceAutoSpeak} label={t('settings.voiceAutoSpeak', '自动语音回复')} onCheckedChange={(enabled) => {
              setVoiceAutoSpeak(enabled);
              if (!enabled) voiceRuntime.interruptAll();
            }} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                <BellOff size={14} />
                {t('settings.dnd')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.dndDesc')}</div>
            </div>
            <SettingsSwitch checked={dndMode} onCheckedChange={handleDndToggle} label={t('settings.dnd')} />
          </div>

          <button
            type="button"
            disabled={!notificationsEnabled || dndMode}
            onClick={() => notifications.notify({ type: 'info', title: t('app.name'), body: t('settings.testNotification') })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-aegis-border/20 px-4 py-2 text-[12px] text-aegis-text-dim transition-colors hover:border-aegis-border/40 hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Bell size={13} aria-hidden="true" />
            {t('settings.testSound')}
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
            <SettingsSwitch checked={dynamicIslandEnabled} onCheckedChange={setDynamicIslandEnabled} label={t('settings.dynamicIslandEnabled', '启用灵动岛')} />
          </div>

          <div className="flex items-center justify-between gap-5">
            <div>
              <div className="text-[13px] text-aegis-text">{t('settings.dynamicIslandAutoExpand', '重要状态自动展开')}</div>
              <div className="text-[11px] leading-5 text-aegis-text-dim">{t('settings.dynamicIslandAutoExpandDesc', '等待输入、执行完成、失败或接收文件时短暂展开，随后自动收起。')}</div>
            </div>
            <SettingsSwitch checked={dynamicIslandAutoExpand} onCheckedChange={setDynamicIslandAutoExpand} disabled={!dynamicIslandEnabled} label={t('settings.dynamicIslandAutoExpand', '重要状态自动展开')} />
          </div>

          <button
            type="button"
            disabled={!dynamicIslandEnabled}
            onClick={() => {
              void invoke('open_dynamic_island').catch((error) => {
                notifyError(
                  t('settings.dynamicIslandPreview', '预览灵动岛'),
                  error instanceof Error ? error.message : String(error),
                );
              });
            }}
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
          <SettingsSwitch checked={petEnabled} onCheckedChange={setPetEnabled} label={t('pet.settings.enabled')} />
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
            type="button"
            disabled={!petEnabled}
            onClick={() => {
              setPetUploadError(null);
              void invoke(petVisible ? 'close_pet_window' : 'open_pet_window').catch((error) => {
                setPetUploadError(error instanceof Error ? error.message : String(error));
              });
            }}
            className={clsx('text-[12px] px-3 py-1.5 rounded-xl border transition-colors',
              petEnabled ? 'border-aegis-primary/30 text-aegis-primary hover:bg-aegis-primary/10' : 'border-aegis-border/20 text-aegis-text-dim opacity-40 cursor-not-allowed')}>
            {petVisible ? t('pet.settings.hide', '隐藏') : t('pet.settings.show', '显示')}
          </button>
        </div>

        {/* Skin picker — live thumbnails so the choice is visual, not just a word. */}
        <div className="mt-4">
          <div className="text-[13px] text-aegis-text mb-2">{t('pet.settings.skin', '皮肤')}</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {PET_SKIN_OPTIONS.map(({ id }) => (
              <button key={id} onClick={() => setPetSkin(id)}
                aria-pressed={petSkin === id}
                className={clsx('flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors',
                  petSkin === id ? 'border-aegis-primary/60 bg-aegis-primary/10' : 'border-aegis-border/20 hover:border-aegis-border/50')}>
                <SkinPreview skin={id} size={44} />
                <span className={clsx('text-[11px] leading-none', petSkin === id ? 'text-aegis-text' : 'text-aegis-text-dim')}>
                  {t(`pet.settings.${id}`)}
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

        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-[13px] text-aegis-text">{t('pet.settings.backdropContrast', '自动调整文字对比度')}</div>
            <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.backdropContrastHint', '根据萌宠附近桌面颜色调整提示文字，不保存桌面图像')}</div>
          </div>
          <SettingsSwitch checked={backdropContrastEnabled} onCheckedChange={setBackdropContrastEnabled} label={t('pet.settings.backdropContrast', '背景对比增强')} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] text-aegis-text">{t('pet.settings.captionScale')}</div>
              <div className="text-[11px] text-aegis-text-dim">{t('pet.settings.captionScaleHint')}</div>
            </div>
            <span className="w-10 text-right font-mono text-xs text-aegis-primary">{Math.round(petCaptionScale * 100)}%</span>
          </div>
          <input
            className="mt-2 w-full accent-[rgb(var(--aegis-primary))]"
            type="range"
            min="0.85"
            max="1.35"
            step="0.05"
            value={petCaptionScale}
            onChange={(event) => setPetCaptionScale(Number(event.target.value))}
            aria-label={t('pet.settings.captionScale')}
          />
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
              {preparingPetSkill ? <LoadingIndicator size={13} /> : <Sparkles size={13} />}
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
          <SettingsSwitch checked={petPomodoro.enabled} onCheckedChange={(v) => setPetPomodoro({ enabled: v })} label={t('pet.pomodoro.enable')} />
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <label className="text-[12px] text-aegis-text-dim">{t('pet.pomodoro.workMin', '工作')}</label>
          <input type="number" min={1} max={120} value={petPomodoro.workMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ workMin: Math.max(1, Math.min(120, Number(e.target.value) || 30)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">{t('common.minuteShort')}</span>
          <label className="text-[12px] text-aegis-text-dim ms-2">{t('pet.pomodoro.breakMin', '休息')}</label>
          <input type="number" min={1} max={60} value={petPomodoro.breakMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ breakMin: Math.max(1, Math.min(60, Number(e.target.value) || 5)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">{t('common.minuteShort')}</span>
          <label className="text-[12px] text-aegis-text-dim ms-2">{t('pet.pomodoro.longBreakMin', '长休')}</label>
          <input type="number" min={1} max={60} value={petPomodoro.longBreakMin} disabled={petPomodoro.running}
            onChange={(e) => setPetPomodoro({ longBreakMin: Math.max(1, Math.min(60, Number(e.target.value) || 15)) })}
            className="w-16 px-2 py-1 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.05)] border border-aegis-border/30 text-aegis-text text-center" />
          <span className="text-[11px] text-aegis-text-dim">{t('common.minuteShort')}</span>
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
              <StatusDot tone={connected ? 'success' : connecting ? 'warning' : 'failed'} size={7} />
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
              onChange={(e) => {
                setEditUrl(e.target.value);
                setEditToken('');
                setTokenDirty(false);
                setHasStoredGatewayToken(false);
                setConnectionDirty(true);
              }}
              placeholder={defaultGatewayWsUrl()}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                text-aegis-text placeholder:text-aegis-text-dim
                outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
              dir="ltr"
            />
            <div className="text-[10px] text-aegis-text-dim mt-1">
              {t('settings.gatewayUrlHint', {
                url: defaultGatewayWsUrl(),
                defaultValue: 'Leave empty to use default ({{url}})',
              })}
            </div>
          </div>

          {/* Gateway Token — editable */}
          <div>
            <label className="text-[12px] text-aegis-text-muted font-medium mb-1.5 block">
              {t('settingsExtra.gatewayTokenLabel', 'Gateway Token')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={editToken}
                onChange={(e) => {
                  setEditToken(e.target.value);
                  setTokenDirty(true);
                  setConnectionDirty(true);
                }}
                placeholder={hasStoredGatewayToken
                  ? t('settingsExtra.tokenStoredPlaceholder', 'Stored securely; enter a replacement')
                  : t('settingsExtra.tokenPlaceholder')}
                className="min-w-0 flex-1 px-3 py-2.5 rounded-xl text-[13px] font-mono
                  bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                  text-aegis-text placeholder:text-aegis-text-dim
                  outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
                dir="ltr"
              />
              {hasStoredGatewayToken && !tokenDirty && (
                <button
                  type="button"
                  onClick={() => {
                    setEditToken('');
                    setTokenDirty(true);
                    setHasStoredGatewayToken(false);
                    setConnectionDirty(true);
                  }}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted hover:border-aegis-danger/40 hover:text-aegis-danger"
                  title={t('settingsExtra.clearGatewayToken', 'Clear saved token')}
                  aria-label={t('settingsExtra.clearGatewayToken', 'Clear saved token')}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {connectionDirty && (
              <button
                type="button"
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
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors disabled:opacity-40"
            >
              {testingConnection ? <LoadingIndicator size={13} /> : <Wifi size={13} />}
              {t('settings.testConnection')}
            </button>
            {!connected && !connectionDirty && (
              <button
                type="button"
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
                {testResult === 'success'
                  ? <CheckCircle size={12} aria-hidden="true" />
                  : <WifiOff size={12} aria-hidden="true" />}
                {testResult === 'success'
                  ? t('settings.connectionTestSuccess')
                  : t('settings.connectionTestFailed')}
              </span>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard delay={0.17}>
        <StructuredPlanSettingsPanel
          mode={structuredPlans.mode}
          loading={structuredPlans.loading}
          saving={structuredPlans.saving}
          error={structuredPlans.error}
          disabled={!connected}
          onChange={(mode) => { void structuredPlans.update(mode); }}
          onRetry={() => { void structuredPlans.refresh(); }}
        />
      </GlassCard>
        </>
      )}

      {activeTab === 'storage' && (
        <>
      <GatewayLifecyclePanel variant="full" />

      <ManagedRuntimeSettingsPanel />

      <NpmCacheSettingsPanel />

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
                title={t('app.company')}
              />
            </div>
          </div>
          <div className="text-[15px] font-bold text-aegis-text">{t('app.name')}</div>
          <div className="text-[12px] text-aegis-text-dim mt-1">v{APP_VERSION}</div>
          <div className="text-[11px] text-aegis-text-dim mt-0.5">{t('app.clientSubtitle')}</div>
          <div className="text-[11px] text-aegis-text-muted mt-2">{t('app.company')}</div>
          <div className="text-[10px] text-aegis-text-dim mt-0.5">{t('app.copyright', { year: new Date().getFullYear() })}</div>
        </div>
        <div className="space-y-2 border-t border-aegis-border/15 pt-3">
          {[
            { label: 'OpenClaw', value: openclawVersion ? `v${openclawVersion}` : '—' },
            { label: t('settingsExtra.platform', 'Platform'), value: platformLabel },
            {
              label: t('settings.gateway', 'Gateway'),
              value: connected
                ? localStorage.getItem('aegis-gateway-http')?.replace('http', 'ws') || defaultGatewayWsUrl()
                : '—',
              connectionState: connected ? 'connected' : 'disconnected',
            },
          ].map(({ label, value, connectionState }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] text-aegis-text-dim">{label}</span>
              <span className="flex max-w-[250px] items-center gap-1 text-[10px] font-mono text-aegis-text-muted">
                {connectionState === 'connected' && <Wifi size={11} className="shrink-0 text-aegis-success" aria-hidden="true" />}
                {connectionState === 'disconnected' && <WifiOff size={11} className="shrink-0 text-aegis-danger" aria-hidden="true" />}
                <span className="truncate">{value}</span>
              </span>
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

          {window.aegis?.runtimeData && (
            <button
              onClick={() => { void openRuntimeData(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors"
            >
              <FileText size={12} /> {t('settings.openRuntimeData', '打开运行数据目录')}
            </button>
          )}
        </div>

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
      </GlassCard>
        </>
      )}

      </div>
      </GlassCardEnterMotionScope>
    </PageTransition>
  );
}
