import { useTranslation } from 'react-i18next';

export interface BusinessActivityEvidenceItem {
  readonly label: string;
  readonly value: string | null | undefined;
}

export function BusinessActivityEvidence({
  items,
}: {
  items: readonly BusinessActivityEvidenceItem[];
}) {
  const { t } = useTranslation();
  const visibleItems = items.filter((item): item is BusinessActivityEvidenceItem & { value: string } => (
    typeof item.value === 'string' && item.value.length > 0
  ));
  if (visibleItems.length === 0) return null;

  return (
    <details className="mt-2 rounded-md border border-aegis-border/70 bg-aegis-bg/45 px-2.5 py-1.5 text-[10px]">
      <summary className="cursor-pointer select-none font-medium text-aegis-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35">
        {t('businessApplications.activity.technicalDetails')}
      </summary>
      <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-t border-aegis-border/70 pt-2">
        {visibleItems.map((item) => (
          <div key={`${item.label}:${item.value}`} className="contents">
            <dt className="text-aegis-text-dim">{item.label}</dt>
            <dd className="truncate font-mono text-aegis-text-secondary" title={item.value}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
