import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUSINESS_INTEGRATION_CATALOG, findBusinessIntegration } from '@/business-applications/catalog';
import type { BusinessIntegrationId } from '@/business-applications/types';
import { ApplicationDetail, type BusinessApplicationsView } from '@/components/BusinessApplications/ApplicationDetail';
import { ApplicationJournal } from '@/components/BusinessApplications/ApplicationJournal';
import { ApplicationCatalog } from '@/components/BusinessApplications/ApplicationCatalog';
import { useBusinessChatPlanner } from '@/hooks/useBusinessChatPlanner';
import { PageTransition } from '@/components/shared/PageTransition';

export function BusinessApplicationsPage() {
  const { t } = useTranslation();
  const planWithAi = useBusinessChatPlanner();
  const [selectedId, setSelectedId] = useState<BusinessIntegrationId>('dingtalk-workspace');
  const [activeView, setActiveView] = useState<BusinessApplicationsView>('overview');
  const integration = findBusinessIntegration(selectedId);

  const selectIntegration = (id: BusinessIntegrationId) => {
    setSelectedId(id);
    setActiveView('overview');
  };

  return (
    <PageTransition className="h-full min-h-[520px] min-w-0 overflow-y-auto bg-aegis-bg">
      <div className="mx-auto max-w-[1440px] px-5 py-5 lg:px-7">
        <div>
          <h1 className="text-[18px] font-semibold text-aegis-text">{t('businessApplications.title', '业务应用')}</h1>
          <p className="mt-1 text-[12px] text-aegis-text-dim">{t('businessApplications.subtitle', '统一管理企业业务平台的能力、确认与追溯。')}</p>
        </div>
        <div className="mt-6 border-y border-aegis-border py-4">
          <ApplicationCatalog integrations={BUSINESS_INTEGRATION_CATALOG} selectedId={selectedId} onSelect={selectIntegration} />
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <ApplicationDetail integration={integration} activeView={activeView} onViewChange={setActiveView} onPlan={(capability) => planWithAi(integration, capability)} />
          <ApplicationJournal />
        </div>
      </div>
    </PageTransition>
  );
}
