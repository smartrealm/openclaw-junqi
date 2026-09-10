import {
  eventKeysForCategory,
  normalizeDingTalkEventConfiguration,
  type DingTalkEventCategory,
  type DingTalkEventConfiguration,
  type DingTalkEventSubscription,
} from '@/business-applications/dingtalkEventConfiguration';

export function createDingTalkEventSubscription(
  category: DingTalkEventCategory,
): DingTalkEventSubscription {
  const firstKey = eventKeysForCategory(category)[0];
  if (!firstKey) throw new Error('当前事件类别没有可用事件。');
  if (category === 'im-user') return { category, eventKeys: [firstKey], user: '' };
  if (category === 'im-group') return { category, eventKeys: [firstKey], group: '' };
  return { category, eventKeys: [firstKey] };
}

export function isDingTalkEventConfigurationValid(
  configuration: DingTalkEventConfiguration,
): boolean {
  try {
    normalizeDingTalkEventConfiguration(configuration);
    return true;
  } catch {
    return false;
  }
}

export function canSaveDingTalkEventConfiguration(
  configuration: DingTalkEventConfiguration,
  dirty: boolean,
): boolean {
  return dirty && isDingTalkEventConfigurationValid(configuration);
}
