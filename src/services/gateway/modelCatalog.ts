import type { ModelEntry } from './modelLoaders';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import {
  canonicalModelRef,
  canonicalProviderId,
  providerScopedModelId,
} from './modelIdentity';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function addModel(out: Map<string, ModelEntry>, entry: ModelEntry): void {
  const id = canonicalModelRef(entry.id);
  if (!id) return;
  const current = out.get(id);
  const alias = entry.alias?.trim() || undefined;
  out.set(id, {
    id,
    label: current?.label && current.label !== id
      ? current.label
      : entry.label.trim() || id,
    ...(current?.alias || alias ? { alias: current?.alias ?? alias } : {}),
    ...(typeof current?.supportsImage === 'boolean'
      ? { supportsImage: current.supportsImage }
      : typeof entry.supportsImage === 'boolean'
        ? { supportsImage: entry.supportsImage }
        : {}),
  });
}

/** Parses only explicit, available entries from the live `models.list` response. */
export function extractAvailableModelsFromGatewayResult(result: unknown): ModelEntry[] {
  if (!isRecord(result) || !Array.isArray(result.models)) return [];

  const out = new Map<string, ModelEntry>();
  for (const value of result.models) {
    if (!isRecord(value) || value.available !== true) continue;
    const rawId = nonEmptyString(value.id);
    if (!rawId) continue;
    const provider = nonEmptyString(value.provider);
    const id = provider
      ? providerScopedModelId(canonicalProviderId(provider), rawId)
      : canonicalModelRef(rawId);
    if (!id) continue;
    addModel(out, {
      id,
      label: nonEmptyString(value.name) ?? id,
      alias: nonEmptyString(value.alias),
      supportsImage: resolveModelSupportsImage(value),
    });
  }
  return [...out.values()];
}
