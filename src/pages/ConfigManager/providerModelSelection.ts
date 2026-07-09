export function buildProviderSubmissionModelIds(params: {
  isCustomLike: boolean;
  selectedModels: string[];
  customModelIds: string[];
  extraModelIds: string[];
}): string[] {
  const normalize = (ids: string[]) => ids
    .map((id) => id.trim())
    .filter(Boolean);
  const normalizedSelected = normalize(params.selectedModels);
  const normalizedCustom = normalize(params.customModelIds);
  const normalizedExtra = normalize(params.extraModelIds);

  if (params.isCustomLike) {
    return Array.from(new Set([
      ...normalizedSelected,
      ...normalizedCustom,
    ]));
  }

  return Array.from(new Set([
    ...normalizedSelected,
    ...normalizedExtra,
  ]));
}
