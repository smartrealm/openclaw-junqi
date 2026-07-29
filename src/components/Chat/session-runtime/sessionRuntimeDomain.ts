import type { ModelEntry } from '@/services/gateway/modelLoaders';
import { canonicalProviderId } from '@/services/gateway/modelIdentity';

export const SESSION_THINKING_LEVELS = [
  'auto',
  'high',
  'medium',
  'low',
  'minimal',
  'off',
] as const;

export type SessionThinkingLevel = (typeof SESSION_THINKING_LEVELS)[number];

export interface SessionModelGroup {
  providerId: string;
  models: ModelEntry[];
}

export function modelProviderId(modelId: string): string {
  const separator = modelId.indexOf('/');
  return separator > 0 ? canonicalProviderId(modelId.slice(0, separator)) : 'other';
}

export function modelDisplayName(model: ModelEntry | undefined, modelId: string | null): string {
  if (model?.alias?.trim()) return model.alias.trim();
  if (model?.label?.trim()) return model.label.trim();
  if (!modelId) return '';
  const separator = modelId.indexOf('/');
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}

export function groupSessionModels(models: readonly ModelEntry[]): SessionModelGroup[] {
  const groups = new Map<string, ModelEntry[]>();
  for (const model of models) {
    const providerId = modelProviderId(model.id);
    const group = groups.get(providerId);
    if (group) group.push(model);
    else groups.set(providerId, [model]);
  }
  return [...groups].map(([providerId, providerModels]) => ({
    providerId,
    models: providerModels,
  }));
}

export function normalizeThinkingLevel(level: string | null): SessionThinkingLevel {
  return SESSION_THINKING_LEVELS.includes(level as SessionThinkingLevel)
    ? level as SessionThinkingLevel
    : 'auto';
}

export function thinkingLevelForGateway(level: SessionThinkingLevel): string | null {
  return level === 'auto' ? null : level;
}
