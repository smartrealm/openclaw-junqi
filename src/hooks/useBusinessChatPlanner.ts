import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { stageBusinessChatRequest } from '@/business-applications/businessChatBridge';
import type { BusinessCapabilityDescriptor, BusinessIntegrationDescriptor } from '@/business-applications/types';

export function useBusinessChatPlanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (integration: BusinessIntegrationDescriptor, capability: BusinessCapabilityDescriptor) => {
    const prompt = t('businessApplications.chatPrompt', {
      integration: t(integration.nameKey),
      capability: t(capability.titleKey),
    });
    stageBusinessChatRequest({ integrationId: integration.id, capabilityId: capability.id }, prompt);
    navigate('/chat');
  };
}
