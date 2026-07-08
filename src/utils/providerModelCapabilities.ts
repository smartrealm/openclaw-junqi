export function resolveModelSupportsImage(value: any): boolean | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.supportsImage === 'boolean') return value.supportsImage;
  if (typeof value.supports_image === 'boolean') return value.supports_image;

  const inputModalities =
    Array.isArray(value.input)
      ? value.input
      : Array.isArray(value.modalities?.input)
        ? value.modalities.input
        : Array.isArray(value.architecture?.input_modalities)
          ? value.architecture.input_modalities
          : undefined;

  if (!inputModalities) return undefined;
  const modalities = inputModalities.map((item: any) => String(item).toLowerCase());
  if (modalities.includes('image')) return true;
  if (modalities.includes('text')) return false;
  return undefined;
}
