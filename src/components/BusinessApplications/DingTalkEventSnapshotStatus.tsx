import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/shared/button/Button';
import {
  DingTalkEventSnapshotContent,
  type DingTalkEventSnapshotPresentation,
} from './DingTalkEventSnapshotContent';

export function DingTalkEventSnapshotStatus({
  snapshot,
  loading,
  error,
  onReload,
}: {
  snapshot: DingTalkEventSnapshotPresentation | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-md border border-aegis-border bg-aegis-surface/35 p-3" aria-labelledby="dingtalk-event-snapshot-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="dingtalk-event-snapshot-title" className="text-[10.5px] font-medium text-aegis-text-secondary">
            {t('businessApplications.events.snapshot.title')}
          </h3>
          <p className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">
            {t('businessApplications.events.snapshot.description')}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          tone="neutral"
          leadingIcon={<RefreshCw size={12} />}
          loading={loading}
          disabled={loading}
          onClick={onReload}
        >
          {t('businessApplications.events.snapshot.reload')}
        </Button>
      </div>

      <DingTalkEventSnapshotContent snapshot={snapshot} loading={loading} error={error} />
    </section>
  );
}
