export type BusinessIntegrationId = 'dingtalk-workspace' | 'feishu' | 'google-workspace';

export type IntegrationRuntimeKind = 'cli' | 'native-api';
export type IntegrationIconName = 'building' | 'messages' | 'cloud';
export type IntegrationState = 'requires_runtime' | 'requires_configuration' | 'ready_for_authorization';
export type CapabilityEffect = 'read' | 'write' | 'high_impact';
export type CapabilityAvailability = 'requires_runtime' | 'requires_configuration' | 'requires_authorization';

export type TranslationKey = string;

export interface BusinessCapabilityDescriptor {
  id: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  effect: CapabilityEffect;
  availability: CapabilityAvailability;
}

export interface BusinessIntegrationDescriptor {
  id: BusinessIntegrationId;
  icon: IntegrationIconName;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  runtimeKind: IntegrationRuntimeKind;
  state: IntegrationState;
  prerequisitesKey: TranslationKey;
  capabilities: readonly BusinessCapabilityDescriptor[];
}

export interface BusinessChatRequest {
  integrationId: BusinessIntegrationId;
  capabilityId: string;
}
