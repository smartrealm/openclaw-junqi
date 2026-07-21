import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Download,
  HardDrive,
  PlugZap,
  RefreshCw,
  Settings2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import {
  useCollaborationText,
  type CollaborationTranslate,
} from './CollaborationCard';

export type CollaborationSetupReason =
  | 'loading'
  | 'plugin-missing'
  | 'plugin-not-configured'
  | 'runtime-not-durable'
  | 'version-incompatible'
  | 'no-agents'
  | 'error'
  | 'ready';

export interface CollaborationSetupNoticeProps {
  capabilities?: CollaborationCapabilities | null;
  loading?: boolean;
  error?: string | null;
  reason?: CollaborationSetupReason;
  availableAgentCount?: number;
  minimumSchemaVersion?: number;
  expectedSchemaVersion?: number;
  showReady?: boolean;
  translate?: CollaborationTranslate;
  onPrimaryAction?: (reason: CollaborationSetupReason) => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

interface NoticeDefinition {
  icon: LucideIcon;
  title: string;
  message: string;
  action: string;
  tone: 'neutral' | 'warning' | 'danger' | 'success';
}

const NOTICE_DEFINITIONS: Record<Exclude<CollaborationSetupReason, 'loading'>, NoticeDefinition> = {
  'plugin-missing': {
    icon: PlugZap,
    title: 'Collaboration is not installed',
    message: 'Install the JunQi collaboration plugin to run durable multi-agent workflows from Chat.',
    action: 'Install plugin',
    tone: 'warning',
  },
  'plugin-not-configured': {
    icon: Settings2,
    title: 'Collaboration needs configuration',
    message: 'Choose the coordinator and allowed agents before starting a workflow.',
    action: 'Configure',
    tone: 'warning',
  },
  'runtime-not-durable': {
    icon: HardDrive,
    title: 'Persistent runtime required',
    message: 'This Gateway stops with JunQi. Use a system service, persistent Docker runtime, or external Gateway for durable workflows.',
    action: 'Review runtime',
    tone: 'warning',
  },
  'version-incompatible': {
    icon: Download,
    title: 'Collaboration update required',
    message: 'The installed plugin schema is not compatible with this JunQi version.',
    action: 'Review update',
    tone: 'danger',
  },
  'no-agents': {
    icon: Bot,
    title: 'No workflow agents available',
    message: 'Create or allow at least one OpenClaw agent before starting a collaboration.',
    action: 'Manage agents',
    tone: 'warning',
  },
  error: {
    icon: TriangleAlert,
    title: 'Collaboration is unavailable',
    message: 'JunQi could not read the collaboration capability. Check the Gateway and try again.',
    action: 'Retry',
    tone: 'danger',
  },
  ready: {
    icon: CheckCircle2,
    title: 'Collaboration is ready',
    message: 'This runtime can continue workflow execution while JunQi is closed.',
    action: 'View settings',
    tone: 'success',
  },
};

export function resolveCollaborationSetupReason({
  capabilities,
  loading,
  error,
  reason,
  availableAgentCount,
  minimumSchemaVersion = 1,
  expectedSchemaVersion,
}: Pick<
  CollaborationSetupNoticeProps,
  'capabilities' | 'loading' | 'error' | 'reason' | 'availableAgentCount' | 'minimumSchemaVersion' | 'expectedSchemaVersion'
>): CollaborationSetupReason {
  if (reason) return reason;
  if (loading) return 'loading';
  if (error) return 'error';
  if (!capabilities) return 'plugin-missing';
  if (expectedSchemaVersion !== undefined && capabilities.schemaVersion !== expectedSchemaVersion) {
    return 'version-incompatible';
  }
  if (capabilities.schemaVersion < minimumSchemaVersion) return 'version-incompatible';
  if (capabilities.configured === false) return 'plugin-not-configured';
  if (!capabilities.durableRuntime) return 'runtime-not-durable';
  if (availableAgentCount === 0) return 'no-agents';
  return 'ready';
}

function diagnosticMessage(
  reason: CollaborationSetupReason,
  capabilities: CollaborationCapabilities | null | undefined,
  error: string | null | undefined,
): string | null {
  if (error) return error;
  if (reason === 'runtime-not-durable') {
    const detail = capabilities?.durableRuntimeDetails?.reason;
    return typeof detail === 'string' && detail.trim() ? detail : null;
  }
  const diagnostic = capabilities?.diagnostics?.message ?? capabilities?.diagnostics?.reason;
  return typeof diagnostic === 'string' && diagnostic.trim() ? diagnostic : null;
}

export function CollaborationSetupNotice({
  capabilities,
  loading = false,
  error,
  reason: explicitReason,
  availableAgentCount,
  minimumSchemaVersion = 1,
  expectedSchemaVersion,
  showReady = false,
  translate,
  onPrimaryAction,
  onRetry,
  onDismiss,
  className,
}: CollaborationSetupNoticeProps) {
  const text = useCollaborationText(translate);
  const reason = resolveCollaborationSetupReason({
    capabilities,
    loading,
    error,
    reason: explicitReason,
    availableAgentCount,
    minimumSchemaVersion,
    expectedSchemaVersion,
  });

  if (reason === 'ready' && !showReady) return null;

  if (reason === 'loading') {
    return (
      <div
        className={cn('w-full rounded-lg border border-aegis-border bg-aegis-surface-solid px-3.5 py-3', className)}
        aria-busy="true"
        aria-label={text('collaboration.setup.loading', 'Checking collaboration capability')}
      >
        <div className="flex items-center gap-3">
          <span className="h-8 w-8 shrink-0 rounded-md bg-[rgb(var(--aegis-overlay)/0.08)]" />
          <span className="min-w-0 flex-1">
            <span className="block h-3 w-40 max-w-full rounded-sm bg-[rgb(var(--aegis-overlay)/0.08)]" />
            <span className="mt-2 block h-2.5 w-4/5 rounded-sm bg-[rgb(var(--aegis-overlay)/0.06)]" />
          </span>
        </div>
      </div>
    );
  }

  const definition = NOTICE_DEFINITIONS[reason];
  const Icon = definition.icon;
  const detail = diagnosticMessage(reason, capabilities, error);
  const role = definition.tone === 'danger' ? 'alert' : 'status';
  const canRetry = reason === 'error' && onRetry;
  const canPrimaryAction = reason !== 'error' && onPrimaryAction;

  return (
    <aside
      role={role}
      className={cn(
        'w-full rounded-lg border px-3.5 py-3 text-aegis-text',
        definition.tone === 'neutral' && 'border-aegis-border bg-aegis-surface-solid',
        definition.tone === 'warning' && 'border-aegis-warning/25 bg-aegis-warning/[0.055]',
        definition.tone === 'danger' && 'border-aegis-danger/25 bg-aegis-danger/[0.055]',
        definition.tone === 'success' && 'border-aegis-success/25 bg-aegis-success/[0.055]',
        className,
      )}
      data-collaboration-setup-reason={reason}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
            definition.tone === 'neutral' && 'border-aegis-border text-aegis-text-muted',
            definition.tone === 'warning' && 'border-aegis-warning/25 text-aegis-warning',
            definition.tone === 'danger' && 'border-aegis-danger/25 text-aegis-danger',
            definition.tone === 'success' && 'border-aegis-success/25 text-aegis-success',
          )}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-[12px] font-semibold text-aegis-text-secondary">
              {text(`collaboration.setup.${reason}.title`, definition.title)}
            </h3>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={text('collaboration.common.dismiss', 'Dismiss')}
                title={text('collaboration.common.dismiss', 'Dismiss')}
                className="-me-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.05)] hover:text-aegis-text-muted"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1 max-w-[72ch] break-words text-[10.5px] leading-4 text-aegis-text-muted">
            {text(`collaboration.setup.${reason}.message`, definition.message)}
          </p>
          {detail && (
            <div className="mt-1.5 flex min-w-0 items-start gap-1.5 text-[10px] text-aegis-text-dim">
              <CircleAlert size={11} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{detail}</span>
            </div>
          )}
        </div>
        {(canRetry || canPrimaryAction) && (
          <button
            type="button"
            onClick={() => canRetry ? onRetry?.() : onPrimaryAction?.(reason)}
            className={cn(
              'hidden min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10.5px] font-medium sm:inline-flex',
              definition.tone === 'danger' && 'border-aegis-danger/30 text-aegis-danger hover:bg-aegis-danger/[0.08]',
              definition.tone === 'warning' && 'border-aegis-warning/30 text-aegis-warning hover:bg-aegis-warning/[0.08]',
              definition.tone === 'success' && 'border-aegis-success/30 text-aegis-success hover:bg-aegis-success/[0.08]',
              definition.tone === 'neutral' && 'border-aegis-border text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
            )}
          >
            {canRetry ? <RefreshCw size={12} aria-hidden /> : <Icon size={12} aria-hidden />}
            {text(`collaboration.setup.${reason}.action`, definition.action)}
          </button>
        )}
      </div>
      {(canRetry || canPrimaryAction) && (
        <button
          type="button"
          onClick={() => canRetry ? onRetry?.() : onPrimaryAction?.(reason)}
          className={cn(
            'mt-3 inline-flex min-h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10.5px] font-medium sm:hidden',
            definition.tone === 'danger' && 'border-aegis-danger/30 text-aegis-danger',
            definition.tone === 'warning' && 'border-aegis-warning/30 text-aegis-warning',
            definition.tone === 'success' && 'border-aegis-success/30 text-aegis-success',
            definition.tone === 'neutral' && 'border-aegis-border text-aegis-text-secondary',
          )}
        >
          {canRetry ? <RefreshCw size={12} aria-hidden /> : <Icon size={12} aria-hidden />}
          {text(`collaboration.setup.${reason}.action`, definition.action)}
        </button>
      )}
    </aside>
  );
}
