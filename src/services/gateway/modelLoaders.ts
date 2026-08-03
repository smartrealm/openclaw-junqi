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
