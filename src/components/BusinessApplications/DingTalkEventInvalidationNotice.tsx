import { useTranslation } from 'react-i18next';

export function DingTalkEventInvalidationNotice({
  invalidation,
}: {
  invalidation: {
    readonly revision: number;
    readonly eventType: string;
  } | null;
}) {
  const { t } = useTranslation();
  if (!invalidation) return null;
  return (
    <div className="rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.05] px-2.5 py-2" role="status">
      <div className="text-[11px] font-medium text-aegis-text-secondary">{t('businessApplications.events.latestSignal')}</div>
      <p className="mt-0.5 break-words text-[10.5px] leading-4 text-aegis-text-dim">
        {t('businessApplications.events.latestSignalDescription', {
          revision: invalidation.revision,
          eventType: invalidation.eventType,
        })}
      </p>
    </div>
  );
}
