import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, FolderOpen, HardDrive, LoaderCircle } from 'lucide-react';
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

export function StorageSetupStep({ onReady, onBack, logs }: StorageSetupStepProps) {
  const { t } = useTranslation();
  const checkedRef = useRef(false);
  const [status, setStatus] = useState<StorageSetupStatus | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [migrateExisting, setMigrateExisting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    if (!(window as any).__TAURI_INTERNALS__) {
      onReady({ createdFresh: false });
      return;
    }
    void invoke<StorageSetupStatus>('get_storage_setup_status')
      .then((result) => {
        if (result.configured) {
          onReady({ createdFresh: false });
          return;
        }
        setStatus(result);
        setTargetDir(result.legacyDir);
        setMigrateExisting(result.legacyExists);
      })
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [onReady]);

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
    if (typeof selected !== 'string') return;
    setTargetDir(childStoragePath(selected));
    setMigrateExisting(Boolean(status?.legacyExists));
    setError(null);
  }, [status?.legacyExists, t]);

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
      });
      onReady({
        createdFresh: !usingLegacy && (!status.legacyExists || !migrateExisting),
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setApplying(false);
    }
  }, [applying, migrateExisting, onReady, status, t, targetDir, usingLegacy]);

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

  return (
    <SetupShell
      active={2}
      title={t('storage.title', '选择 OpenClaw 数据位置')}
      subtitle={t('storage.subtitle', '配置、会话、认证、工作区和 JunQi 管理的运行时将使用此位置。')}
      logs={logs}
      previousAction={{ onClick: onBack }}
      nextAction={{
        label: applying ? progress?.message || t('storage.preparing', '正在准备新存储位置…') : actionLabel,
        onClick: () => void applyStorage(),
        disabled: applying || !targetDir,
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
                onChange={() => setMigrateExisting(true)}
                className="mt-1 accent-[rgb(var(--aegis-primary))]"
              />
              <span><strong>{t('storage.migrate', '迁移现有数据')}</strong><span className="mt-0.5 block text-xs text-aegis-text-muted">{t('storage.migrateHint', '保留配置、认证、会话和工作区，源目录不会自动删除。')}</span></span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                checked={!migrateExisting}
                onChange={() => setMigrateExisting(false)}
                className="mt-1 accent-[rgb(var(--aegis-primary))]"
              />
              <span><strong>{t('storage.startFresh', '创建全新环境')}</strong><span className="mt-0.5 block text-xs text-aegis-text-muted">{t('storage.startFreshHint', '旧目录保持不变，新位置从空配置开始。')}</span></span>
            </label>
          </div>
        )}

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
