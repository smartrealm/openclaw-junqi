// ═══════════════════════════════════════════════════════════
// Provider Templates — Config Manager
// IDs, env vars, and base URLs are authoritative from:
//   openclaw/src/agents/model-auth-env-vars.ts
//   openclaw/src/agents/models-config.providers.static.ts
//   openclaw/src/commands/auth-choice-options.ts
// ═══════════════════════════════════════════════════════════

import type { ProviderAuthMode } from '@/types/providerAuthMode';
import type { OpenClawApiProtocol } from '@/types/openclawApiProtocol';

export interface ProviderTemplate {
  id: string;
  nameKey: string;
  name: string;
  icon: string;
  colorClass: string;
  authModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  envKey: string;
  envKeyAlt?: string[];
  baseUrl?: string;
  /** Suggested protocol for this reviewed onboarding template.
   * The selected Runtime schema remains the write-time authority.
   */
  api?: OpenClawApiProtocol;
  docsUrl?: string;
  /** If true, user must supply a URL (like vllm/custom). */
  requiresBaseUrl?: boolean;
  /** Hint shown below the provider name. */
  hint?: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [

  // ────────────────────────────────────────────────────────
  // ── International cloud providers
  // ────────────────────────────────────────────────────────

  // 1. Anthropic
  {
    id: 'anthropic',
    nameKey: 'config.provider.anthropic',
    name: 'Anthropic',
    icon: 'A',
    colorClass: 'from-amber-600 to-yellow-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'ANTHROPIC_API_KEY',
    envKeyAlt: ['ANTHROPIC_OAUTH_TOKEN'],
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic-messages',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
  },

  // 2. OpenAI
  {
    id: 'openai',
    nameKey: 'config.provider.openai',
    name: 'OpenAI',
    icon: 'O',
    colorClass: 'from-emerald-600 to-green-700',
    authModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },

  // 3. Google Gemini
  {
    id: 'google',
    nameKey: 'config.provider.google',
    name: 'Google Gemini',
    icon: 'G',
    colorClass: 'from-blue-600 to-blue-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai',
    docsUrl: 'https://ai.google.dev/api',
  },

  // 4. xAI (Grok)
  {
    id: 'xai',
    nameKey: 'config.provider.xai',
    name: 'xAI (Grok)',
    icon: 'X',
    colorClass: 'from-slate-600 to-gray-700',
    authModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    envKey: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    api: 'openai-completions',
    docsUrl: 'https://docs.x.ai/api',
  },

  // 5. Mistral AI
  {
    id: 'mistral',
    nameKey: 'config.provider.mistral',
    name: 'Mistral AI',
    icon: 'M',
    colorClass: 'from-orange-500 to-red-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    api: 'openai-completions',
    docsUrl: 'https://docs.mistral.ai/api/',
  },

  // 6. OpenRouter
  {
    id: 'openrouter',
    nameKey: 'config.provider.openrouter',
    name: 'OpenRouter',
    icon: 'R',
    colorClass: 'from-pink-600 to-rose-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    docsUrl: 'https://openrouter.ai/docs',
  },

  // 7. Groq
  {
    id: 'groq',
    nameKey: 'config.provider.groq',
    name: 'Groq',
    icon: 'G',
    colorClass: 'from-violet-600 to-purple-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    docsUrl: 'https://console.groq.com/docs',
  },

  // 8. Together AI
  {
    id: 'together',
    nameKey: 'config.provider.together',
    name: 'Together AI',
    icon: 'T',
    colorClass: 'from-blue-500 to-cyan-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    api: 'openai-completions',
    docsUrl: 'https://docs.together.ai/',
  },

  // 9. Kilo Code Gateway
  {
    id: 'kilocode',
    nameKey: 'config.provider.kilocode',
    name: 'KiloCode',
    icon: 'K',
    colorClass: 'from-purple-600 to-fuchsia-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'KILOCODE_API_KEY',
    baseUrl: 'https://api.kilo.ai/api/gateway/',
    api: 'openai-completions',
    docsUrl: 'https://kilo.ai/docs',
  },

  // 10. Venice AI
  {
    id: 'venice',
    nameKey: 'config.provider.venice',
    name: 'Venice AI',
    icon: 'doubao',
    colorClass: 'from-teal-500 to-cyan-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'VENICE_API_KEY',
    baseUrl: 'https://api.venice.ai/api/v1',
    api: 'openai-completions',
    docsUrl: 'https://docs.venice.ai/',
  },

  // 11. Hugging Face
  {
    id: 'huggingface',
    nameKey: 'config.provider.huggingface',
    name: 'Hugging Face',
    icon: '',
    colorClass: 'from-yellow-500 to-amber-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'HF_TOKEN',
    envKeyAlt: ['HUGGINGFACE_HUB_TOKEN'],
    baseUrl: 'https://api-inference.huggingface.co',
    api: 'openai-completions',
    docsUrl: 'https://huggingface.co/docs/api-inference',
  },

  // 12. LiteLLM (unified gateway)
  {
    id: 'litellm',
    nameKey: 'config.provider.litellm',
    name: 'LiteLLM',
    icon: 'L',
    colorClass: 'from-green-500 to-emerald-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'LITELLM_API_KEY',
    baseUrl: 'http://localhost:4000/v1',
    api: 'openai-completions',
    hint: 'Unified gateway for 100+ LLM providers',
    docsUrl: 'https://docs.litellm.ai/',
  },

  // 13. Vercel AI Gateway
  {
    id: 'vercel-ai-gateway',
    nameKey: 'config.provider.vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    icon: '',
    colorClass: 'from-slate-500 to-gray-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'AI_GATEWAY_API_KEY',
    api: 'openai-completions',
    docsUrl: 'https://vercel.com/docs/ai-gateway',
  },

  // 14. NVIDIA
  {
    id: 'nvidia',
    nameKey: 'config.provider.nvidia',
    name: 'NVIDIA',
    icon: 'N',
    colorClass: 'from-green-600 to-lime-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    api: 'openai-completions',
    docsUrl: 'https://docs.api.nvidia.com/',
  },

  // 15. GitHub Copilot
  {
    id: 'github-copilot',
    nameKey: 'config.provider.github-copilot',
    name: 'GitHub Copilot',
    icon: '',
    colorClass: 'from-gray-600 to-gray-700',
    authModes: ['oauth_browser'],
    defaultAuthMode: 'oauth_browser',
    // Priority order from bundled-provider-auth-env-vars.generated.ts
    envKey: 'COPILOT_GITHUB_TOKEN',
    envKeyAlt: ['GH_TOKEN', 'GITHUB_TOKEN'],
    api: 'openai-completions',
    docsUrl: 'https://docs.github.com/en/copilot',
  },

  // ────────────────────────────────────────────────────────
  // ── 国内 provider（均基于 OpenClaw 官方支持）
  // ────────────────────────────────────────────────────────

  // 16. MiniMax（官方：api: anthropic-messages）
  //     Provider ID: minimax  ENV: MINIMAX_API_KEY
  //     Ref: openclaw/src/agents/models-config.providers.static.ts buildMinimaxProvider()
  {
    id: 'minimax',
    nameKey: 'config.provider.minimax',
    name: 'MiniMax',
    icon: '',
    colorClass: 'from-purple-500 to-violet-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MINIMAX_API_KEY',
    baseUrl: 'https://api.minimax.io/anthropic',
    // anthropic-messages — OpenClaw sends via Anthropic API format
    api: 'anthropic-messages',
    hint: 'MiniMax M2.5（Anthropic 协议）— OpenClaw 官方支持',
    docsUrl: 'https://platform.minimaxi.com/document/ChatCompletion%20v2',
  },

  // 17. Moonshot AI（Kimi）
  //     Provider ID: moonshot  ENV: MOONSHOT_API_KEY
  //     Ref: openclaw/src/agents/models-config.providers.static.ts buildMoonshotProvider()
  {
    id: 'moonshot',
    nameKey: 'config.provider.moonshot',
    name: 'Kimi (Moonshot)',
    icon: '',
    colorClass: 'from-blue-500 to-indigo-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1',
    api: 'openai-completions',
    docsUrl: 'https://platform.moonshot.ai/docs/api-reference',
  },

  // 18. Z.AI（智谱 GLM / BigModel）
  //     Provider ID: zai  ENV: ZAI_API_KEY
  //     CN endpoint: open.bigmodel.cn  Global: api.z.ai
  {
    id: 'zai',
    nameKey: 'config.provider.zai',
    name: 'Z.AI (Zhipu GLM)',
    icon: 'Z',
    colorClass: 'from-indigo-600 to-blue-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'ZAI_API_KEY',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    docsUrl: 'https://bigmodel.cn/dev/api',
  },

  // 19. 深度求索（DeepSeek）
  //     OpenClaw 通过 openai-completions 兼容协议接入
  {
    id: 'deepseek',
    nameKey: 'config.provider.deepseek',
    name: 'DeepSeek',
    icon: 'D',
    colorClass: 'from-cyan-600 to-teal-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    docsUrl: 'https://api-docs.deepseek.com/',
  },

  // 20. 硅基流动 SiliconFlow
  //     OpenClaw 通过 OpenAI 兼容模式接入
  //     模型名需使用平台中的完整原始模型名，例如 deepseek-ai/DeepSeek-V3
  {
    id: 'siliconflow',
    nameKey: 'config.provider.siliconflow',
    name: 'SiliconFlow',
    icon: '',
    colorClass: 'from-sky-500 to-cyan-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'SILICONFLOW_API_KEY',
    baseUrl: 'https://api.siliconflow.cn/v1',
    api: 'openai-completions',
    hint: '请输入模型广场里的完整模型名，例如 deepseek-ai/DeepSeek-V3；系统会自动写成 siliconflow/<模型名>',
    docsUrl: 'https://docs.siliconflow.cn/cn/usercases/use-siliconcloud-in-OpenClaw#openclaw',
  },

  // 21. 百度千帆（Qianfan）
  //     Provider ID: qianfan  ENV: QIANFAN_API_KEY
  //     Ref: openclaw/src/agents/models-config.providers.static.ts buildQianfanProvider()
  //     URL: https://qianfan.baidubce.com/v2  api: openai-completions
  //     注意: 旧版 IAM 鉴权（aip.baidubce.com）不兼容，请使用新版百炼平台 API Key
  {
    id: 'qianfan',
    nameKey: 'config.provider.qianfan',
    name: '百度千帆 (Qianfan)',
    icon: '百',
    colorClass: 'from-blue-500 to-sky-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'QIANFAN_API_KEY',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    api: 'openai-completions',
    hint: '使用百炼平台 API Key（非旧版 IAM 鉴权）',
    docsUrl: 'https://qianfan.cloud.baidu.com/doc/index.html',
  },

  // 22. 阿里云 Model Studio（百炼 Coding Plan）
  //     Provider ID: modelstudio  ENV: MODELSTUDIO_API_KEY
  //     Ref: openclaw/src/agents/models-config.providers.static.ts buildModelStudioProvider()
  //     Global: coding-intl.dashscope.aliyuncs.com  CN: coding.dashscope.aliyuncs.com
  {
    id: 'modelstudio',
    nameKey: 'config.provider.modelstudio',
    name: '阿里云百炼 (Model Studio)',
    icon: '阿',
    colorClass: 'from-orange-500 to-amber-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MODELSTUDIO_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    hint: '百炼订阅 Plan 专属 Key（非普通 DashScope Key）',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
  },

  // 23. 火山引擎 VolcEngine（豆包 DouBao）
  //     Provider ID: volcengine  ENV: VOLCANO_ENGINE_API_KEY
  //     Ref: openclaw/src/agents/doubao-models.ts DOUBAO_BASE_URL
  {
    id: 'volcengine',
    nameKey: 'config.provider.volcengine',
    name: '火山引擎豆包 (VolcEngine)',
    icon: 'V',
    colorClass: 'from-red-500 to-orange-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'VOLCANO_ENGINE_API_KEY',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    api: 'openai-completions',
    docsUrl: 'https://www.volcengine.com/docs/82379',
  },

  // 24. 小米 MiMo（Xiaomi）
  //     Provider ID: xiaomi  ENV: XIAOMI_API_KEY
  //     Ref: openclaw/src/agents/models-config.providers.static.ts buildXiaomiProvider()
  //     api: anthropic-messages
  {
    id: 'xiaomi',
    nameKey: 'config.provider.xiaomi',
    name: 'Xiaomi MiMo',
    icon: 'mimo',
    colorClass: 'from-orange-400 to-amber-500',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'XIAOMI_API_KEY',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    api: 'anthropic-messages',
    docsUrl: 'https://ai.mi.com/',
  },

  // ────────────────────────────────────────────────────────
  // ── Coding Plan 专用 provider（与开放平台 Key/URL 完全独立）
  // ────────────────────────────────────────────────────────

  // Kimi Coding（专用编码线）
  //   Provider ID at runtime: 'kimi' (OpenClaw normalizes kimi-coding → kimi)
  //   Official docs example: provider = 'kimi-coding', model = 'kimi-coding/k2p5'
  //   ENV: KIMI_API_KEY  (NEVER use MOONSHOT_API_KEY here)
  //   api: anthropic-messages  (Anthropic-compatible)
  //   Ref: extensions/kimi-coding/index.ts
  {
    id: 'kimi-coding',
    nameKey: 'config.provider.kimi-coding',
    name: 'Kimi Coding',
    icon: '⌨',
    colorClass: 'from-blue-600 to-violet-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'KIMI_API_KEY',
    envKeyAlt: ['KIMICODE_API_KEY'],
    baseUrl: 'https://api.kimi.com/coding/',
    api: 'anthropic-messages',
    hint: '与 Kimi 开放平台（MOONSHOT_API_KEY）完全独立，需专用 KIMI_API_KEY',
    docsUrl: 'https://docs.openclaw.ai/concepts/model-providers',
  },

  // ────────────────────────────────────────────────────────
  // ── 本地 / 自托管 provider
  // ────────────────────────────────────────────────────────

  // 25. Ollama（本地）
  //     Provider ID: ollama  ENV: OLLAMA_API_KEY (optional)
  {
    id: 'ollama',
    nameKey: 'config.provider.ollama',
    name: 'Ollama',
    icon: 'ollama',
    colorClass: 'from-stone-600 to-neutral-700',
    authModes: ['local'],
    defaultAuthMode: 'local',
    envKey: 'OLLAMA_API_KEY',
    baseUrl: 'http://localhost:11434',
    api: 'ollama',
    docsUrl: 'https://ollama.ai/docs',
  },

  // 26. vLLM（自托管 OpenAI 兼容）
  //     Provider ID: vllm  ENV: VLLM_API_KEY
  //     Ref: openclaw/src/commands/auth-choice-options.ts choices: ["vllm"]
  //     模型 ID 使用 vllm/<model-name>，OpenClaw 会自动去掉前缀
  {
    id: 'vllm',
    nameKey: 'config.provider.vllm',
    name: 'vLLM',
    icon: 'V',
    colorClass: 'from-emerald-600 to-teal-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'VLLM_API_KEY',
    baseUrl: '',
    api: 'openai-completions',
    requiresBaseUrl: true,
    hint: '本地/私有部署的 OpenAI 兼容服务器',
    docsUrl: 'https://docs.vllm.ai/',
  },

  // 27. Custom（任意 OpenAI/Anthropic 兼容端点）
  //     Provider ID 可由用户自定义
  {
    id: 'custom',
    nameKey: 'config.provider.custom',
    name: 'Custom',
    icon: 'custom',
    colorClass: 'from-slate-500 to-gray-600',
    authModes: ['api_key', 'local'],
    defaultAuthMode: 'api_key',
    envKey: 'OPENCLAW_CUSTOM_API_KEY',
    baseUrl: '',
    api: 'openai-completions',
    requiresBaseUrl: true,
    hint: '任意 OpenAI 或 Anthropic 兼容端点',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getTemplateById(id: string): ProviderTemplate | undefined {
  const direct = PROVIDER_TEMPLATES.find((t) => t.id === id);
  if (direct) return direct;
  const aliasMap: Record<string, string> = {
    qwen: 'modelstudio',
    'qwen-dashscope': 'modelstudio',
    qwencloud: 'modelstudio',
    kimi: 'kimi-coding',
  };
  const mapped = aliasMap[id];
  if (!mapped) return undefined;
  return PROVIDER_TEMPLATES.find((t) => t.id === mapped);
}

export function getProviderColor(id: string): string {
  const tpl = getTemplateById(id);
  return tpl ? tpl.colorClass : 'from-slate-500 to-gray-600';
}

/**
 * Popular provider IDs shown in the "quick pick" grid.
 * Chinese providers first since this Desktop is primarily for CN users.
 */
export const POPULAR_PROVIDER_IDS = [
  'minimax',
  'deepseek',
  'siliconflow',
  'moonshot',
  'qianfan',
  'modelstudio',
  'volcengine',
  'openai',
  'anthropic',
];

// ── Provider Catalog (tab-based UI metadata) ─────────────────────────────────
//
// Each entry maps a template to a specific (region × plan) variant, allowing
// the picker to show separate cards for e.g. "Moonshot CN" vs "Moonshot Global".
// The catalog also carries the correct baseUrl and any coding-plan warnings.

export type ProviderRegion = 'cn' | 'global' | 'none';
export type ProviderPlan   = 'general' | 'coding' | 'oauth-portal';
export type ProviderTab    = 'recommended' | 'china' | 'global' | 'coding' | 'local';

export interface ProviderCatalogEntry {
  /** Unique ID for this catalog entry (not the provider ID). */
  catalogId: string;
  /** Which PROVIDER_TEMPLATES entry this maps to. */
  templateId: string;
  /** Human-readable label shown on the card. */
  label: string;
  /** Which tabs this entry appears in. */
  tabs: ProviderTab[];
  region: ProviderRegion;
  plan: ProviderPlan;
  /** Overrides the template's baseUrl for this specific region/plan. */
  baseUrlOverride?: string;
  /** First model to default-select in ConfigureStep. Falls back to generated provider catalog first item. */
  /** Warning banner shown in ConfigureStep when this is a coding/special plan. */
  planWarning?: string;
}

/** Full catalog, defining one entry per (provider × region × plan) combination. */
export const UI_CATALOG: ProviderCatalogEntry[] = [

  // ── No region split (single global endpoint) ────────────────────────────────
  { catalogId: 'deepseek',   templateId: 'deepseek',   label: 'DeepSeek',        tabs: ['china', 'global'], region: 'none', plan: 'general'},
  { catalogId: 'openai',     templateId: 'openai',     label: 'OpenAI',           tabs: ['global'],          region: 'none', plan: 'general'},
  { catalogId: 'anthropic',  templateId: 'anthropic',  label: 'Anthropic',        tabs: ['global'],          region: 'none', plan: 'general'},
  { catalogId: 'google',     templateId: 'google',     label: 'Google Gemini',    tabs: ['global'],          region: 'none', plan: 'general' },
  { catalogId: 'xai',        templateId: 'xai',        label: 'xAI (Grok)',       tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'mistral',    templateId: 'mistral',    label: 'Mistral AI',       tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'openrouter', templateId: 'openrouter', label: 'OpenRouter',       tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'groq',       templateId: 'groq',       label: 'Groq',             tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'together',   templateId: 'together',   label: 'Together AI',      tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'nvidia',     templateId: 'nvidia',     label: 'NVIDIA',           tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'kilocode',   templateId: 'kilocode',   label: 'KiloCode',         tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'venice',     templateId: 'venice',     label: 'Venice AI',        tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'huggingface',templateId: 'huggingface',label: 'Hugging Face',     tabs: ['global'],                         region: 'none', plan: 'general' },
  { catalogId: 'vercel-ai-gateway', templateId: 'vercel-ai-gateway', label: 'Vercel AI Gateway', tabs: ['global'],          region: 'none', plan: 'general' },
  { catalogId: 'github-copilot', templateId: 'github-copilot', label: 'GitHub Copilot', tabs: ['global'],                  region: 'none', plan: 'oauth-portal' },

  // ── CN-primary providers (no global counterpart in Desktop templates) ───────
  { catalogId: 'volcengine', templateId: 'volcengine', label: '火山引擎豆包',      tabs: ['recommended', 'china'],           region: 'cn',   plan: 'general'},
  { catalogId: 'siliconflow', templateId: 'siliconflow', label: '硅基流动 SiliconFlow', tabs: ['recommended', 'china'],      region: 'cn',   plan: 'general', baseUrlOverride: 'https://api.siliconflow.cn/v1' },
  { catalogId: 'qianfan',    templateId: 'qianfan',    label: '百度千帆',          tabs: ['china'],                          region: 'cn',   plan: 'general' },
  { catalogId: 'xiaomi',     templateId: 'xiaomi',     label: 'Xiaomi MiMo',      tabs: ['china'],                          region: 'cn',   plan: 'general' },

  // ── Dual-endpoint: Moonshot / Kimi 开放平台 ──────────────────────────────────
  { catalogId: 'moonshot-cn',     templateId: 'moonshot', label: 'Kimi · 中国站',  tabs: ['recommended', 'china'],  region: 'cn',     plan: 'general', baseUrlOverride: 'https://api.moonshot.cn/v1'},
  { catalogId: 'moonshot-global', templateId: 'moonshot', label: 'Kimi · Global', tabs: ['global'],                 region: 'global', plan: 'general', baseUrlOverride: 'https://api.moonshot.ai/v1'},

  // ── Dual-endpoint: Z.AI (智谱 GLM) ──────────────────────────────────────────
  { catalogId: 'zai-cn',     templateId: 'zai', label: 'Z.AI · 国内',   tabs: ['recommended', 'china'], region: 'cn',     plan: 'general', baseUrlOverride: 'https://open.bigmodel.cn/api/paas/v4' },
  { catalogId: 'zai-global', templateId: 'zai', label: 'Z.AI · Global', tabs: ['global'],               region: 'global', plan: 'general', baseUrlOverride: 'https://api.z.ai/api/paas/v4' },

  // ── Dual-endpoint: MiniMax ───────────────────────────────────────────────────
  { catalogId: 'minimax-cn',     templateId: 'minimax', label: 'MiniMax · 国内',   tabs: ['recommended', 'china'], region: 'cn',     plan: 'general', baseUrlOverride: 'https://api.minimaxi.com/anthropic' },
  { catalogId: 'minimax-global', templateId: 'minimax', label: 'MiniMax · Global', tabs: ['global'],               region: 'global', plan: 'general', baseUrlOverride: 'https://api.minimax.io/anthropic' },

  // ── Model Studio (阿里云百炼) ─────────────────────────────────────────────────
  // The MODELSTUDIO_API_KEY is for Coding Plan. Also provide the general compatible-mode URL.
  { catalogId: 'modelstudio-coding-cn',     templateId: 'modelstudio', label: '百炼 Coding · CN',     tabs: ['china', 'coding'], region: 'cn',     plan: 'coding',  baseUrlOverride: 'https://coding.dashscope.aliyuncs.com/v1',      planWarning: 'MODELSTUDIO_API_KEY 是 Coding Plan 专用 Key，不是普通 DashScope API Key。请在阿里云百炼控制台的「Coding Plan」下获取。' },
  { catalogId: 'modelstudio-coding-global', templateId: 'modelstudio', label: '百炼 Coding · Global', tabs: ['global', 'coding'],               region: 'global', plan: 'coding',  baseUrlOverride: 'https://coding-intl.dashscope.aliyuncs.com/v1', planWarning: 'MODELSTUDIO_API_KEY 是 Coding Plan 专用 Key（国际版）。请在阿里云百炼控制台的「Coding Plan」下获取。' },
  { catalogId: 'modelstudio-general',       templateId: 'modelstudio', label: '百炼 通用兼容模式',    tabs: ['recommended', 'china'],                           region: 'cn',     plan: 'general', baseUrlOverride: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },

  // ── Coding Plan (专用编码线，独立密钥) ──────────────────────────────────────
  { catalogId: 'kimi-coding',           templateId: 'kimi-coding', label: 'Kimi Coding',          tabs: ['coding'], region: 'none',   plan: 'coding', planWarning: '与 Kimi 开放平台（MOONSHOT_API_KEY）完全独立。必须使用 KIMI_API_KEY，严禁混用。' },
  { catalogId: 'zai-coding-cn',         templateId: 'zai',         label: 'Z.AI Coding · CN',     tabs: ['china', 'coding'], region: 'cn',     plan: 'coding', baseUrlOverride: 'https://open.bigmodel.cn/api/coding/paas/v4',  planWarning: '厂商控制台通常为独立 Coding Plan Key（与普通开放平台 ZAI_API_KEY 不同）。' },
  { catalogId: 'zai-coding-global',     templateId: 'zai',         label: 'Z.AI Coding · Global', tabs: ['global', 'coding'], region: 'global', plan: 'coding', baseUrlOverride: 'https://api.z.ai/api/coding/paas/v4',          planWarning: '厂商控制台通常为独立 Coding Plan Key（与普通开放平台 ZAI_API_KEY 不同）。' },

  // ── Local / self-hosted ─────────────────────────────────────────────────────
  { catalogId: 'ollama',  templateId: 'ollama',  label: 'Ollama',        tabs: ['local'],                region: 'none', plan: 'general' },
  { catalogId: 'vllm',    templateId: 'vllm',    label: 'vLLM',          tabs: ['local'],                region: 'none', plan: 'general' },
  { catalogId: 'litellm', templateId: 'litellm', label: 'LiteLLM',       tabs: ['local'],                region: 'none', plan: 'general' },
  { catalogId: 'custom',  templateId: 'custom',  label: 'Custom',        tabs: ['local'],                region: 'none', plan: 'general' },
];

/** Get catalog entries for a specific tab. */
export function getCatalogEntriesForTab(tab: ProviderTab): ProviderCatalogEntry[] {
  return UI_CATALOG.filter((e) => e.tabs.includes(tab));
}
