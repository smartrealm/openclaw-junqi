const OFFICIAL_PROVIDER_ICON_NAMES = new Set([
  'abacus', 'alibaba', 'amp', 'antigravity', 'augment', 'bedrock', 'chutes',
  'claude', 'clawrouter', 'codebuff', 'codex', 'commandcode', 'copilot', 'crof',
  'crossmodel', 'cursor', 'deepgram', 'deepseek', 'devin', 'doubao', 'elevenlabs',
  'factory', 'gemini', 'grok', 'groq', 'jetbrains', 'kilo', 'kimi', 'kiro',
  'litellm', 'llmproxy', 'manus', 'mimo', 'minimax', 'mistral', 'ollama',
  'opencode', 'opencodego', 'openrouter', 'perplexity', 'poe', 'qoder', 'sakana',
  'stepfun', 'synthetic', 't3chat', 'venice', 'vertexai', 'warp', 'windsurf',
  'zai', 'zed',
]);

const OFFICIAL_PROVIDER_ICON_ALIASES: Readonly<Record<string, string>> = {
  anthropic: 'claude',
  'amazon-bedrock': 'bedrock',
  'aws-bedrock': 'bedrock',
  google: 'gemini',
  'google-gemini-cli': 'gemini',
  'github-copilot': 'copilot',
  openai: 'codex',
  'opencode-go': 'opencodego',
  'opencode-zen': 'opencode',
  volcengine: 'doubao',
  xai: 'grok',
  xiaomi: 'mimo',
  'vertex-ai': 'vertexai',
  'z-ai': 'zai',
};

const OFFICIAL_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  google: 'Google',
  'github-copilot': 'GitHub',
  openai: 'OpenAI',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
};

export function normalizeProviderIdentity(providerId: string): string {
  return providerId.trim().toLowerCase();
}

export function resolveOfficialProviderIconName(providerId: string): string | null {
  const normalized = normalizeProviderIdentity(providerId);
  const iconName = OFFICIAL_PROVIDER_ICON_ALIASES[normalized] ?? normalized;
  return OFFICIAL_PROVIDER_ICON_NAMES.has(iconName) ? iconName : null;
}

export function providerDisplayLabel(providerId: string): string {
  const normalized = normalizeProviderIdentity(providerId);
  if (!normalized) return '';
  const officialLabel = OFFICIAL_PROVIDER_LABELS[normalized];
  if (officialLabel) return officialLabel;
  return normalized
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}

export function providerFallbackGlyph(providerId: string): string {
  return providerDisplayLabel(providerId).charAt(0).toLocaleUpperCase() || '?';
}
