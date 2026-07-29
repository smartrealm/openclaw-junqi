import type { ModelEntry } from './types';

export function resolveExplicitProviderDefault(
  availableModelRefs: readonly string[],
  selectedModelRef: string,
): string | undefined {
  const selected = selectedModelRef.trim();
  return selected && availableModelRefs.includes(selected) ? selected : undefined;
}

/** Keeps an explicit config value visible when catalog metadata is unavailable. */
export function buildDefaultModelOptions(
  models: Readonly<Record<string, ModelEntry>>,
  current: string | undefined,
): Array<[string, ModelEntry | undefined]> {
  const options: Array<[string, ModelEntry | undefined]> = Object.entries(models);
  if (current && !models[current]) options.unshift([current, undefined]);
  return options;
}
