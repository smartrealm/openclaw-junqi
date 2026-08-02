import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { BusinessIntegrationDescriptor, BusinessIntegrationId } from '@/business-applications/types';
import { BusinessApplicationIcon } from './BusinessApplicationIcon';
import { IntegrationStatus } from './IntegrationStatus';

export function ApplicationCatalog({
  integrations,
  selectedId,
  onSelect,
}: {
  integrations: readonly BusinessIntegrationDescriptor[];
  selectedId: BusinessIntegrationId;
  onSelect: (id: BusinessIntegrationId) => void;
}) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="business-application-catalog-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="business-application-catalog-title" className="text-[12px] font-semibold text-aegis-text-secondary">
            {t('businessApplications.catalogTitle', '应用目录')}
          </h2>
          <p className="mt-1 text-[11px] text-aegis-text-dim">
            {t('businessApplications.catalogHint', '选择应用以查看它的身份、能力和操作前提。')}
          </p>
        </div>
        <span className="shrink-0 text-[10.5px] text-aegis-text-dim">
          {t('businessApplications.catalogState', '仅显示已注册适配器')}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="list">
        {integrations.map((integration) => {
          const selected = integration.id === selectedId;
          return (
            <button
              key={integration.id}
              type="button"
              role="listitem"
              aria-pressed={selected}
              onClick={() => onSelect(integration.id)}
              className={clsx(
                'grid min-h-[84px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
                selected
                  ? 'border-aegis-primary/45 bg-aegis-primary/[0.07]'
                  : 'border-aegis-border bg-aegis-surface/35 hover:border-aegis-primary/30 hover:bg-aegis-hover/35',
              )}
            >
              <span className={clsx(
                'mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border',
                selected
                  ? 'border-aegis-primary/30 bg-aegis-primary/10 text-aegis-primary'
                  : 'border-aegis-border bg-aegis-overlay/[0.04] text-aegis-text-dim',
              )}>
                <BusinessApplicationIcon icon={integration.icon} size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold text-aegis-text">{t(integration.nameKey)}</span>
                <span className="mt-1 block truncate text-[10.5px] text-aegis-text-dim">{t(integration.descriptionKey)}</span>
                <span className="mt-2 block"><IntegrationStatus state={integration.state} /></span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
