import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronDown, Database, FolderOpen, HardDrive, LoaderCircle, Package, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { SetupShell } from '@/components/setup/SetupFlowPanels';
import type { SetupLog } from '@/stores/app-store';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

interface StorageSetupStatus {
  configured: boolean;
  stateDir: string;
  configPath: string;
  workspaceDir: string;
  runtimeDir: string;
  npmCacheDir: string;
  npmPrefix: string | null;
  terminalIntegration: boolean;
  terminalLauncherDir: string;
  legacyDir: string;
  legacyExists: boolean;
  legacySizeBytes: number;
}

interface MigrationProgress {
  key?: string;
  message: string;
  progress: number;
}

interface StorageSetupStepProps {
  onReady: (result?: { createdFresh: boolean }) => void;
  onBack: () => void;
  logs: SetupLog[];
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

export function StorageSetupStep({ onReady, onBack, logs }: StorageSetupStepProps) {
  const { t } = useTranslation();
  const checkedRef = useRef(false);
  const mountedRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [status, setStatus] = useState<StorageSetupStatus | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [runtimeDir, setRuntimeDir] = useState('');
  const [npmCacheDir, setNpmCacheDir] = useState('');
  const [npmPrefix, setNpmPrefix] = useState('');
  const [customNpmPrefix, setCustomNpmPrefix] = useState(false);
  const [terminalIntegration, setTerminalIntegration] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [migrateExisting, setMigrateExisting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!checkedRef.current) {
      checkedRef.current = true;
      if (!(window as any).__TAURI_INTERNALS__) {
        onReadyRef.current({ createdFresh: false });
      } else {
        void invoke<StorageSetupStatus>('get_storage_setup_status')
          .then((result) => {
            if (!mountedRef.current) return;
            if (result.configured) {
              onReadyRef.current({ createdFresh: false });
              return;
            }
            setStatus(result);
            setTargetDir(result.legacyDir);
            setWorkspaceDir(result.workspaceDir);
            setRuntimeDir(result.runtimeDir);
            setNpmCacheDir(result.npmCacheDir);
            setNpmPrefix(result.npmPrefix ?? '');
            setCustomNpmPrefix(Boolean(result.npmPrefix));
            setTerminalIntegration(result.terminalIntegration);
            setMigrateExisting(result.legacyExists);
          })
          .catch((cause) => {
            if (mountedRef.current) setError(String(cause));
          })
          .finally(() => {
            if (mountedRef.current) setLoading(false);
          });
      }
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten = subscribeTauriEvent<MigrationProgress>('storage-migration-progress', (event) => {
      if (cancelled) return;
      const payload = event.payload;
      setProgress({
        ...payload,
        message: payload.key ? t(payload.key, payload.message) : payload.message,
      });
    });
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [t]);

  const usingLegacy = useMemo(
    () => Boolean(status && targetDir === status.legacyDir),
    [status, targetDir],
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
    const shouldMigrate = Boolean(status?.legacyExists);
    setTargetDir(target);
    setMigrateExisting(shouldMigrate);
    if (status && shouldMigrate) {
      setWorkspaceDir(remapChildPath(status.workspaceDir, status.legacyDir, target));
      setRuntimeDir(remapChildPath(status.runtimeDir, status.legacyDir, target));
      setNpmCacheDir(remapChildPath(status.npmCacheDir, status.legacyDir, target));
    } else {
      setWorkspaceDir(joinPath(target, 'workspace'));
      setRuntimeDir(joinPath(target, 'runtime'));
      setNpmCacheDir(joinPath(target, 'npm-cache'));
    }
    setError(null);
  }, [status, t]);

  const chooseExactDirectory = useCallback(async (title: string, apply: (path: string) => void) => {
    const selected = await open({ directory: true, multiple: false, title });
    if (!mountedRef.current || typeof selected !== 'string') return;
    apply(selected);
    setError(null);
  }, []);

  const chooseManagedRuntime = useCallback(async () => {
    await chooseExactDirectory(
      t('storage.runtimeChoose', '选择托管运行时所在文件夹'),
      (parent) => setRuntimeDir(joinPath(parent, 'JunQi Runtime')),
    );
  }, [chooseExactDirectory, t]);

  const applyStorage = useCallback(async () => {
    if (!status || !targetDir || applying) return;
    setApplying(true);
    setError(null);
    setProgress({
      message: usingLegacy
        ? t('storage.activating', '正在确认存储位置…')
        : t('storage.preparing', '正在准备新存储位置…'),
      progress: 0.02,
    });
    try {
      await invoke('configure_storage', {
        targetDir,
        migrateExisting: !usingLegacy && status.legacyExists && migrateExisting,
        locations: {
          workspaceDir,
          runtimeDir,
          npmCacheDir,
          npmPrefix: customNpmPrefix ? npmPrefix.trim() || null : null,
          terminalIntegration,
        },
      });
      if (!mountedRef.current) return;
      onReadyRef.current({
        createdFresh: !usingLegacy && (!status.legacyExists || !migrateExisting),
      });
    } catch (cause) {
      if (mountedRef.current) setError(String(cause));
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  }, [applying, customNpmPrefix, migrateExisting, npmCacheDir, npmPrefix, runtimeDir, status, t, targetDir, terminalIntegration, usingLegacy, workspaceDir]);

  if (loading) {
    return (
      <SetupShell
        active={2}
        title={t('storage.title', '选择 OpenClaw 数据位置')}
        subtitle={t('storage.subtitle', '配置、会话、认证、工作区和 JunQi 管理的运行时将使用此位置。')}
        logs={logs}
        previousAction={{ onClick: onBack }}
        nextAction={{ label: t('storage.loading', '正在读取存储信息…'), disabled: true, loading: true, icon: 'none' }}
      >
        <div className="flex min-h-[220px] items-center justify-center">
          <LoaderCircle className="animate-spin text-aegis-primary" size={26} />
        </div>
      </SetupShell>
    );
  }

  if (!status) {
    return (
      <SetupShell
        active={2}
        title={t('storage.loadFailed', '无法读取存储配置')}
        subtitle={t('storage.subtitle', '配置、会话、认证、工作区和 JunQi 管理的运行时将使用此位置。')}
        logs={logs}
        previousAction={{ onClick: onBack }}
        nextAction={{ label: t('common.retry', '重试'), onClick: () => window.location.reload(), icon: 'none' }}
      >
        <section className="border-y border-aegis-border py-7">
          <h1 className="text-lg font-semibold">{t('storage.loadFailed', '无法读取存储配置')}</h1>
          <p className="mt-3 break-all border-l-2 border-aegis-danger pl-3 text-sm text-aegis-danger">{error}</p>
        </section>
      </SetupShell>
    );
  }

  const actionLabel = usingLegacy
    ? t('storage.continue', '继续')
    : migrateExisting && status.legacyExists
      ? t('storage.migrateAndContinue', '迁移并继续')
      : t('storage.createAndContinue', '创建并继续');
  const customLocationsLocked = !usingLegacy && status.legacyExists && migrateExisting;
  const layoutComplete = Boolean(
    targetDir.trim()
      && workspaceDir.trim()
      && runtimeDir.trim()
      && npmCacheDir.trim()
      && (!customNpmPrefix || npmPrefix.trim()),
  );

  return (
    <SetupShell
      active={2}
      title={t('storage.title', '选择 OpenClaw 数据位置')}
      subtitle={t('storage.subtitle', '配置、会话、认证、工作区和 JunQi 管理的运行时将使用此位置。')}
      logs={logs}
      previousAction={{ onClick: onBack, disabled: applying }}
      nextAction={{
        label: applying ? progress?.message || t('storage.preparing', '正在准备新存储位置…') : actionLabel,
        onClick: () => void applyStorage(),
        disabled: applying || !layoutComplete,
        loading: applying,
        icon: 'none',
      }}
    >
      <section className="border-y border-aegis-border py-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setTargetDir(status.legacyDir);
              setWorkspaceDir(status.workspaceDir);
              setRuntimeDir(status.runtimeDir);
              setNpmCacheDir(status.npmCacheDir);
              setMigrateExisting(false);
              setError(null);
            }}
            className={clsx(
              'min-h-[116px] rounded-lg border p-4 text-left transition-colors',
              usingLegacy
                ? 'border-aegis-primary bg-aegis-primary/8'
                : 'border-aegis-border hover:border-aegis-primary/50',
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><HardDrive size={16} />{t('storage.defaultLocation', '使用当前位置')}</span>
              {usingLegacy && <Check size={16} className="text-aegis-primary" />}
            </span>
            <span className="mt-3 block break-all font-mono text-[11px] leading-5 text-aegis-text-dim">{status.legacyDir}</span>
            {status.legacyExists && (
              <span className="mt-1 block text-xs text-aegis-text-muted">{formatBytes(status.legacySizeBytes)}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => void chooseDirectory()}
            className={clsx(
              'min-h-[116px] rounded-lg border p-4 text-left transition-colors',
              !usingLegacy
                ? 'border-aegis-primary bg-aegis-primary/8'
                : 'border-aegis-border hover:border-aegis-primary/50',
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold"><FolderOpen size={16} />{t('storage.customLocation', '选择其他位置')}</span>
              {!usingLegacy && <Check size={16} className="text-aegis-primary" />}
            </span>
            <span className="mt-3 block break-all font-mono text-[11px] leading-5 text-aegis-text-dim">
              {!usingLegacy ? targetDir : t('storage.customLocationHint', '其他磁盘或文件夹')}
            </span>
          </button>
        </div>

        {!usingLegacy && status.legacyExists && (
          <div className="mt-5 border-l-2 border-aegis-primary/40 pl-4">
            <div className="text-sm font-semibold">{t('storage.existingData', '检测到现有 OpenClaw 数据')}</div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                checked={migrateExisting}
                onChange={() => {
                  setMigrateExisting(true);
                  setWorkspaceDir(remapChildPath(status.workspaceDir, status.legacyDir, targetDir));
                  setRuntimeDir(remapChildPath(status.runtimeDir, status.legacyDir, targetDir));
                  setNpmCacheDir(remapChildPath(status.npmCacheDir, status.legacyDir, targetDir));
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
                  setNpmCacheDir(joinPath(targetDir, 'npm-cache'));
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
              <span className="mt-1 block text-xs text-aegis-text-muted">{t('storage.installLocationsHint', '工作区、托管运行时、npm 缓存和终端集成')}</span>
            </span>
            <ChevronDown size={16} className={clsx('shrink-0 text-aegis-text-dim transition-transform', showLocations && 'rotate-180')} />
          </button>

          {showLocations && (
            <div className="mt-3 border-y border-aegis-border px-1">
              <LocationRow
                icon={<Database size={16} />}
                label={t('storage.workspaceLocation', 'OpenClaw 工作区')}
                value={workspaceDir}
                disabled={customLocationsLocked}
                onChoose={() => void chooseExactDirectory(t('storage.workspaceChoose', '选择 OpenClaw 工作区'), setWorkspaceDir)}
              />
              <LocationRow
                icon={<Wrench size={16} />}
                label={t('storage.runtimeLocation', 'Node.js / Git 托管运行时')}
                value={runtimeDir}
                disabled={customLocationsLocked}
                onChoose={() => void chooseManagedRuntime()}
              />
              <LocationRow
                icon={<Package size={16} />}
                label={t('storage.npmCacheLocation', 'npm 下载缓存')}
                value={npmCacheDir}
                disabled={customLocationsLocked}
                onChoose={() => void chooseExactDirectory(t('storage.npmCacheChoose', '选择 npm 下载缓存目录'), setNpmCacheDir)}
              />

              <div className="border-b border-aegis-border/70 py-3">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-xs font-semibold text-aegis-text">{t('storage.customNpmPrefix', '自定义 OpenClaw npm 安装目录')}</span>
                    <span className="mt-1 block text-[11px] text-aegis-text-muted">{t('storage.customNpmPrefixHint', '关闭时读取登录终端的 npm prefix；不可写时使用用户目录回退')}</span>
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

              {customLocationsLocked && (
                <p className="border-t border-aegis-border/70 py-3 text-[11px] leading-5 text-aegis-warning">
                  {t('storage.migrationLayoutLocked', '迁移会保持现有工作区与运行时的相对布局。选择“创建全新环境”后可以分别修改这些目录。')}
                </p>
              )}
            </div>
          )}
        </div>

        {progress && applying && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-4 text-xs text-aegis-text-muted">
              <span>{progress.message}</span>
              <span>{Math.round(progress.progress * 100)}%</span>
            </div>
            <div className="h-1 overflow-hidden bg-aegis-surface">
              <div className="h-full bg-aegis-primary transition-[width] duration-300" style={{ width: `${Math.max(3, progress.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {error && <p className="mt-5 break-all border-l-2 border-aegis-danger pl-3 text-sm text-aegis-danger">{error}</p>}

      </section>
    </SetupShell>
  );
}
