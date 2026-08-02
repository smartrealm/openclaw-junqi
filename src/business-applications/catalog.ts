import type { BusinessIntegrationDescriptor } from './types';

export const BUSINESS_INTEGRATION_CATALOG: readonly BusinessIntegrationDescriptor[] = [
  {
    id: 'dingtalk-workspace',
    icon: 'building',
    nameKey: 'businessApplications.integrations.dingtalk.name',
    descriptionKey: 'businessApplications.integrations.dingtalk.description',
    runtimeKind: 'cli',
    state: 'requires_runtime',
    prerequisitesKey: 'businessApplications.integrations.dingtalk.prerequisites',
    capabilities: [
      {
        id: 'approvals',
        titleKey: 'businessApplications.capabilities.approvals.title',
        descriptionKey: 'businessApplications.capabilities.approvals.description',
        effect: 'high_impact',
        availability: 'requires_runtime',
      },
      {
        id: 'attendance',
        titleKey: 'businessApplications.capabilities.attendance.title',
        descriptionKey: 'businessApplications.capabilities.attendance.description',
        effect: 'read',
        availability: 'requires_runtime',
      },
      {
        id: 'calendar',
        titleKey: 'businessApplications.capabilities.calendar.title',
        descriptionKey: 'businessApplications.capabilities.calendar.description',
        effect: 'read',
        availability: 'requires_runtime',
      },
    ],
  },
  {
    id: 'feishu',
    icon: 'messages',
    nameKey: 'businessApplications.integrations.feishu.name',
    descriptionKey: 'businessApplications.integrations.feishu.description',
    runtimeKind: 'native-api',
    state: 'requires_configuration',
    prerequisitesKey: 'businessApplications.integrations.feishu.prerequisites',
    capabilities: [
      {
        id: 'approvals',
        titleKey: 'businessApplications.capabilities.approvals.title',
        descriptionKey: 'businessApplications.capabilities.approvals.description',
        effect: 'high_impact',
        availability: 'requires_configuration',
      },
      {
        id: 'documents',
        titleKey: 'businessApplications.capabilities.documents.title',
        descriptionKey: 'businessApplications.capabilities.documents.description',
        effect: 'read',
        availability: 'requires_configuration',
      },
      {
        id: 'calendar',
        titleKey: 'businessApplications.capabilities.calendar.title',
        descriptionKey: 'businessApplications.capabilities.calendar.description',
        effect: 'write',
        availability: 'requires_configuration',
      },
    ],
  },
  {
    id: 'google-workspace',
    icon: 'cloud',
    nameKey: 'businessApplications.integrations.google.name',
    descriptionKey: 'businessApplications.integrations.google.description',
    runtimeKind: 'native-api',
    state: 'ready_for_authorization',
    prerequisitesKey: 'businessApplications.integrations.google.prerequisites',
    capabilities: [
      {
        id: 'calendar',
        titleKey: 'businessApplications.capabilities.calendar.title',
        descriptionKey: 'businessApplications.capabilities.calendar.description',
        effect: 'write',
        availability: 'requires_authorization',
      },
      {
        id: 'documents',
        titleKey: 'businessApplications.capabilities.documents.title',
        descriptionKey: 'businessApplications.capabilities.documents.description',
        effect: 'read',
        availability: 'requires_authorization',
      },
      {
        id: 'mail',
        titleKey: 'businessApplications.capabilities.mail.title',
        descriptionKey: 'businessApplications.capabilities.mail.description',
        effect: 'high_impact',
        availability: 'requires_authorization',
      },
    ],
  },
];

export function findBusinessIntegration(id: string | null): BusinessIntegrationDescriptor {
  return BUSINESS_INTEGRATION_CATALOG.find((integration) => integration.id === id)
    ?? BUSINESS_INTEGRATION_CATALOG[0]!;
}
