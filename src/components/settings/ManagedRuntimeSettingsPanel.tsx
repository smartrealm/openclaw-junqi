import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Cpu, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/shared/GlassCard';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { translateSetupProgressMessage } from '@/hooks/setupProgressParams';

interface RuntimeToolStatus {
  available: boolean;
  version?: string;
  path?: string;
  source?: 'local' | 'system';
}

interface ManagedRuntimeStatus {
  runtimeDir: string;
  node: RuntimeToolStatus;
  nodeRequirement: string;
  nodeRequirementSource: string;
  nodeAutoUpdateSupported: boolean;
  git: RuntimeToolStatus;
  gitAutoUpdateSupported: boolean;
  nodeDownloadOrder: string[];
  gitDownloadOrder: string[];
}

interface SetupProgress {
  step: string;
  message: string;
  key?: string | null;
  progress?: number;
  error?: string;
}

type RuntimeAction = 'node' | 'git';

function ToolRow({
  icon,
  title,
  status,
  detail,
  actionLabel,
  busy,
  disabled,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  status: RuntimeToolStatus;
  detail: string;
  actionLabel: string;
  busy: boolean;
  disabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <div className="grid min-h-[108px] grid-cols-1 gap-3 border-t border-aegis-border/70 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
          {icon}
          <span>{title}</span>
          <span className={status.available ? 'text-aegis-success' : 'text-aegis-warning'}>
            {status.version || '—'}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-aegis-text-muted">{detail}</p>
        <p className="mt-1 break-all font-mono text-xs leading-5 text-aegis-text-dim">
          {status.path || '—'}
        </p>
      </div>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={busy || disabled}
          className="inline-flex h-9 min-w-[112px] items-center justify-center gap-2 justify-self-start rounded-md border border-aegis-border bg-aegis-surface px-3 text-xs font-semibold text-aegis-text hover:border-aegis-primary/50 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-45 sm:mt-1 sm:justify-self-end"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {actionLabel}
        </button>
      ) : (
        <span className="inline-flex h-9 min-w-[112px] items-center justify-center justify-self-start text-xs font-medium text-aegis-text-muted sm:mt-1 sm:justify-self-end">
          {actionLabel}
        </span>
      )}
    </div>
  );
}

export function ManagedRuntimeSettingsPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ManagedRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<RuntimeAction | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await invoke<ManagedRuntimeStatus>('get_managed_runtime_status'));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeTauriEvent<SetupProgress>('setup-progress', (event) => {
    const payload = event.payload;
    if (payload.step !== 'node' && payload.step !== 'git') return;
    setLog(translateSetupProgressMessage(
      payload.key,
      payload.message,
      (translationKey, options) => t(translationKey, options),
    ));
    setProgress(typeof payload.progress === 'number' ? payload.progress : null);
    if (payload.error) setError(payload.error);
  }), [t]);

  const runUpdate = async (nextAction: RuntimeAction) => {
    if (
      action
      || (nextAction === 'node' && !status?.nodeAutoUpdateSupported)
      || (nextAction === 'git' && !status?.gitAutoUpdateSupported)
    ) return;
    setAction(nextAction);
    setProgress(0);
    setLog(t('storage.runtimeUpdateStarting', '正在解析最新兼容版本…'));
    setError(null);
    try {
      const command = nextAction === 'node' ? 'update_managed_node' : 'update_managed_git';
      const result = await invoke<string>(command);
      setLog(result);
      setProgress(1);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setAction(null);
    }
  };

  const sourceLabel = (source?: RuntimeToolStatus['source']) => source === 'local'
    ? t('storage.runtimeSourceCustom', '用户选择的目录')
    : source === 'system'
      ? t('storage.runtimeSourceSystem', '系统安装')
      : t('storage.runtimeSourceUnknown', '未检测到');
  const requirementSourceLabel = status?.nodeRequirementSource === 'target'
    ? t('storage.runtimeRequirementTarget', '目标 OpenClaw 包')
    : status?.nodeRequirementSource === 'installed'
      ? t('storage.runtimeRequirementInstalled', '已安装 OpenClaw 包')
      : t('storage.runtimeRequirementFallback', '兼容回退策略');

  return (
    <GlassCard delay={0.24}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-aegis-text">
            <Cpu size={17} className="text-aegis-primary" />
            {t('storage.runtimeSettingsTitle', 'Node.js / Git 运行时')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-aegis-text-muted">
            {t('storage.runtimeSettingsHint', '默认使用系统已安装路径；Windows 更新使用系统包管理器，自定义目录仅更新用户选择的便携运行时。')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || action !== null}
          title={t('storage.runtimeRefresh', '刷新状态')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface disabled:opacity-45"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {status && (
        <div className="mt-3">
          <ToolRow
            icon={<Cpu size={16} className="text-aegis-primary" />}
            title="Node.js"
            status={status.node}
            detail={t('storage.runtimeNodeDetail', {
              requirement: status.nodeRequirement,
              requirementSource: requirementSourceLabel,
              source: sourceLabel(status.node.source),
              defaultValue: 'OpenClaw 要求：{{requirement}} · 依据：{{requirementSource}} · {{source}}',
            })}
            actionLabel={status.nodeAutoUpdateSupported
              ? action === 'node' ? t('storage.runtimeUpdating', '更新中') : t('storage.runtimeUpdateNode', '更新 Node.js')
              : t('storage.runtimeUpdateSystem', '通过系统包管理器更新')}
            busy={action === 'node'}
            onAction={status.nodeAutoUpdateSupported ? () => void runUpdate('node') : undefined}
          />
          <ToolRow
            icon={<GitBranch size={16} className="text-aegis-primary" />}
            title="Git"
            status={status.git}
            detail={t('storage.runtimeGitDetail', {
              source: sourceLabel(status.git.source),
              defaultValue: 'Git 来源：{{source}}',
            })}
            actionLabel={status.gitAutoUpdateSupported
              ? action === 'git' ? t('storage.runtimeUpdating', '更新中') : t('storage.runtimeUpdateGit', '更新 Git')
              : t('storage.runtimeUpdateSystem', '通过系统包管理器更新')}
            busy={action === 'git'}
            disabled={!status.gitAutoUpdateSupported}
            onAction={status.gitAutoUpdateSupported ? () => void runUpdate('git') : undefined}
          />
        </div>
      )}

      {status && (
        <p className="text-xs leading-5 text-aegis-text-muted">
          {status.nodeDownloadOrder.length > 0 && status.gitDownloadOrder.length > 0
            ? t('storage.runtimeDownloadOrderWithGit', {
              node: status.nodeDownloadOrder.join(' → '),
              git: status.gitDownloadOrder.join(' → '),
              defaultValue: '下载顺序：Node.js {{node}}；Git {{git}}',
            })
            : status.nodeDownloadOrder.length > 0 ? t('storage.runtimeDownloadOrderNode', {
              node: status.nodeDownloadOrder.join(' → '),
              defaultValue: '下载顺序：Node.js {{node}}',
            }) : t('storage.runtimeSystemManaged', '使用操作系统或包管理器的标准安装位置')}
        </p>
      )}

      {(log || action) && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-aegis-surface">
            <div className="h-full bg-aegis-primary transition-[width] duration-300" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <p className="mt-2 break-words font-mono text-xs leading-5 text-aegis-text-muted">{log}</p>
        </div>
      )}
      {error && <p className="mt-3 break-all text-xs leading-5 text-aegis-danger">{error}</p>}
    </GlassCard>
  );
}
