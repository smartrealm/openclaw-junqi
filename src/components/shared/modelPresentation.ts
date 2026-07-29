import type { ModelEntry } from '@/services/gateway/modelLoaders';

/** Generic short label when the runtime catalog has no presentation metadata. */
export function formatModelRef(modelRef: string | null | undefined): string {
  const normalized = String(modelRef ?? '').trim();
  if (!normalized) return '—';
  const separator = normalized.indexOf('/');
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

export function modelCatalogLabel(
  model: ModelEntry | undefined,
  modelRef: string | null | undefined,
): string {
  return model?.alias?.trim()
    || model?.label?.trim()
    || formatModelRef(modelRef);
}
