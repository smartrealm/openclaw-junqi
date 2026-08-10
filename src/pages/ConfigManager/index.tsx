// ═══════════════════════════════════════════════════════════
// Config Manager — Complete (Phase 5)
// Full config state management + Diff Preview + Export/Import
// ═══════════════════════════════════════════════════════════

import { lazy, Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileJson, CheckCircle2, AlertCircle, RefreshCw, Bot, Users, MessageSquare, Wrench, SlidersHorizontal, KeyRound, type LucideIcon, Download, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from './types';
import { gateway, openClawRuntimeConfigClient } from '@/services/gateway';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import { FloatingSaveButton, ChangesPill } from './components';
import { ActiveTabIndicator, AnimatedTabPanel } from '@/components/shared/TabMotion';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { readConfigNavigationIntent, type ConfigTab } from './configNavigation';
import { isChannelConfigurationMetadataKey } from '@/services/channelConfigMerge';
import { buildOpenClawConfigPatch } from '@/services/gateway/OpenClawConfigPatch';
import { diffConfigPaths, planConfigReload } from '@/services/gateway/configReloadPlan';
import { parseActiveOpenclawConfig } from '@/services/openclawConfigRuntime';

type Tab = ConfigTab;

const ProvidersTab = lazy(() => import('./ProvidersTab').then((module) => ({ default: module.ProvidersTab })));
const AgentsTab = lazy(() => import('./AgentsTab').then((module) => ({ default: module.AgentsTab })));
const ChannelsTab = lazy(() => import('./ChannelsTab').then((module) => ({ default: module.ChannelsTab })));
const ToolsTab = lazy(() => import('./ToolsTab').then((module) => ({ default: module.ToolsTab })));
const AdvancedTab = lazy(() => import('./AdvancedTab').then((module) => ({ default: module.AdvancedTab })));
const SecretsTab = lazy(() => import('./SecretsTab').then((module) => ({ default: module.SecretsTab })));

export function ConfigManagerPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('providers');
  const [providerAddRequestId, setProviderAddRequestId] = useState(0);

  // `tab` is durable navigation state. `action` is consumed once so direct
  // links can open a workflow without coupling the sidebar to modal state.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const intent = readConfigNavigationIntent(searchParams);
    if (intent.tab) {
      setActiveTab(intent.tab);
    }
    if (intent.addProvider) {
      setProviderAddRequestId((current) => current + 1);
      setSearchParams(intent.consumedParams!, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ── Config detection ──
  const [detecting, setDetecting]     = useState(true);
  const [configPath, setConfigPath]   = useState<string>('');
  const [configExists, setConfigExists] = useState(false);
  const [error, setError]             = useState<string>('');

  // ── Config state (live + original for diff) ──
  const [config, setConfig]                 = useState<GatewayRuntimeConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [saving, setSaving]                 = useState(false);

  // ── Modal / toast state ──
  const [saveSuccess, setSaveSuccess]     = useState(false);
  const [reloading, setReloading]         = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);

  // ── hasChanges — true when config differs from disk ──
  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(originalConfig),
    [config, originalConfig]
  );

  // ── Load config on mount ──
  useEffect(() => {
    const init = async () => {
      try {
        setDetecting(true);
        setError('');

        const snapshot = await openClawRuntimeConfigClient.read();
        setConfigPath(snapshot.path ?? '');
        setConfigExists(snapshot.exists);
        setConfig(snapshot.config);
        setOriginalConfig(structuredClone(snapshot.config));
      } catch (err: any) {
        setError(err.message || 'Unknown error');
      } finally {
        setDetecting(false);
      }
    };

    init();
  }, []);

  // ── Ctrl+S shortcut — saves directly ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && config && !saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasChanges, config, saving, handleSave]);

  // ── onChange handler — takes an updater function ──
  const handleChange = useCallback(
    (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => {
      setConfig((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  // ── Save ──
  async function persistConfig(
    targetConfig?: GatewayRuntimeConfig | null,
  ): Promise<boolean> {
    const configToSave = targetConfig ?? config;
    if (!configToSave) return false;
    setSaving(true);

    try {
      // 1. 从 Gateway 重新读取带 hash 的当前快照，建立官方配置补丁的 CAS 写入前提。
      const snapshot = await openClawRuntimeConfigClient.read();

      // 2. 仅构造用户从原始快照到当前草稿的差异，避免整段替换未知运行时配置。
      const patchPlan = buildOpenClawConfigPatch(originalConfig ?? {}, configToSave);

      // 3. 仅通过 Gateway 最小补丁写入，服务端负责 schema、脱敏字段恢复与 baseHash 冲突校验。
      await openClawRuntimeConfigClient.patch(patchPlan.patch, snapshot, patchPlan.replacePaths);
      setConfigExists(true);

      // 4. CAS 成功后当前草稿即为本次提交的配置投影。
      const savedConfig = structuredClone(configToSave);
      // 重载计划必须使用提交前基线，不能依赖后续状态更新后的旧闭包值。
      const reloadBaseline = originalConfig;
      setConfig(savedConfig);
      setOriginalConfig(structuredClone(savedConfig));

      // Gateway 重载期间保留最后一次确认的目录，避免输入控件卸载造成闪动。
      const chatStore = (await import('@/stores/chatStore')).useChatStore;
      chatStore.setState({ modelsLoading: true });

      // 仅在 OpenClaw 声明需要时重启；路径级重载信息未知时保守选择重启。
      const changedPaths = diffConfigPaths(reloadBaseline ?? {}, savedConfig);
      const reloadPlan = await planConfigReload(
        changedPaths,
        (path) => gateway.callPrivileged('config.schema.lookup', { path }),
      );
      if (reloadPlan.fallbackReason) {
        debugWarn('app', '[Config] Reload semantics unavailable, restarting:', reloadPlan.fallbackReason);
      }
      debugLog('app', '[Config] Reload plan:', reloadPlan.kind, reloadPlan.decidingPaths);

      if (reloadPlan.kind !== 'restart') {
        // `hot` 由 Gateway 自行应用，`none` 不需要额外操作。
        setError('');
        setSaveSuccess(true);
        window.dispatchEvent(new Event('aegis:config-saved'));
        chatStore.setState({ modelsLoading: false });
        return true;
      }

      try {
        const restartResult = await gatewayLifecycle.restart('config-manager');
        if (restartResult.success) {
          if (restartResult.requiresAppRestart) {
            setError('Config saved. Restart the desktop app to apply shell-level changes.');
          } else {
            setError('');
          }
          setSaveSuccess(true);
          window.dispatchEvent(new Event('aegis:config-saved'));
          debugLog('app', '[Config] Apply method:', restartResult.method, restartResult.changedPaths);
        } else {
          // 保存已确认但重启失败，必须如实显示后续操作提示。
          setSaveSuccess(true);
          window.dispatchEvent(new Event('aegis:config-saved'));
          debugWarn('app', '[Config] Restart failed:', restartResult.error);
          setError(`Config saved, but gateway restart failed: ${restartResult.error || 'Unknown error'}`);
        }
      } catch {
        // 重启 IPC 不可用不改变已确认的保存结果。
        setSaveSuccess(true);
        window.dispatchEvent(new Event('aegis:config-saved'));
        debugWarn('app', '[Config] Restart IPC unavailable');
      }

      setTimeout(() => setSaveSuccess(false), 3000);
      return true;
    } catch (err: any) {
      setError(err.message || t('config.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    return persistConfig();
  }

  async function handleApplyAndSave(
    updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig,
  ): Promise<boolean> {
    if (!config) return false;
    return persistConfig(updater(config));
  }

  // ── Export ──
  const handleExport = () => {
    if (!config) return;
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openclaw-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ──
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.json5';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = await parseActiveOpenclawConfig(text);
        setConfig(data);
        // Don't update originalConfig — so hasChanges becomes true
      } catch {
        setError(t('config.importError'));
      }
    };
    input.click();
  };

  // ── Reload (re-detect path + re-read) ──
  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    setError('');
    setReloadSuccess(false);
    try {
      const snapshot = await openClawRuntimeConfigClient.read();
      setConfigPath(snapshot.path ?? '');
      setConfigExists(snapshot.exists);
      setConfig(snapshot.config);
      setOriginalConfig(structuredClone(snapshot.config));
      setReloadSuccess(true);
      setTimeout(() => setReloadSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Reload failed');
    } finally {
      setReloading(false);
    }
  };

  // ── Discard ──
  const handleDiscard = () => {
    if (originalConfig) {
      setConfig(structuredClone(originalConfig));
    }
  };

  // ── Derived counts ──
  const providerCount = (() => {
    const authIds = new Set(
      Object.values(config?.auth?.profiles ?? {}).map((p: any) =>
        p?.provider ?? 'unknown'
      )
    );
    const modelIds = new Set(Object.keys(config?.models?.providers ?? {}));
    const allIds = new Set([...authIds, ...modelIds]);
    allIds.delete('unknown');
    return allIds.size;
  })();
  const rawAgents = config?.agents?.list ?? [];
  const hasMainAgent = rawAgents.some((a) => a.id === 'main');
  // UI always shows a "Main" agent row, even when it isn't explicitly in agents.list.
  // Count should match what the user sees in the Agents tab.
  const agentCount = hasMainAgent ? rawAgents.length : rawAgents.length + 1;
  const channelCount = config?.channels
    ? Object.keys(config.channels).filter((channelId) => !isChannelConfigurationMetadataKey(channelId)).length
    : 0;

  // ── Smart tab badges ──
  const toolCount = [
    config?.tools?.profile,
    config?.tools?.deny?.length,
    config?.tools?.allow?.length,
    config?.tools?.web?.search?.enabled,
    config?.tools?.web?.fetch?.enabled,
  ].filter(Boolean).length;

  const tabs: { id: Tab; labelKey: string; icon: LucideIcon; badge?: number | string }[] = [
    { id: 'providers', labelKey: 'config.providers', icon: Bot,         badge: providerCount           },
    { id: 'agents',    labelKey: 'config.agents',    icon: Users,       badge: agentCount              },
    { id: 'channels',  labelKey: 'config.channels',  icon: MessageSquare, badge: channelCount           },
    { id: 'tools',     labelKey: 'config.toolsConfig', icon: Wrench,     badge: toolCount || undefined  },
    { id: 'advanced',  labelKey: 'config.advanced',  icon: SlidersHorizontal, badge: undefined          },
    { id: 'secrets',   labelKey: 'config.secrets',   icon: KeyRound,    badge: undefined               },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border bg-aegis-card/80 backdrop-blur-md flex-shrink-0 gap-4 flex-nowrap">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-bold text-aegis-text whitespace-nowrap">{t('config.title')}</h1>
          {hasChanges && <ChangesPill label={t('config.unsavedChanges')} />}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-nowrap">
          <button
            onClick={handleReload}
            disabled={reloading}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap',
              'transition-all duration-200',
              reloadSuccess
                ? 'border-aegis-success/40 text-aegis-success bg-aegis-success/8'
                : 'border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover',
              reloading && 'opacity-60 cursor-not-allowed',
            )}
          >
            <RefreshCw size={12} className={clsx('shrink-0', reloading && 'animate-spin')} />
            <span className="whitespace-nowrap">
              {reloading
                ? t('config.reloading')
                : reloadSuccess
                  ? t('config.reloadDone')
                  : t('config.reload')}
            </span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover transition-all duration-200"
          >
            <Download size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="whitespace-nowrap">{t('config.exportConfig')}</span>
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap border-aegis-border text-aegis-text-secondary hover:bg-white/[0.03] hover:border-aegis-border-hover transition-all duration-200"
          >
            <Upload size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="whitespace-nowrap">{t('config.importConfig')}</span>
          </button>

        </div>
      </div>

      {/* ── Tabs bar ── */}
      <div className="border-b border-aegis-border flex gap-0 overflow-x-auto flex-shrink-0 bg-aegis-card/60 backdrop-blur-sm" role="tablist" aria-label={t('config.title')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'relative isolate flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
              'transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]',
              activeTab === tab.id
                ? 'text-aegis-primary'
                : 'text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-white/[0.02]'
            )}
          >
            {activeTab === tab.id && (
              <ActiveTabIndicator
                layoutId="config-manager-active-tab"
                className="inset-0 -z-10 border-b-2 border-aegis-primary bg-white/[0.025]"
              />
            )}
            <tab.icon size={15} strokeWidth={1.75} />
            <span>{t(tab.labelKey)}</span>
            {tab.badge != null && (typeof tab.badge === 'string' || tab.badge > 0) && (
              <span
                className={clsx(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                  activeTab === tab.id
                    ? 'bg-aegis-primary/10 text-aegis-primary border-aegis-primary/20'
                    : 'bg-aegis-elevated text-aegis-text-muted border-aegis-border'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto p-6 pb-24">

        {/* Config path card */}
        <div className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3 mb-5">
          <FileJson className="text-aegis-primary mt-0.5 shrink-0" size={16} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-aegis-text-muted mb-1 font-medium">{t('config.configPath')}</div>
            {detecting ? (
              <div className="text-sm text-aegis-text-muted animate-pulse">{t('config.detecting')}</div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-aegis-text font-mono truncate flex-1 min-w-0">
                  {configPath || '—'}
                </span>
                {configExists ? (
                  <CheckCircle2 size={13} className="text-aegis-primary shrink-0" />
                ) : (
                  <AlertCircle size={13} className="text-aegis-text-muted shrink-0" />
                )}
              </div>
            )}
            {!detecting && !configExists && (
              <div className="text-xs text-aegis-text-muted mt-1">{t('config.noFile')}</div>
            )}
          </div>
        </div>

        {/* Quick stats (only when config loaded) */}
        {!detecting && config && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { val: providerCount, label: t('config.providers'), color: 'text-aegis-primary' },
              { val: agentCount,    label: t('config.agents'),    color: 'text-blue-400' },
              { val: channelCount,  label: t('config.channels'),  color: 'text-purple-400' },
            ].map(({ val, label, color }) => (
              <div
                key={label}
                className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 text-center"
              >
                <div className={clsx('text-2xl font-extrabold', color)}>{val}</div>
                <div className="text-xs text-aegis-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab content */}
        {detecting ? (
          <div className="flex items-center justify-center py-20 text-aegis-text-muted text-sm animate-pulse">
            {t('config.detecting')}
          </div>
        ) : !config ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <AlertCircle size={32} className="text-aegis-text-muted" />
            <p className="text-sm text-aegis-text-secondary">{t('config.noFile')}</p>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20 text-aegis-text-muted text-sm animate-pulse">
                {t('common.loading', 'Loading...')}
              </div>
            }
          >
            <AnimatedTabPanel transitionKey={activeTab}>
              {activeTab === 'providers' ? (
                <ProvidersTab
                  config={config}
                  onChange={handleChange}
                  onApplyAndSave={handleApplyAndSave}
                  saving={saving}
                  addRequestId={providerAddRequestId}
                />
              ) : activeTab === 'agents' ? (
                <AgentsTab config={config} onChange={handleChange} />
              ) : activeTab === 'channels' ? (
                <ChannelsTab config={config} onChange={handleChange} />
              ) : activeTab === 'tools' ? (
                <ToolsTab config={config} onChange={handleChange} />
              ) : activeTab === 'advanced' ? (
                <AdvancedTab config={config} onChange={handleChange} />
              ) : activeTab === 'secrets' ? (
                <SecretsTab config={config} />
              ) : null}
            </AnimatedTabPanel>
          </Suspense>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3">
            <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}
      </div>

      {/* ── Floating Save ── */}
      <FloatingSaveButton
        hasChanges={hasChanges}
        saving={saving}
        onSave={() => void handleSave()}
        onDiscard={handleDiscard}
      />

      {/* ── Save Success Toast — portal to body so it is not squeezed/covered by page stacking contexts ── */}
      {saveSuccess && createPortal(
        <div
          className="fixed top-4 right-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary text-sm font-medium animate-[float-in_0.3s_ease-out] shadow-lg backdrop-blur-xl"
          style={{ zIndex: 2147483000, minWidth: 220, maxWidth: 'min(360px, calc(100vw - 32px))' }}
        >
          <CheckCircle2 size={15} className="shrink-0" />
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">{t('config.configSaved')}</span>
        </div>,
        document.body
      )}

    </div>
  );
}

export default ConfigManagerPage;
