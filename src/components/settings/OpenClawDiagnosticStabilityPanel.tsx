import { Activity, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type { OpenClawDiagnosticStabilitySnapshot } from '@/services/gateway/OpenClawDiagnosticStabilityClient';

interface OpenClawDiagnosticStabilityPanelProps {
  readonly snapshot: OpenClawDiagnosticStabilitySnapshot | null;
  readonly loading: boolean;
  readonly failure: 'unavailable' | 'invalid' | null;
  readonly onRefresh: () => void;
}

function formatEventTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

export function OpenClawDiagnosticStabilityPanel({
  snapshot,
  loading,
  failure,
  onRefresh,
}: OpenClawDiagnosticStabilityPanelProps) {
  const { t, i18n } = useTranslation();
  const eventTypes = snapshot
    ? Object.entries(snapshot.byType).sort(([left], [right]) => left.localeCompare(right))
    : [];

  return (
    <section className="border-t border-aegis-border/45 pt-4" aria-labelledby="openclaw-stability-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="openclaw-stability-title" className="flex items-center gap-2 text-[13px] font-semibold text-aegis-text">
            <Activity size={15} className="text-aegis-primary" aria-hidden="true" />
            {t('maintenance.openClawStability.title')}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">
            {t('maintenance.openClawStability.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-aegis-border/70 text-aegis-text-dim transition-colors hover:border-aegis-primary/60 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('maintenance.openClawStability.refresh')}
          title={t('maintenance.openClawStability.refresh')}
        >
          {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
      </div>

      {!snapshot && !loading && !failure && (
        <p className="mt-3 text-[12px] text-aegis-text-muted">
          {t('maintenance.openClawStability.ready')}
        </p>
      )}

      {failure && (
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-aegis-warning">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {failure === 'unavailable'
            ? t('maintenance.openClawStability.unavailable')
            : t('maintenance.openClawStability.invalid')}
        </p>
      )}

      {snapshot && (
        <>
          <dl className="mt-3 grid grid-cols-[minmax(112px,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12px] leading-5">
            <dt className="text-aegis-text-dim">{t('maintenance.openClawStability.generatedAt')}</dt>
            <dd className="min-w-0 break-words font-mono text-aegis-text">{snapshot.generatedAt}</dd>
            <dt className="text-aegis-text-dim">{t('maintenance.openClawStability.records')}</dt>
            <dd className="text-aegis-text">{t('maintenance.openClawStability.recordValue', { count: snapshot.count, capacity: snapshot.capacity })}</dd>
            <dt className="text-aegis-text-dim">{t('maintenance.openClawStability.dropped')}</dt>
            <dd className="text-aegis-text">{snapshot.dropped}</dd>
          </dl>

          <div className="mt-4 border-t border-aegis-border/45 pt-3">
            <h4 className="text-[12px] font-medium text-aegis-text">{t('maintenance.openClawStability.eventTypes')}</h4>
            {eventTypes.length === 0 ? (
              <p className="mt-2 text-[11px] text-aegis-text-dim">{t('maintenance.openClawStability.empty')}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {eventTypes.map(([type, count]) => (
                  <span key={type} className="rounded-md border border-aegis-border/55 bg-aegis-bg/45 px-2 py-1 font-mono text-[10px] text-aegis-text-muted">
                    {type} {count}
                  </span>
                ))}
              </div>
            )}
          </div>

          {snapshot.events.length > 0 && (
            <div className="mt-4 border-t border-aegis-border/45 pt-3">
              <h4 className="text-[12px] font-medium text-aegis-text">{t('maintenance.openClawStability.recentEvents')}</h4>
              <div className="mt-2 space-y-1.5">
                {snapshot.events.slice(-8).map((event) => (
                  <div key={event.seq} className="flex min-w-0 items-start gap-2 text-[11px] leading-5">
                    <time className="shrink-0 font-mono text-aegis-text-dim">{formatEventTime(event.ts, i18n.language)}</time>
                    <span className="min-w-0 break-words font-mono text-aegis-text-muted">{event.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
