const PROVIDER_ALIASES: Record<string, string> = {
  modelstudio: 'qwen',
  qwencloud: 'qwen',
  'qwen-dashscope': 'qwen',
  'z.ai': 'zai',
  'z-ai': 'zai',
  kimi: 'kimi-coding',
  'kimi-code': 'kimi-coding',
  'kimi-coding': 'kimi-coding',
};

export function canonicalProviderId(providerId: string | undefined): string {
  const normalized = String(providerId ?? '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

export function canonicalModelRef(modelRef: string | undefined): string | undefined {
  const trimmed = String(modelRef ?? '').trim();
  if (!trimmed) return undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const provider = canonicalProviderId(trimmed.slice(0, slashIndex));
  const model = trimmed.slice(slashIndex + 1).trim();
  return provider && model ? `${provider}/${model}` : trimmed;
}

export function providerScopedModelId(
  providerId: string,
  modelId: string | undefined,
): string | undefined {
  const trimmed = String(modelId ?? '').trim();
  if (!trimmed) return undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return `${providerId}/${trimmed}`;

  const head = canonicalProviderId(trimmed.slice(0, slashIndex));
  const tail = trimmed.slice(slashIndex + 1).trim();
  return head && tail ? `${head}/${tail}` : canonicalModelRef(trimmed);
}

/** Rebuild the canonical model id projected by sessions.list. */
export function resolveGatewaySessionModelId(
  modelProvider: unknown,
  model: unknown,
): string | null {
  const rawModel = typeof model === 'string' ? model.trim() : '';
  if (!rawModel) return null;
  const provider = typeof modelProvider === 'string'
    ? canonicalProviderId(modelProvider)
    : '';
  return (provider ? providerScopedModelId(provider, rawModel) : canonicalModelRef(rawModel)) ?? null;
}
