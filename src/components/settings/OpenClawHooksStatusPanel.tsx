import { PlugZap, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type {
  OpenClawHookBlockedReason,
  OpenClawHooksStatusSnapshot,
} from '@/services/gateway/OpenClawHooksStatusClient';

interface OpenClawHooksStatusPanelProps {
  readonly snapshot: OpenClawHooksStatusSnapshot | null;
  readonly loading: boolean;
  readonly failure: 'unavailable' | 'invalid' | null;
  readonly onRefresh: () => void;
}

function blockedReasonLabel(
  reason: OpenClawHookBlockedReason | undefined,
  t: (key: string, fallback: string) => string,
): string | null {
  if (reason === 'disabled in config') return t('maintenance.openClawHooks.disabledInConfig', 'Disabled in OpenClaw configuration');
  if (reason === 'workspace hook (disabled by default)') return t('maintenance.openClawHooks.workspaceDisabled', 'Workspace hook is disabled by default');
  if (reason === 'missing requirements') return t('maintenance.openClawHooks.missingRequirements', 'Requirements are not satisfied');
  if (reason === 'no events defined') return t('maintenance.openClawHooks.noEventsDefined', 'No events are defined');
  return null;
}

/** 维护中心仅显示安全的 Hook 状态投影，不提供安装、启停或重载控制。 */
export function OpenClawHooksStatusPanel({
  snapshot,
  loading,
  failure,
  onRefresh,
}: OpenClawHooksStatusPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="border-t border-aegis-border/45 pt-4" aria-labelledby="openclaw-hooks-status-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="openclaw-hooks-status-title" className="flex items-center gap-2 text-[13px] font-semibold text-aegis-text">
            <PlugZap size={15} className="text-aegis-primary" aria-hidden="true" />
            {t('maintenance.openClawHooks.title')}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">
            {t('maintenance.openClawHooks.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border/70 text-aegis-text-dim transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('maintenance.openClawHooks.refresh')}
          title={t('maintenance.openClawHooks.refresh')}
        >
          {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </div>

      {!snapshot && !loading && !failure && (
        <p className="mt-3 text-[12px] text-aegis-text-muted">{t('maintenance.openClawHooks.ready')}</p>
      )}

      {failure && (
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-aegis-warning">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {failure === 'unavailable'
            ? t('maintenance.openClawHooks.unavailable')
            : t('maintenance.openClawHooks.invalid')}
        </p>
      )}

      {snapshot && (snapshot.hooks.length === 0 ? (
        <p className="mt-3 text-[12px] text-aegis-text-muted">{t('maintenance.openClawHooks.empty')}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {snapshot.hooks.map((hook) => {
            const blocked = blockedReasonLabel(hook.blockedReason, t);
            return (
              <article key={hook.name} className="border border-aegis-border/55 bg-aegis-bg/35 px-3 py-2.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-[12px] font-medium text-aegis-text">{hook.name}</h4>
                    {hook.description && <p className="mt-0.5 break-words text-[11px] leading-5 text-aegis-text-dim">{hook.description}</p>}
                  </div>
                  <span className={hook.loadable
                    ? 'shrink-0 rounded border border-aegis-success/35 bg-aegis-success/10 px-1.5 py-0.5 text-[10px] text-aegis-success'
                    : 'shrink-0 rounded border border-aegis-warning/35 bg-aegis-warning/10 px-1.5 py-0.5 text-[10px] text-aegis-warning'}
                  >
                    {hook.loadable ? t('maintenance.openClawHooks.loadable') : t('maintenance.openClawHooks.blocked')}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {hook.events.map((event) => (
                    <span key={event} className="rounded border border-aegis-border/55 px-1.5 py-0.5 font-mono text-[10px] text-aegis-text-muted">{event}</span>
                  ))}
                  {hook.pluginId && <span className="rounded border border-aegis-border/55 px-1.5 py-0.5 font-mono text-[10px] text-aegis-text-muted">{hook.pluginId}</span>}
                </div>
                {blocked && <p className="mt-2 text-[10.5px] text-aegis-warning">{blocked}</p>}
                {hook.unknownEvents.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-4 text-aegis-warning">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {t('maintenance.openClawHooks.unknownEvents', { events: hook.unknownEvents.join(', ') })}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
