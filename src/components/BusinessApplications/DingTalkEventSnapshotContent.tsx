import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DingTalkEventSnapshotPresentation {
  readonly phase: 'disabled' | 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
  readonly activeConsumerCount: number;
  readonly readyConsumerCount: number;
  readonly latestSequence: number;
  readonly droppedCount: number;
  readonly rejectedCount: number;
  readonly lastErrorCode: string | null;
  readonly events: readonly {
    readonly sequence: number;
    readonly receivedAt: string;
    readonly eventType: string;
  }[];
}

export function DingTalkEventSnapshotContent({
  snapshot,
  loading,
  error,
}: {
  snapshot: DingTalkEventSnapshotPresentation | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.05] px-2.5 py-2 text-[10px] text-aegis-danger" role="alert">
          <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!snapshot && !error && (
        <p className="mt-2 text-[9.5px] text-aegis-text-dim" role="status">
          {loading
            ? t('businessApplications.events.snapshot.loading')
            : t('businessApplications.events.snapshot.notRead')}
        </p>
      )}

      {snapshot && (
        <div className="mt-2 space-y-2">
          <dl className="grid gap-1.5 text-[9.5px] sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-aegis-border/70 bg-aegis-bg/60 px-2 py-1.5">
              <dt className="text-aegis-text-dim">{t('businessApplications.events.snapshot.phase')}</dt>
              <dd className="mt-0.5 font-medium text-aegis-text-secondary">{t(`businessApplications.events.snapshot.phases.${snapshot.phase}`)}</dd>
            </div>
            <div className="rounded border border-aegis-border/70 bg-aegis-bg/60 px-2 py-1.5">
              <dt className="text-aegis-text-dim">{t('businessApplications.events.snapshot.consumers')}</dt>
              <dd className="mt-0.5 font-mono text-aegis-text-secondary">{snapshot.readyConsumerCount} / {snapshot.activeConsumerCount}</dd>
            </div>
            <div className="rounded border border-aegis-border/70 bg-aegis-bg/60 px-2 py-1.5">
              <dt className="text-aegis-text-dim">{t('businessApplications.events.snapshot.latestSequence')}</dt>
              <dd className="mt-0.5 font-mono text-aegis-text-secondary">{snapshot.latestSequence}</dd>
            </div>
            <div className="rounded border border-aegis-border/70 bg-aegis-bg/60 px-2 py-1.5">
              <dt className="text-aegis-text-dim">{t('businessApplications.events.snapshot.loss')}</dt>
              <dd className="mt-0.5 font-mono text-aegis-text-secondary">{snapshot.droppedCount} / {snapshot.rejectedCount}</dd>
            </div>
          </dl>

          {snapshot.lastErrorCode && (
            <p className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.05] px-2.5 py-2 font-mono text-[9.5px] text-aegis-warning" role="status">
              {t('businessApplications.events.snapshot.lastError', { code: snapshot.lastErrorCode })}
            </p>
          )}

          <div>
            <div className="text-[9.5px] font-medium text-aegis-text-secondary">{t('businessApplications.events.snapshot.records')}</div>
            {snapshot.events.length === 0 ? (
              <p className="mt-1 text-[9.5px] text-aegis-text-dim">{t('businessApplications.events.snapshot.empty')}</p>
            ) : (
              <ol className="mt-1 space-y-1" aria-label={t('businessApplications.events.snapshot.records')}>
                {snapshot.events.map((event) => (
                  <li key={event.sequence} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-aegis-border/70 bg-aegis-bg/60 px-2 py-1.5 text-[9.5px]">
                    <span className="font-mono text-aegis-text-secondary">#{event.sequence}</span>
                    <span className="break-all text-aegis-text-secondary">{event.eventType}</span>
                    <time dateTime={event.receivedAt} className="ml-auto font-mono text-aegis-text-dim">{event.receivedAt}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
