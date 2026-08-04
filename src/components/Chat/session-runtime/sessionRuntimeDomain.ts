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

export const SESSION_FAST_MODES = ['inherit', 'auto', 'on', 'off'] as const;

export type SessionFastMode = (typeof SESSION_FAST_MODES)[number];

export const SESSION_VERBOSE_LEVELS = ['inherit', 'on', 'full', 'off'] as const;

export type SessionVerboseLevel = (typeof SESSION_VERBOSE_LEVELS)[number];

export const SESSION_REASONING_LEVELS = ['inherit', 'on', 'off', 'stream'] as const;

export type SessionReasoningLevel = (typeof SESSION_REASONING_LEVELS)[number];

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

export function normalizeFastMode(value: unknown): SessionFastMode {
  if (value === 'auto') return 'auto';
  if (value === true) return 'on';
  if (value === false) return 'off';
  return 'inherit';
}

export function fastModeForGateway(mode: SessionFastMode): boolean | 'auto' | null {
  if (mode === 'auto') return 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return null;
}

export function normalizeVerboseLevel(value: unknown): SessionVerboseLevel {
  return value === 'on' || value === 'full' || value === 'off' ? value : 'inherit';
}

export function verboseLevelForGateway(mode: SessionVerboseLevel): 'on' | 'full' | 'off' | null {
  return mode === 'inherit' ? null : mode;
}

export function normalizeReasoningLevel(value: unknown): SessionReasoningLevel {
  return value === 'on' || value === 'off' || value === 'stream' ? value : 'inherit';
}

export function reasoningLevelForGateway(mode: SessionReasoningLevel): 'on' | 'off' | 'stream' | null {
  return mode === 'inherit' ? null : mode;
}
