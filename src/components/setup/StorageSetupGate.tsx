import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronDown, CircleAlert, Cpu, Database, FolderOpen, GitBranch, HardDrive, LoaderCircle, Package, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { SetupShell, StatusPanel } from '@/components/setup/SetupFlowPanels';
import {
  initialStorageLocationsVisibility,
  storageSubmissionPresentation,
  type StorageCompletion,
} from '@/components/setup/storageSetupModel';
import { rollbackRuntimeReconfiguration } from '@/api/tauri-commands';
import { useAppStore, type SetupLog, type StorageSetupDraft } from '@/stores/app-store';
import type { SetupFlow } from '@/hooks/useSetupFlow';
import { hasTauriEventBridge, subscribeTauriEvent } from '@/utils/tauriEvents';

interface StorageSetupStatus {
  configured: boolean;
  configurationError?: string | null;
  runtimeReconfigurationRecoveryError?: string | null;
  stateDir: string;
  configPath: string;
  workspaceDir: string;
  runtimeDir: string;
  npmCacheDir: string | null;
  npmPrefix: string | null;
  nodeRuntimeDir: string | null;
  gitRuntimeDir: string | null;
  customNodeRuntimeSupported: boolean;
  customGitRuntimeSupported: boolean;
  openclawRelocationRequired: boolean;
  terminalIntegration: boolean;
  terminalLauncherDir: string;
  legacyDir: string;
  legacyExists: boolean;
  legacySizeBytes: number;
}

interface StorageConfigureResult {
  createdFresh: boolean;
  runtimeReconfigurationRequired: boolean;
  openclawRelocationRequired: boolean;
}

interface MigrationProgress {
  key?: string;
  message: string;
  progress: number;
}

interface StorageSetupStepProps {
  activeStage: SetupFlow['presentation']['stage'];
  onReady: (result?: StorageCompletion) => void;
  onBack: () => void | Promise<void>;
  logs: SetupLog[];
  forceConfigure?: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function childStoragePath(parent: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${separator}OpenClaw`;
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`;
}

function remapChildPath(path: string, source: string, target: string): string {
  const sourceNormalized = source.replace(/[\\/]+$/, '');
  const pathNormalized = path.replace(/[\\/]+$/, '');
  const insensitive = source.includes('\\');
  const candidate = insensitive ? pathNormalized.toLowerCase() : pathNormalized;
  const root = insensitive ? sourceNormalized.toLowerCase() : sourceNormalized;
  if (candidate === root) return target;
  const separator = path.includes('\\') ? '\\' : '/';
  if (!candidate.startsWith(`${root}${separator}`)) return path;
  return `${target.replace(/[\\/]+$/, '')}${pathNormalized.slice(sourceNormalized.length)}`;
}

function migrationSource(status: StorageSetupStatus, forceConfigure: boolean): string {
  // 存储已配置后，后续迁移必须从当前选定的数据目录开始。
  // 回退到旧目录会造成新目标与现有配置、会话和凭据脱节。
  return forceConfigure || status.configured ? status.stateDir : status.legacyDir;
}

function hasMigratableSource(status: StorageSetupStatus, forceConfigure: boolean): boolean {
  return forceConfigure || status.configured || status.legacyExists;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return cause == null ? fallback : String(cause);
}

interface LocationRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  onChoose?: () => void;
  disabled?: boolean;
}

function LocationRow({ icon, label, value, onChoose, disabled }: LocationRowProps) {
  return (
    <div className="grid min-h-[62px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-aegis-border/70 py-2.5 last:border-b-0">
      <span className="text-aegis-text-dim">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-aegis-text">{label}</span>
        <span className="mt-1 block truncate font-mono text-[10px] text-aegis-text-dim" title={value}>{value}</span>
      </span>
      {onChoose && (
        <button
          type="button"
          onClick={onChoose}
          disabled={disabled}
          title={label}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderOpen size={14} />
        </button>
      )}
    </div>
  );
}

function StorageFormSkeleton() {
  return (
    <section
      data-testid="storage-form-skeleton"
      className="border-y border-aegis-border py-6"
      aria-busy="true"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div key={index} className="min-h-[116px] rounded-lg border border-aegis-border p-4">
            <div className="h-4 w-32 rounded bg-aegis-surface" />
            <div className="mt-4 h-3 w-3/4 rounded bg-aegis-surface" />
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-aegis-border pt-4">
        <div className="h-4 w-24 rounded bg-aegis-surface" />
        <div className="mt-3 space-y-3 border-y border-aegis-border py-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-8 rounded bg-aegis-surface/70" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function StorageSetupStep({ activeStage, onReady, onBack, logs, forceConfigure = false }: StorageSetupStepProps) {
  const { t } = useTranslation();
  const storageDraft = useAppStore((state) => state.storageDraft);
  const setStorageDraft = useAppStore((state) => state.setStorageDraft);
  const appendSetupLog = useAppStore((state) => state.appendSetupLog);
  const checkedRef = useRef(false);
  const mountedRef = useRef(false);
  const applyInFlightRef = useRef(false);
  const backInFlightRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [status, setStatus] = useState<StorageSetupStatus | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [runtimeDir, setRuntimeDir] = useState('');
  const [npmCacheDir, setNpmCacheDir] = useState('');
  const [customNpmCache, setCustomNpmCache] = useState(false);
  const [npmPrefix, setNpmPrefix] = useState('');
  const [customNpmPrefix, setCustomNpmPrefix] = useState(false);
  const [nodeRuntimeDir, setNodeRuntimeDir] = useState('');
  const [customNodeRuntime, setCustomNodeRuntime] = useState(false);
  const [gitRuntimeDir, setGitRuntimeDir] = useState('');
  const [customGitRuntime, setCustomGitRuntime] = useState(false);
  const [terminalIntegration, setTerminalIntegration] = useState(false);
  const [showLocations, setShowLocations] = useState(() => initialStorageLocationsVisibility());
  const [migrateExisting, setMigrateExisting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [recoveringRuntime, setRecoveringRuntime] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStorageStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!hasTauriEventBridge()) {
        throw new Error(t('storage.desktopIntegrationUnavailable'));
      }
      const result = await invoke<StorageSetupStatus>('get_storage_setup_status');
      if (!mountedRef.current) return;
      const draft = storageDraft;
      setStatus(result);
      setError(result.runtimeReconfigurationRecoveryError ?? result.configurationError ?? null);
      setTargetDir(draft?.targetDir ?? result.stateDir);
      setWorkspaceDir(draft?.workspaceDir ?? result.workspaceDir);
      setRuntimeDir(draft?.runtimeDir ?? result.runtimeDir);
      setNpmCacheDir(draft?.npmCacheDir ?? result.npmCacheDir ?? '');
      setCustomNpmCache(draft?.customNpmCache ?? Boolean(result.npmCacheDir));
      setNpmPrefix(draft?.npmPrefix ?? result.npmPrefix ?? '');
      setCustomNpmPrefix(draft?.customNpmPrefix ?? Boolean(result.npmPrefix));
      setNodeRuntimeDir(draft?.nodeRuntimeDir ?? result.nodeRuntimeDir ?? '');
      setCustomNodeRuntime(result.customNodeRuntimeSupported && (draft?.customNodeRuntime ?? Boolean(result.nodeRuntimeDir)));
      setGitRuntimeDir(draft?.gitRuntimeDir ?? result.gitRuntimeDir ?? '');
      setCustomGitRuntime(result.customGitRuntimeSupported && (draft?.customGitRuntime ?? Boolean(result.gitRuntimeDir)));
      setTerminalIntegration(draft?.terminalIntegration ?? result.terminalIntegration);
      setMigrateExisting(draft?.migrateExisting ?? (forceConfigure || (!result.configured && result.legacyExists)));
      setShowLocations(initialStorageLocationsVisibility(draft?.showLocations));
    } catch (cause) {
      const message = errorMessage(cause, t('storage.unknownError', 'Unexpected storage error'));
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: 'error',
        message: t('storage.logLoadFailed', {
          message,
          defaultValue: 'Could not read storage configuration: {{message}}',
        }),
      });
      if (mountedRef.current) setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [appendSetupLog, forceConfigure, storageDraft, t]);

  useEffect(() => {
    mountedRef.current = true;
    if (!checkedRef.current) {
      checkedRef.current = true;
      void loadStorageStatus();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [loadStorageStatus]);

  useEffect(() => {
    let cancelled = false;
    const unlisten = subscribeTauriEvent<MigrationProgress>('storage-migration-progress', (event) => {
      if (cancelled) return;
      const payload = event.payload;
      const message = payload.key ? t(payload.key, payload.message) : payload.message;
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: payload.progress >= 1 ? 'success' : 'info',
        message,
        progress: payload.progress,
      });
    });
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [appendSetupLog, t]);

  const sourceDir = useMemo(
    () => status ? migrationSource(status, forceConfigure) : '',
    [forceConfigure, status],
  );
  const usingSourceLocation = useMemo(
    () => Boolean(status && targetDir === sourceDir),
    [sourceDir, status, targetDir],
  );

  const chooseDirectory = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('storage.chooseParent', '选择 OpenClaw 数据所在文件夹'),
    });
    if (!mountedRef.current) return;
    if (typeof selected !== 'string') return;
    const target = childStoragePath(selected);
    const shouldMigrate = Boolean(status && hasMigratableSource(status, forceConfigure));
    const source = status ? migrationSource(status, forceConfigure) : '';
    setTargetDir(target);
    setMigrateExisting(shouldMigrate);
    if (status && shouldMigrate) {
      setWorkspaceDir(remapChildPath(status.workspaceDir, source, target));
      setRuntimeDir(remapChildPath(status.runtimeDir, source, target));
      if (customNpmCache && status.npmCacheDir) {
        setNpmCacheDir(remapChildPath(status.npmCacheDir, source, target));
      }
    } else {
      setWorkspaceDir(joinPath(target, 'workspace'));
      setRuntimeDir(joinPath(target, 'runtime'));
    }
    if (!customNpmCache) {
      setNpmCacheDir('');
    }
    setError(null);
  }, [customNpmCache, forceConfigure, status, t]);

  const chooseExactDirectory = useCallback(async (title: string, apply: (path: string) => void) => {
    const selected = await open({ directory: true, multiple: false, title });
    if (!mountedRef.current || typeof selected !== 'string') return;
    apply(selected);
    setError(null);
  }, []);

  const applyStorage = useCallback(async () => {
    // React 不会同步提交 applying；首次 await 前先锁定原生存储事务，避免重复迁移。
    if (!status || !targetDir || applyInFlightRef.current || backInFlightRef.current) return;
    applyInFlightRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const shouldMigrateSelectedState = !usingSourceLocation
        && migrateExisting
        && hasMigratableSource(status, forceConfigure);
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: 'info',
        message: t('storage.logSaving', '正在保存 OpenClaw 数据位置…'),
        progress: 0.02,
      });
      // 存储层拥有原生单飞事务，按需停止并恢复选定 Gateway；协作插件不能成为首次配置前提。
      const result = await invoke<StorageConfigureResult>('configure_storage', {
        targetDir,
        migrateExisting: shouldMigrateSelectedState,
        locations: {
          workspaceDir,
          runtimeDir,
          npmCacheDir: customNpmCache ? npmCacheDir.trim() || null : null,
          npmPrefix: customNpmPrefix ? npmPrefix.trim() || null : null,
          nodeRuntimeDir: status.customNodeRuntimeSupported && customNodeRuntime ? nodeRuntimeDir.trim() || null : null,
          gitRuntimeDir: status.customGitRuntimeSupported && customGitRuntime ? gitRuntimeDir.trim() || null : null,
          terminalIntegration,
        },
      });
      if (!mountedRef.current) return;
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: 'success',
        message: t('storage.logSaved', 'OpenClaw 数据位置已保存'),
        progress: 1,
      });
      setStorageDraft(null);
      onReadyRef.current({
        createdFresh: result.createdFresh,
        runtimeReconfigurationRequired: result.runtimeReconfigurationRequired,
        openclawRelocationRequired: result.openclawRelocationRequired,
      });
    } catch (cause) {
      const message = errorMessage(cause, t('storage.unknownError', 'Unexpected storage error'));
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: 'error',
        message: t('storage.logFailed', {
          message,
          defaultValue: 'Storage location was not saved: {{message}}',
        }),
      });
      if (mountedRef.current) setError(message);
    } finally {
      applyInFlightRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  }, [appendSetupLog, customGitRuntime, customNodeRuntime, customNpmCache, customNpmPrefix, forceConfigure, gitRuntimeDir, migrateExisting, nodeRuntimeDir, npmCacheDir, npmPrefix, runtimeDir, setStorageDraft, status, t, targetDir, terminalIntegration, usingSourceLocation, workspaceDir]);

  const rememberDraft = useCallback(() => {
    const draft: StorageSetupDraft = {
      targetDir,
      workspaceDir,
      runtimeDir,
      npmCacheDir,
      customNpmCache,
      npmPrefix,
      customNpmPrefix,
      nodeRuntimeDir,
      customNodeRuntime,
      gitRuntimeDir,
      customGitRuntime,
      terminalIntegration,
      migrateExisting,
      showLocations,
    };
    setStorageDraft(draft);
  }, [customGitRuntime, customNodeRuntime, customNpmCache, customNpmPrefix, gitRuntimeDir, migrateExisting, nodeRuntimeDir, npmCacheDir, npmPrefix, runtimeDir, setStorageDraft, showLocations, targetDir, terminalIntegration, workspaceDir]);

  const handleBack = useCallback(async () => {
    if (backInFlightRef.current || applyInFlightRef.current || recoveringRuntime) return;
    backInFlightRef.current = true;
    try {
      if (status) rememberDraft();
      await onBack();
    } finally {
      backInFlightRef.current = false;
    }
  }, [onBack, recoveringRuntime, rememberDraft, status]);

  const recoverRuntimeReconfiguration = useCallback(async () => {
    if (recoveringRuntime) return;
    setRecoveringRuntime(true);
    setError(null);
    try {
      await rollbackRuntimeReconfiguration();
      await loadStorageStatus();
    } catch (cause) {
      const message = errorMessage(cause, t('storage.unknownError', 'Unexpected storage error'));
      appendSetupLog({
        source: 'setup',
        step: 'storage',
        level: 'error',
        message: t('storage.logRecoveryFailed', {
          message,
          defaultValue: 'Could not recover the previous runtime change: {{message}}',
        }),
      });
      if (mountedRef.current) setError(message);
    } finally {
      if (mountedRef.current) setRecoveringRuntime(false);
    }
  }, [appendSetupLog, loadStorageStatus, recoveringRuntime, t]);

  if (loading) {
    return (
      <SetupShell
        active={activeStage}
        contentIdentity="storage:form"
        title={t('storage.title', '选择 OpenClaw 数据位置')}
        subtitle={t('storage.subtitle', '配置、会话、认证和工作区将使用此位置；Node.js、Git 和 npm 缓存默认沿用系统设置。')}
        logs={logs}
        previousAction={{ onClick: handleBack }}
        nextAction={{ label: t('setup.nextStep', '下一步'), disabled: true, icon: 'next' }}
      >
        <StorageFormSkeleton />
      </SetupShell>
    );
  }

  if (!status) {
    return (
      <SetupShell
        active={activeStage}
        contentIdentity="storage:load-error"
        title={t('storage.title', '选择 OpenClaw 数据位置')}
        subtitle={t('storage.subtitle', '配置、会话、认证和工作区将使用此位置；Node.js、Git 和 npm 缓存默认沿用系统设置。')}
        logs={logs}
        previousAction={{ onClick: handleBack }}
        nextAction={{ label: t('common.retry', '重试'), onClick: () => void loadStorageStatus(), icon: 'none' }}
      >
        <div className="flex min-h-[260px] items-center">
          <StatusPanel
            icon={<CircleAlert size={22} />}
            tone="danger"
            title={t('storage.loadFailed', '无法读取存储配置')}
            message={error || t('storage.unknownError', '发生未知的存储错误')}
          />
        </div>
      </SetupShell>
    );
  }

  if (status.runtimeReconfigurationRecoveryError) {
    return (
      <SetupShell
        active={activeStage}
        contentIdentity="storage:runtime-recovery"
        title={t('storage.title', '选择 OpenClaw 数据位置')}
        subtitle={t('storage.runtimeRecoverySubtitle', 'OpenClaw 的先前运行时和 Gateway 服务需要先恢复，完成后才能继续更改数据位置。')}
        logs={logs}
        previousAction={{ onClick: handleBack, disabled: recoveringRuntime }}
        nextAction={{
          label: recoveringRuntime
            ? t('storage.runtimeRecoveryRunning', '正在恢复…')
            : t('storage.runtimeRecoveryRetry', '重试恢复'),
          onClick: () => void recoverRuntimeReconfiguration(),
          disabled: recoveringRuntime,
          loading: recoveringRuntime,
          icon: 'none',
        }}
      >
        <div className="flex min-h-[260px] items-center" aria-busy={recoveringRuntime} aria-live="polite">
          <StatusPanel
            icon={recoveringRuntime
              ? <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" />
              : <CircleAlert size={22} />}
            tone={recoveringRuntime ? "warning" : "danger"}
            title={t('storage.runtimeRecoveryTitle', '正在恢复上一次运行时更改')}
            message={error ?? status.runtimeReconfigurationRecoveryError}
          />
        </div>
      </SetupShell>
    );
  }

  // 数据位置读取只填充表单；只有用户点击下一步且原生存储事务成功后才推进阶段。
  const submission = storageSubmissionPresentation(applying, usingSourceLocation);
  const actionLabel = submission.action === 'confirm-current'
    ? t('storage.activating', '正在确认存储位置…')
    : submission.action === 'prepare-new'
      ? t('storage.preparing', '正在准备新存储位置…')
      : t('setup.nextStep', '下一步');
  const dataLayoutLocked = !usingSourceLocation
    && hasMigratableSource(status, forceConfigure)
    && migrateExisting;
  const layoutComplete = Boolean(
    targetDir.trim()
      && workspaceDir.trim()
      && runtimeDir.trim()
      && (!customNpmCache || npmCacheDir.trim())
      && (!customNpmPrefix || npmPrefix.trim())
      && (!customNodeRuntime || nodeRuntimeDir.trim())
      && (!customGitRuntime || gitRuntimeDir.trim()),
  );

  return (
    <SetupShell
      active={activeStage}
      contentIdentity={submission.contentIdentity}
      title={t('storage.title', '选择 OpenClaw 数据位置')}
      subtitle={t('storage.subtitle', '配置、会话、认证和工作区将使用此位置；Node.js、Git 和 npm 缓存默认沿用系统设置。')}
      logs={logs}
      previousAction={{ onClick: handleBack, disabled: submission.locked }}
      nextAction={{
        label: actionLabel,
        onClick: () => void applyStorage(),
        disabled: submission.locked || !layoutComplete,
        loading: submission.loading,
        icon: 'none',
      }}
    >
      <fieldset
        disabled={submission.locked}
        aria-busy={submission.loading}
        className="m-0 min-w-0 border-x-0 border-y border-aegis-border px-0 py-6"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setTargetDir(sourceDir);
              setWorkspaceDir(status.workspaceDir);
              setRuntimeDir(status.runtimeDir);
              setNpmCacheDir(status.npmCacheDir ?? '');
              setMigrateExisting(false);
              setError(null);
            }}
            className={clsx(
              'min-h-[116px] rounded-lg border p-4 text-left transition-colors',
              usingSourceLocation
                ? 'border-aegis-primary bg-aegis-primary/8'
                : 'border-aegis-border hover:border-aegis-primary/50',
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><HardDrive size={16} />{t('storage.defaultLocation', '使用当前位置')}</span>
              {usingSourceLocation && <Check size={16} className="text-aegis-primary" />}
            </span>
            <span className="mt-3 block break-all font-mono text-[11px] leading-5 text-aegis-text-dim">{sourceDir}</span>
            {sourceDir === status.legacyDir && status.legacyExists && (
              <span className="mt-1 block text-xs text-aegis-text-muted">{formatBytes(status.legacySizeBytes)}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => void chooseDirectory()}
            className={clsx(
              'min-h-[116px] rounded-lg border p-4 text-left transition-colors',
              !usingSourceLocation
                ? 'border-aegis-primary bg-aegis-primary/8'
                : 'border-aegis-border hover:border-aegis-primary/50',
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><FolderOpen size={16} />{t('storage.customLocation', '选择其他位置')}</span>
              {!usingSourceLocation && <Check size={16} className="text-aegis-primary" />}
            </span>
            <span className="mt-3 block break-all font-mono text-[11px] leading-5 text-aegis-text-dim">
              {!usingSourceLocation ? targetDir : t('storage.customLocationHint', '其他磁盘或文件夹')}
            </span>
          </button>
        </div>

        {!usingSourceLocation && hasMigratableSource(status, forceConfigure) && (
          <div className="mt-5 border-l-2 border-aegis-primary/40 pl-4">
            <div className="text-sm font-semibold">{t('storage.existingData', '检测到现有 OpenClaw 数据')}</div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                checked={migrateExisting}
                onChange={() => {
                  setMigrateExisting(true);
                  const source = migrationSource(status, forceConfigure);
                  setWorkspaceDir(remapChildPath(status.workspaceDir, source, targetDir));
                  setRuntimeDir(remapChildPath(status.runtimeDir, source, targetDir));
                  if (customNpmCache && status.npmCacheDir) {
                    setNpmCacheDir(remapChildPath(status.npmCacheDir, source, targetDir));
                  } else {
                    setNpmCacheDir('');
                  }
                }}
                className="mt-1 accent-[rgb(var(--aegis-primary))]"
              />
              <span><strong>{t('storage.migrate', '迁移现有数据')}</strong><span className="mt-0.5 block text-xs text-aegis-text-muted">{t('storage.migrateHint', '保留配置、认证、会话和工作区，源目录不会自动删除。')}</span></span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                checked={!migrateExisting}
                onChange={() => {
                  setMigrateExisting(false);
                  setWorkspaceDir(joinPath(targetDir, 'workspace'));
                  setRuntimeDir(joinPath(targetDir, 'runtime'));
                  if (!customNpmCache) setNpmCacheDir('');
                }}
                className="mt-1 accent-[rgb(var(--aegis-primary))]"
              />
              <span><strong>{t('storage.startFresh', '创建全新环境')}</strong><span className="mt-0.5 block text-xs text-aegis-text-muted">{t('storage.startFreshHint', '旧目录保持不变，新位置从空配置开始。')}</span></span>
            </label>
          </div>
        )}

        <div className="mt-5 border-t border-aegis-border pt-4">
          <button
            type="button"
            onClick={() => setShowLocations((visible) => !visible)}
            className="flex w-full items-center justify-between gap-4 py-1 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-aegis-text">{t('storage.installLocations', '安装位置')}</span>
              <span className="mt-1 block text-xs text-aegis-text-muted">{t('storage.installLocationsHint', '工作区，以及可选的 npm、Node.js 和 Git 位置')}</span>
            </span>
            <ChevronDown size={16} className={clsx('shrink-0 text-aegis-text-dim transition-transform', showLocations && 'rotate-180')} />
          </button>

          {showLocations && (
            <div className="mt-3 border-y border-aegis-border px-1">
              <LocationRow
                icon={<Database size={16} />}
                label={t('storage.workspaceLocation', 'OpenClaw 工作区')}
                value={workspaceDir}
                disabled={dataLayoutLocked}
                onChoose={() => void chooseExactDirectory(t('storage.workspaceChoose', '选择 OpenClaw 工作区'), setWorkspaceDir)}
              />
              <div className="border-b border-aegis-border/70 py-3">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-xs font-semibold text-aegis-text">{t('storage.customNpmCache', '自定义 npm 下载缓存')}</span>
                    <span className="mt-1 block text-[11px] text-aegis-text-muted">{t('storage.customNpmCacheHint', '关闭时使用 npm 在当前系统和用户下的默认缓存位置')}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={customNpmCache}
                    onChange={(event) => {
                      setCustomNpmCache(event.target.checked);
                      if (!event.target.checked) setNpmCacheDir('');
                    }}
                    className="h-4 w-4 accent-[rgb(var(--aegis-primary))]"
                  />
                </label>
                {customNpmCache && (
                  <LocationRow
                    icon={<Package size={16} />}
                    label={t('storage.npmCacheLocation', 'npm 下载缓存')}
                    value={npmCacheDir}
                    onChoose={() => void chooseExactDirectory(t('storage.npmCacheChoose', '选择 npm 下载缓存目录'), setNpmCacheDir)}
                  />
                )}
              </div>

              <div className="border-b border-aegis-border/70 py-3">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-xs font-semibold text-aegis-text">{t('storage.customNpmPrefix', '自定义 OpenClaw npm 安装目录')}</span>
                    <span className="mt-1 block text-[11px] text-aegis-text-muted">{t('storage.customNpmPrefixHint', '关闭时读取登录终端的 npm prefix；不可写时请在此选择目录')}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={customNpmPrefix}
                    onChange={(event) => setCustomNpmPrefix(event.target.checked)}
                    className="h-4 w-4 accent-[rgb(var(--aegis-primary))]"
                  />
                </label>
                {customNpmPrefix && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={npmPrefix}
                      onChange={(event) => setNpmPrefix(event.target.value)}
                      aria-label={t('storage.customNpmPrefix', '自定义 OpenClaw npm 安装目录')}
                      className="min-w-0 flex-1 rounded-md border border-aegis-border bg-aegis-surface px-3 py-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void chooseExactDirectory(t('storage.npmPrefixChoose', '选择 npm 全局安装目录'), setNpmPrefix)}
                      title={t('storage.npmPrefixChoose', '选择 npm 全局安装目录')}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface"
                    >
                      <FolderOpen size={15} />
                    </button>
                  </div>
                )}
              </div>

              {status.customNodeRuntimeSupported && (
                <div className="border-b border-aegis-border/70 py-3">
                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block text-xs font-semibold text-aegis-text">{t('storage.customNodeRuntime', '自定义 Node.js 运行时目录')}</span>
                      <span className="mt-1 block text-[11px] text-aegis-text-muted">{t('storage.customNodeRuntimeHint', '关闭时使用系统 Node.js；只有开启后才在所选目录维护便携运行时')}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={customNodeRuntime}
                      onChange={(event) => setCustomNodeRuntime(event.target.checked)}
                      className="h-4 w-4 accent-[rgb(var(--aegis-primary))]"
                    />
                  </label>
                  {customNodeRuntime && (
                    <LocationRow
                      icon={<Cpu size={16} />}
                      label={t('storage.nodeRuntimeLocation', 'Node.js 运行时目录')}
                      value={nodeRuntimeDir}
                      onChoose={() => void chooseExactDirectory(t('storage.nodeRuntimeChoose', '选择 Node.js 运行时目录'), setNodeRuntimeDir)}
                    />
                  )}
                </div>
              )}

              {status.customGitRuntimeSupported && (
                <div className="border-b border-aegis-border/70 py-3">
                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block text-xs font-semibold text-aegis-text">{t('storage.customGitRuntime', '自定义 Git 运行时目录')}</span>
                      <span className="mt-1 block text-[11px] text-aegis-text-muted">{t('storage.customGitRuntimeHint', '关闭时使用系统已安装的 Git；开启后仅在所选目录维护便携运行时')}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={customGitRuntime}
                      onChange={(event) => setCustomGitRuntime(event.target.checked)}
                      className="h-4 w-4 accent-[rgb(var(--aegis-primary))]"
                    />
                  </label>
                  {customGitRuntime && (
                    <LocationRow
                      icon={<GitBranch size={16} />}
                      label={t('storage.gitRuntimeLocation', 'Git 运行时目录')}
                      value={gitRuntimeDir}
                      onChoose={() => void chooseExactDirectory(t('storage.gitRuntimeChoose', '选择 Git 运行时目录'), setGitRuntimeDir)}
                    />
                  )}
                </div>
              )}

              <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
                <span className="flex min-w-0 gap-3">
                  <Terminal size={16} className="mt-0.5 shrink-0 text-aegis-text-dim" />
                  <span>
                    <span className="block text-xs font-semibold text-aegis-text">{t('storage.terminalIntegration', '在外部终端启用 OpenClaw')}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-aegis-text-muted">{t('storage.terminalIntegrationHint', { path: status.terminalLauncherDir, defaultValue: '创建独立启动器并配置用户 PATH；不会修改 npmrc，也不会全局替换 Node.js 或 Git。启动器：{{path}}' })}</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={terminalIntegration}
                  onChange={(event) => setTerminalIntegration(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--aegis-primary))]"
                />
              </label>

              {dataLayoutLocked && (
                <p className="border-t border-aegis-border/70 py-3 text-[11px] leading-5 text-aegis-warning">
                  {t('storage.migrationLayoutLocked', '迁移会保持现有工作区与内部运行时的相对布局；Node.js、Git 和 npm 位置可以重新选择。')}
                </p>
              )}
            </div>
          )}
        </div>

        {error && <p className="mt-5 break-all border-l-2 border-aegis-danger pl-3 text-sm text-aegis-danger">{error}</p>}

      </fieldset>
    </SetupShell>
  );
}
