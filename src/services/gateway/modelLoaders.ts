import { debugLog } from '@/utils/debugLog';

export interface ModelEntry {
  id: string;
  label: string;
  alias?: string;
  supportsImage?: boolean;
}

export type GatewayModelListRequest = (
  method: 'models.list',
  params: { view: 'configured' },
) => Promise<unknown>;

export type GatewayChatMetadataRequest = (
  method: 'chat.metadata',
  params: { agentId: string },
) => Promise<unknown>;

function isModelsListResponse(value: unknown): value is { models: unknown[] } {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray((value as Record<string, unknown>).models);
}

/**
 * Loads the one model catalog that OpenClaw authorizes for a normal picker.
 * A local config, an agent record, or a static provider list cannot prove that
 * a model is currently allowed and authenticated by the connected Gateway.
 */
export async function loadConfiguredGatewayModels(
  request: GatewayModelListRequest,
  extract: (response: { models: unknown[] }) => ModelEntry[],
): Promise<ModelEntry[]> {
  try {
    const response = await request('models.list', { view: 'configured' });
    if (!isModelsListResponse(response)) return [];
    const models = extract(response);
    debugLog('models', '[Models] Loaded configured Gateway catalog:', models.length);
    return models;
  } catch {
    return [];
  }
}

/**
 * `models.list` 始终解析默认智能体；会话选择器必须改用官方 `chat.metadata`
 * 读取目标智能体的认证与模型目录投影。
 */
export async function loadAgentScopedGatewayModels(
  agentId: string,
  request: GatewayChatMetadataRequest,
  extract: (response: { models: unknown[] }) => ModelEntry[],
): Promise<ModelEntry[]> {
  const targetAgentId = agentId.trim();
  if (!targetAgentId) return [];
  try {
    const response = await request('chat.metadata', { agentId: targetAgentId });
    if (!isModelsListResponse(response)) return [];
    const models = extract(response);
    debugLog('models', '[Models] Loaded agent-scoped Gateway catalog:', targetAgentId, models.length);
    return models;
  } catch {
    return [];
  }
}
