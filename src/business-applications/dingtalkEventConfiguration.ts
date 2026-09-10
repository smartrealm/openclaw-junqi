import type { OpenClawConfigSnapshot } from '@/services/gateway/OpenClawConfigSnapshot';

export const DINGTALK_EVENT_KEYS = [
  'user_im_message_receive_at',
  'user_im_message_receive_o2o',
  'user_im_message_receive_group',
  'user_im_message_receive_user',
  'user_im_message_receive_o2o_all',
  'user_im_message_receive_group_all',
  'user_im_message_read_o2o',
  'user_im_message_read_group',
  'user_im_message_recall_o2o',
  'user_im_message_recall_group',
  'user_im_message_reaction_o2o',
  'user_im_message_reaction_group',
  'user_im_group_updated',
  'user_im_group_member_added',
  'user_im_group_member_exited',
  'user_im_group_disbanded',
  'user_oa_approval_task_created',
  'user_oa_approval_task_finished',
  'user_oa_approval_task_redirected',
  'user_oa_approval_instance_started',
  'user_oa_approval_instance_cc',
  'user_oa_approval_instance_terminated',
  'user_oa_approval_instance_finished',
  'user_voip_call_receive_invite',
  'user_todo_task_create',
  'user_todo_task_update',
  'user_todo_task_delete',
] as const;

export type DingTalkEventKey = typeof DINGTALK_EVENT_KEYS[number];
export type DingTalkEventCategory = 'im-none' | 'im-user' | 'im-group' | 'oa' | 'voip' | 'todo';
export type DingTalkTodoRole = 'creator' | 'executor' | 'participant';

export const DINGTALK_EVENT_CATEGORIES = [
  'im-none',
  'im-user',
  'im-group',
  'oa',
  'voip',
  'todo',
] as const satisfies readonly DingTalkEventCategory[];

export const DINGTALK_TODO_ROLES = [
  'creator',
  'executor',
  'participant',
] as const satisfies readonly DingTalkTodoRole[];

const EVENT_KEYS_BY_CATEGORY = {
  'im-none': [
    'user_im_message_receive_at',
    'user_im_message_receive_o2o_all',
    'user_im_message_receive_group_all',
  ],
  'im-user': [
    'user_im_message_receive_o2o',
    'user_im_message_receive_user',
    'user_im_message_read_o2o',
    'user_im_message_recall_o2o',
    'user_im_message_reaction_o2o',
  ],
  'im-group': [
    'user_im_message_receive_group',
    'user_im_message_read_group',
    'user_im_message_recall_group',
    'user_im_message_reaction_group',
    'user_im_group_updated',
    'user_im_group_member_added',
    'user_im_group_member_exited',
    'user_im_group_disbanded',
  ],
  oa: [
    'user_oa_approval_task_created',
    'user_oa_approval_task_finished',
    'user_oa_approval_task_redirected',
    'user_oa_approval_instance_started',
    'user_oa_approval_instance_cc',
    'user_oa_approval_instance_terminated',
    'user_oa_approval_instance_finished',
  ],
  voip: ['user_voip_call_receive_invite'],
  todo: [
    'user_todo_task_create',
    'user_todo_task_update',
    'user_todo_task_delete',
  ],
} as const satisfies Readonly<Record<DingTalkEventCategory, readonly DingTalkEventKey[]>>;

const EVENT_KEY_SET = new Set<string>(DINGTALK_EVENT_KEYS);
const CATEGORY_SET = new Set<string>(DINGTALK_EVENT_CATEGORIES);
const TODO_ROLE_SET = new Set<string>(DINGTALK_TODO_ROLES);
const EVENT_SUBSCRIPTIONS_PATH = 'plugins.entries.junqi-dingtalk.config.eventSubscriptions';
const PROFILE_PATTERN = /^[^:\s]+:[^:\s]+$/;

export interface DingTalkEventSubscription {
  readonly category: DingTalkEventCategory;
  readonly eventKeys: readonly DingTalkEventKey[];
  readonly user?: string;
  readonly openDingTalkId?: string;
  readonly group?: string;
  readonly roleTypes?: readonly DingTalkTodoRole[];
}

export interface DingTalkEventConfiguration {
  readonly enabled: boolean;
  readonly profile: string;
  readonly bufferSize: number;
  readonly subscriptions: readonly DingTalkEventSubscription[];
}

interface DingTalkEventConfigurationClient {
  read(): Promise<OpenClawConfigSnapshot>;
  patch(
    config: Record<string, unknown>,
    snapshot: OpenClawConfigSnapshot,
    replacePaths?: string[],
  ): Promise<void>;
}

export interface DingTalkEventConfigurationSaveResult {
  readonly changed: boolean;
  readonly configuration: DingTalkEventConfiguration;
}

export interface DingTalkEventConfigurationApplyResult extends DingTalkEventConfigurationSaveResult {
  readonly restarted: boolean;
}

export class DingTalkEventConfigurationAppliedError extends Error {
  readonly configuration: DingTalkEventConfiguration;
  readonly reason: 'runtime_changed' | 'apply_failed';

  constructor(
    configuration: DingTalkEventConfiguration,
    reason: 'runtime_changed' | 'apply_failed',
    cause?: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DingTalkEventConfigurationAppliedError';
    this.configuration = configuration;
    this.reason = reason;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表。`);
  return value.map((item) => {
    const normalized = nonEmptyString(item);
    if (!normalized) throw new Error(`${label}只能包含非空字符串。`);
    return normalized;
  });
}

export function eventKeysForCategory(
  category: DingTalkEventCategory,
): readonly DingTalkEventKey[] {
  return EVENT_KEYS_BY_CATEGORY[category];
}

function categoryForEventKey(key: DingTalkEventKey): DingTalkEventCategory {
  const category = DINGTALK_EVENT_CATEGORIES.find((candidate) => (
    EVENT_KEYS_BY_CATEGORY[candidate].some((eventKey) => eventKey === key)
  ));
  if (!category) throw new Error('事件类型未被当前钉钉插件支持。');
  return category;
}

function normalizeSubscription(value: unknown): DingTalkEventSubscription {
  const source = record(value);
  if (!source) throw new Error('事件组必须是对象。');
  const supportedFields = new Set([
    'category',
    'eventKeys',
    'user',
    'openDingTalkId',
    'group',
    'roleTypes',
  ]);
  if (Object.keys(source).some((key) => !supportedFields.has(key))) {
    throw new Error('事件组包含当前钉钉插件不支持的字段。');
  }
  const rawKeys = stringArray(source.eventKeys, '事件类型');
  if (rawKeys.length === 0) throw new Error('每个事件组至少选择一个事件类型。');
  if (new Set(rawKeys).size !== rawKeys.length || rawKeys.some((key) => !EVENT_KEY_SET.has(key))) {
    throw new Error('事件组包含重复或未支持的事件类型。');
  }
  const eventKeys = rawKeys as DingTalkEventKey[];
  const derivedCategories = new Set(eventKeys.map(categoryForEventKey));
  if (derivedCategories.size !== 1) throw new Error('同一事件组不能混合不同目标类别。');
  const derivedCategory = derivedCategories.values().next().value as DingTalkEventCategory;
  const configuredCategory = nonEmptyString(source.category);
  if (configuredCategory && (!CATEGORY_SET.has(configuredCategory) || configuredCategory !== derivedCategory)) {
    throw new Error('事件组类别与所选事件类型不一致。');
  }

  const user = nonEmptyString(source.user);
  const openDingTalkId = nonEmptyString(source.openDingTalkId);
  const group = nonEmptyString(source.group);
  const roleTypes = source.roleTypes === undefined ? [] : stringArray(source.roleTypes, '待办角色');
  if (new Set(roleTypes).size !== roleTypes.length || roleTypes.some((role) => !TODO_ROLE_SET.has(role))) {
    throw new Error('待办角色包含重复或未支持的值。');
  }

  if (derivedCategory === 'im-user') {
    if (Boolean(user) === Boolean(openDingTalkId) || group || roleTypes.length > 0) {
      throw new Error('指定成员消息事件必须且只能填写一种成员身份。');
    }
  } else if (derivedCategory === 'im-group') {
    if (!group || user || openDingTalkId || roleTypes.length > 0) {
      throw new Error('指定群消息事件必须填写群 ID，且不能填写其他目标。');
    }
  } else if (derivedCategory === 'todo') {
    if (user || openDingTalkId || group) throw new Error('待办事件不能填写消息目标。');
  } else if (user || openDingTalkId || group || roleTypes.length > 0) {
    throw new Error('当前事件类别不接受目标或待办角色。');
  }

  return {
    category: derivedCategory,
    eventKeys,
    ...(user ? { user } : {}),
    ...(openDingTalkId ? { openDingTalkId } : {}),
    ...(group ? { group } : {}),
    ...(roleTypes.length > 0 ? { roleTypes: roleTypes as DingTalkTodoRole[] } : {}),
  };
}

export function normalizeDingTalkEventConfiguration(
  value: DingTalkEventConfiguration,
): DingTalkEventConfiguration {
  if (typeof value.enabled !== 'boolean') throw new Error('事件运行状态无效。');
  const profile = value.profile.trim();
  if (profile && !PROFILE_PATTERN.test(profile)) {
    throw new Error('事件 Profile 必须使用精确的 <corpId>:<userId> 格式。');
  }
  if (!Number.isInteger(value.bufferSize) || value.bufferSize < 1 || value.bufferSize > 200) {
    throw new Error('事件内存上限必须是 1 到 200 之间的整数。');
  }
  if (!value.enabled) {
    return { enabled: false, profile, bufferSize: value.bufferSize, subscriptions: [] };
  }
  if (!profile) throw new Error('启用实时事件前必须选择一个已登录 DWS Profile。');
  if (!Array.isArray(value.subscriptions) || value.subscriptions.length === 0) {
    throw new Error('启用实时事件前至少配置一个事件组。');
  }
  if (value.subscriptions.length > 8) throw new Error('实时事件最多配置 8 个事件组。');
  const subscriptions = value.subscriptions.map(normalizeSubscription);
  const fingerprints = subscriptions.map(persistedSubscription).map((item) => JSON.stringify(item));
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error('事件组不能重复。');
  return { enabled: true, profile, bufferSize: value.bufferSize, subscriptions };
}

function persistedSubscription(
  subscription: DingTalkEventSubscription,
): Record<string, unknown> {
  return {
    eventKeys: [...subscription.eventKeys],
    ...(subscription.user ? { user: subscription.user } : {}),
    ...(subscription.openDingTalkId ? { openDingTalkId: subscription.openDingTalkId } : {}),
    ...(subscription.group ? { group: subscription.group } : {}),
    ...(subscription.roleTypes?.length ? { roleTypes: [...subscription.roleTypes] } : {}),
  };
}

function pluginConfiguration(snapshot: OpenClawConfigSnapshot): Record<string, unknown> {
  const root = snapshot.config as unknown as Record<string, unknown>;
  const entries = record(record(root.plugins)?.entries);
  const plugin = record(entries?.['junqi-dingtalk']);
  return record(plugin?.config) ?? {};
}

export function readDingTalkEventConfiguration(
  snapshot: OpenClawConfigSnapshot,
): DingTalkEventConfiguration {
  const source = pluginConfiguration(snapshot);
  const profile = source.eventProfile === undefined ? '' : nonEmptyString(source.eventProfile);
  if (source.eventProfile !== undefined && !profile) throw new Error('已保存的事件 Profile 无效。');
  const subscriptions = source.eventSubscriptions === undefined
    ? []
    : Array.isArray(source.eventSubscriptions)
      ? source.eventSubscriptions.map(normalizeSubscription)
      : (() => { throw new Error('已保存的事件组不是列表。'); })();
  const bufferSize = source.eventBufferSize === undefined ? 100 : source.eventBufferSize;
  if (!Number.isInteger(bufferSize) || Number(bufferSize) < 1 || Number(bufferSize) > 200) {
    throw new Error('已保存的事件内存上限无效。');
  }
  return normalizeDingTalkEventConfiguration({
    enabled: subscriptions.length > 0,
    profile: profile ?? '',
    bufferSize: Number(bufferSize),
    subscriptions,
  });
}

function configurationsEqual(
  left: DingTalkEventConfiguration,
  right: DingTalkEventConfiguration,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function loadDingTalkEventConfiguration(
  client: DingTalkEventConfigurationClient,
): Promise<DingTalkEventConfiguration> {
  return readDingTalkEventConfiguration(await client.read());
}

export async function saveDingTalkEventConfiguration(
  client: DingTalkEventConfigurationClient,
  value: DingTalkEventConfiguration,
): Promise<DingTalkEventConfigurationSaveResult> {
  const desired = normalizeDingTalkEventConfiguration(value);
  const snapshot = await client.read();
  const current = readDingTalkEventConfiguration(snapshot);
  if (configurationsEqual(current, desired)) {
    return { changed: false, configuration: current };
  }

  await client.patch({
    plugins: {
      entries: {
        'junqi-dingtalk': {
          config: {
            eventProfile: desired.profile || null,
            eventSubscriptions: desired.subscriptions.map(persistedSubscription),
            eventBufferSize: desired.bufferSize,
          },
        },
      },
    },
  }, snapshot, [EVENT_SUBSCRIPTIONS_PATH]);

  const confirmed = readDingTalkEventConfiguration(await client.read());
  if (!configurationsEqual(confirmed, desired)) {
    throw new Error('OpenClaw 未确认钉钉事件配置已按请求写入。');
  }
  return { changed: true, configuration: confirmed };
}

export async function applyDingTalkEventConfiguration({
  client,
  value,
  expectedConnectionId,
  expectedTargetFingerprint,
  currentIdentity,
  restart,
}: {
  client: DingTalkEventConfigurationClient;
  value: DingTalkEventConfiguration;
  expectedConnectionId: string;
  expectedTargetFingerprint: string;
  currentIdentity: () => { connectionId: string; targetFingerprint: string } | null;
  restart: () => Promise<void>;
}): Promise<DingTalkEventConfigurationApplyResult> {
  const saved = await saveDingTalkEventConfiguration(client, value);
  if (!saved.changed) return { ...saved, restarted: false };

  const identityBeforeRestart = currentIdentity();
  if (
    identityBeforeRestart?.connectionId !== expectedConnectionId
    || identityBeforeRestart.targetFingerprint !== expectedTargetFingerprint
  ) {
    throw new DingTalkEventConfigurationAppliedError(saved.configuration, 'runtime_changed');
  }
  try {
    await restart();
    if (currentIdentity()?.targetFingerprint !== expectedTargetFingerprint) {
      throw new DingTalkEventConfigurationAppliedError(saved.configuration, 'runtime_changed');
    }
    const confirmed = await loadDingTalkEventConfiguration(client);
    return { changed: true, restarted: true, configuration: confirmed };
  } catch (error) {
    if (error instanceof DingTalkEventConfigurationAppliedError) throw error;
    throw new DingTalkEventConfigurationAppliedError(saved.configuration, 'apply_failed', error);
  }
}
