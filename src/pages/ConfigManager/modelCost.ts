import type { ModelProviderModelEntry } from './types';

export const MODEL_COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

export type ModelCostField = typeof MODEL_COST_FIELDS[number];
export type ModelCost = NonNullable<ModelProviderModelEntry['cost']>;
export type ModelCostDraft = Record<ModelCostField, string>;

export function createModelCostDraft(cost: ModelProviderModelEntry['cost']): ModelCostDraft {
  return Object.fromEntries(MODEL_COST_FIELDS.map((field) => [
    field,
    typeof cost?.[field] === 'number' ? String(cost[field]) : '',
  ])) as ModelCostDraft;
}

export function parseModelCostDraft(
  draft: ModelCostDraft,
  currentCost?: ModelProviderModelEntry['cost'],
): { ok: true; cost: ModelProviderModelEntry['cost'] } | { ok: false; field: ModelCostField } {
  const flatCost: Partial<Record<ModelCostField, number>> = {};
  for (const field of MODEL_COST_FIELDS) {
    const raw = draft[field].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { ok: false, field };
    flatCost[field] = value;
  }

  const tieredPricing = currentCost?.tieredPricing;
  if (Object.keys(flatCost).length > 0 && Object.keys(flatCost).length !== MODEL_COST_FIELDS.length) {
    const missingField = MODEL_COST_FIELDS.find((field) => flatCost[field] === undefined);
    return { ok: false, field: missingField ?? 'input' };
  }
  if (Object.keys(flatCost).length === 0 && !tieredPricing?.length) {
    return { ok: true, cost: undefined };
  }
  return {
    ok: true,
    cost: {
      ...flatCost,
      ...(tieredPricing?.length ? { tieredPricing } : {}),
    },
  };
}
