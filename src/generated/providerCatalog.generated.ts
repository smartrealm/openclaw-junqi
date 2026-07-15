export type GeneratedProviderCatalogModel = {
  id: string;
  suggestedAlias?: string;
  supportsImage?: boolean;
};

export const GENERATED_PROVIDER_CATALOG_META = {
  "source": "openclaw-cli",
  "version": "OpenClaw 2026.7.1 (2d2ddc4)"
} as const;

export const GENERATED_PROVIDER_CATALOG: Record<string, GeneratedProviderCatalogModel[]> = {
  "anthropic": [
    {
      "id": "anthropic/claude-fable-5",
      "suggestedAlias": "Claude Fable 5"
    },
    {
      "id": "anthropic/claude-haiku-4-5",
      "suggestedAlias": "Claude Haiku 4.5"
    },
    {
      "id": "anthropic/claude-haiku-4-5-20251001",
      "suggestedAlias": "Claude Haiku 4.5"
    },
    {
      "id": "anthropic/claude-mythos-5",
      "suggestedAlias": "Claude Mythos 5"
    },
    {
      "id": "anthropic/claude-opus-4-6",
      "suggestedAlias": "Claude Opus 4.6"
    },
    {
      "id": "anthropic/claude-opus-4-7",
      "suggestedAlias": "Claude Opus 4.7"
    },
    {
      "id": "anthropic/claude-opus-4-8",
      "suggestedAlias": "Claude Opus 4.8"
    },
    {
      "id": "anthropic/claude-sonnet-4-6",
      "suggestedAlias": "Claude Sonnet 4.6"
    },
    {
      "id": "anthropic/claude-sonnet-5",
      "suggestedAlias": "Claude Sonnet 5"
    }
  ],
  "openai": [
    {
      "id": "openai/gpt-5.5",
      "suggestedAlias": "gpt-5.5",
      "supportsImage": true
    },
    {
      "id": "openai/gpt-5.6",
      "suggestedAlias": "gpt-5.6",
      "supportsImage": true
    },
    {
      "id": "openai/gpt-5.6-luna",
      "suggestedAlias": "gpt-5.6-luna",
      "supportsImage": true
    },
    {
      "id": "openai/gpt-5.6-sol",
      "suggestedAlias": "gpt-5.6-sol",
      "supportsImage": true
    },
    {
      "id": "openai/gpt-5.6-terra",
      "suggestedAlias": "gpt-5.6-terra",
      "supportsImage": true
    }
  ],
  "google": [
    {
      "id": "google/gemini-2.5-flash",
      "suggestedAlias": "g2.5-flash",
      "supportsImage": true
    },
    {
      "id": "google/gemini-2.5-flash-lite",
      "suggestedAlias": "g2.5-lite",
      "supportsImage": true
    },
    {
      "id": "google/gemini-2.5-pro",
      "suggestedAlias": "g2.5-pro",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3-flash-preview",
      "suggestedAlias": "g3-flash",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3-pro-image-preview",
      "suggestedAlias": "g3-image",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3-pro-preview",
      "suggestedAlias": "g3-pro",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3.1-flash-image-preview",
      "suggestedAlias": "g3.1-image",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3.1-flash-lite-preview",
      "suggestedAlias": "g3.1-lite",
      "supportsImage": true
    },
    {
      "id": "google/gemini-3.1-pro-preview",
      "suggestedAlias": "g3.1-pro",
      "supportsImage": true
    }
  ],
  "xai": [
    {
      "id": "xai/grok-3",
      "suggestedAlias": "grok-3"
    },
    {
      "id": "xai/grok-3-fast",
      "suggestedAlias": "grok-3-fast"
    },
    {
      "id": "xai/grok-3-mini",
      "suggestedAlias": "grok-3-mini"
    },
    {
      "id": "xai/grok-3-mini-fast",
      "suggestedAlias": "g3-mini-fast"
    },
    {
      "id": "xai/grok-4",
      "suggestedAlias": "grok-4"
    },
    {
      "id": "xai/grok-4-0709",
      "suggestedAlias": "grok-4-0709"
    },
    {
      "id": "xai/grok-4-1-fast",
      "suggestedAlias": "grok-4.1-fast",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4-1-fast-non-reasoning",
      "suggestedAlias": "g4.1-fast-nr",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4-fast",
      "suggestedAlias": "grok-4-fast",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4-fast-non-reasoning",
      "suggestedAlias": "g4-fast-nr",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4.20-beta-latest-non-reasoning",
      "suggestedAlias": "g4.20-nr",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4.20-beta-latest-reasoning",
      "suggestedAlias": "g4.20-reason",
      "supportsImage": true
    },
    {
      "id": "xai/grok-4.3",
      "suggestedAlias": "grok-4.3",
      "supportsImage": true
    },
    {
      "id": "xai/grok-code-fast-1",
      "suggestedAlias": "grok-code"
    }
  ],
  "mistral": [
    {
      "id": "mistral/codestral-latest",
      "suggestedAlias": "Codestral (latest)"
    },
    {
      "id": "mistral/devstral-medium-latest",
      "suggestedAlias": "Devstral 2 (latest)"
    },
    {
      "id": "mistral/magistral-small",
      "suggestedAlias": "Magistral Small"
    },
    {
      "id": "mistral/mistral-large-latest",
      "suggestedAlias": "Mistral Large (latest)",
      "supportsImage": true
    },
    {
      "id": "mistral/mistral-medium-2508",
      "suggestedAlias": "Mistral Medium 3.1",
      "supportsImage": true
    },
    {
      "id": "mistral/mistral-medium-3-5",
      "suggestedAlias": "Mistral Medium 3.5"
    },
    {
      "id": "mistral/mistral-small-latest",
      "suggestedAlias": "Mistral Small (latest)",
      "supportsImage": true
    },
    {
      "id": "mistral/pixtral-large-latest",
      "suggestedAlias": "Pixtral Large (latest)",
      "supportsImage": true
    }
  ],
  "openrouter": [
    {
      "id": "openrouter/anthropic/claude-sonnet-4-5",
      "suggestedAlias": "sonnet"
    },
    {
      "id": "openrouter/auto",
      "suggestedAlias": "auto"
    },
    {
      "id": "openrouter/healer-alpha",
      "suggestedAlias": "healer"
    },
    {
      "id": "openrouter/hunter-alpha",
      "suggestedAlias": "hunter"
    }
  ],
  "groq": [
    {
      "id": "groq/llama-3.3-70b-versatile",
      "suggestedAlias": "llama"
    },
    {
      "id": "groq/moonshotai/kimi-k2-instruct-0905",
      "suggestedAlias": "kimi-k2"
    }
  ],
  "together": [
    {
      "id": "together/deepseek-ai/DeepSeek-V4-Pro",
      "suggestedAlias": "DeepSeek V4 Pro"
    },
    {
      "id": "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "suggestedAlias": "Llama 3.3 70B Instruct Turbo"
    },
    {
      "id": "together/moonshotai/Kimi-K2.6",
      "suggestedAlias": "Kimi K2.6 FP4"
    },
    {
      "id": "together/Qwen/Qwen2.5-7B-Instruct-Turbo",
      "suggestedAlias": "Qwen2.5 7B Instruct Turbo"
    },
    {
      "id": "together/zai-org/GLM-5.1",
      "suggestedAlias": "GLM 5.1 FP4"
    }
  ],
  "kilocode": [
    {
      "id": "kilocode/kilo/auto",
      "suggestedAlias": "kilo-auto"
    }
  ],
  "venice": [
    {
      "id": "venice/claude-opus-4-6",
      "suggestedAlias": "opus-4.6"
    },
    {
      "id": "venice/claude-sonnet-4-6",
      "suggestedAlias": "sonnet-4.6"
    },
    {
      "id": "venice/deepseek-v3.2",
      "suggestedAlias": "deepseek-v3.2"
    },
    {
      "id": "venice/gemini-3-pro-preview",
      "suggestedAlias": "gemini-3-pro"
    },
    {
      "id": "venice/grok-code-fast-1",
      "suggestedAlias": "grok-code"
    },
    {
      "id": "venice/kimi-k2-5",
      "suggestedAlias": "kimi-k2.5"
    },
    {
      "id": "venice/openai-gpt-54",
      "suggestedAlias": "gpt-5.4"
    },
    {
      "id": "venice/qwen3-5-35b-a3b",
      "suggestedAlias": "qwen3.5"
    },
    {
      "id": "venice/qwen3-vl-235b-a22b",
      "suggestedAlias": "qwen3-vl"
    }
  ],
  "huggingface": [
    {
      "id": "huggingface/deepseek-ai/DeepSeek-R1",
      "suggestedAlias": "deepseek-r1"
    },
    {
      "id": "huggingface/deepseek-ai/DeepSeek-V3.1",
      "suggestedAlias": "deepseek-v3.1"
    },
    {
      "id": "huggingface/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "suggestedAlias": "llama-3.3"
    },
    {
      "id": "huggingface/openai/gpt-oss-120b",
      "suggestedAlias": "gpt-oss-120b"
    }
  ],
  "litellm": [],
  "vercel-ai-gateway": [
    {
      "id": "vercel-ai-gateway/anthropic/claude-opus-4.6",
      "suggestedAlias": "opus-4.6"
    },
    {
      "id": "vercel-ai-gateway/openai/gpt-5.4",
      "suggestedAlias": "gpt-5.4"
    },
    {
      "id": "vercel-ai-gateway/openai/gpt-5.4-pro",
      "suggestedAlias": "gpt-5.4-pro"
    }
  ],
  "nvidia": [
    {
      "id": "nvidia/minimaxai/minimax-m2.5",
      "suggestedAlias": "MiniMax M2.5"
    },
    {
      "id": "nvidia/minimaxai/minimax-m2.7",
      "suggestedAlias": "Minimax M2.7"
    },
    {
      "id": "nvidia/moonshotai/kimi-k2.5",
      "suggestedAlias": "Kimi K2.5"
    },
    {
      "id": "nvidia/nemotron-3-super-120b-a12b",
      "suggestedAlias": "NVIDIA Nemotron 3 Super 120B"
    },
    {
      "id": "nvidia/nemotron-3-ultra-550b-a55b",
      "suggestedAlias": "NVIDIA Nemotron 3 Ultra 550B"
    },
    {
      "id": "nvidia/z-ai/glm-5.1",
      "suggestedAlias": "GLM 5.1"
    },
    {
      "id": "nvidia/z-ai/glm5",
      "suggestedAlias": "GLM-5"
    }
  ],
  "github-copilot": [
    {
      "id": "github-copilot/claude-opus-4.6",
      "suggestedAlias": "Claude Opus 4.6"
    },
    {
      "id": "github-copilot/claude-opus-4.7",
      "suggestedAlias": "Claude Opus 4.7"
    },
    {
      "id": "github-copilot/claude-opus-4.8",
      "suggestedAlias": "Claude Opus 4.8"
    },
    {
      "id": "github-copilot/claude-sonnet-4.6",
      "suggestedAlias": "Claude Sonnet 4.6"
    },
    {
      "id": "github-copilot/gemini-2.5-pro",
      "suggestedAlias": "Gemini 2.5 Pro"
    },
    {
      "id": "github-copilot/gemini-3-flash",
      "suggestedAlias": "Gemini 3 Flash"
    },
    {
      "id": "github-copilot/gemini-3.1-pro",
      "suggestedAlias": "Gemini 3.1 Pro"
    },
    {
      "id": "github-copilot/goldeneye",
      "suggestedAlias": "Goldeneye"
    },
    {
      "id": "github-copilot/gpt-5.3-codex",
      "suggestedAlias": "GPT-5.3-Codex"
    },
    {
      "id": "github-copilot/gpt-5.4",
      "suggestedAlias": "GPT-5.4"
    },
    {
      "id": "github-copilot/gpt-5.4-mini",
      "suggestedAlias": "GPT-5.4 mini"
    },
    {
      "id": "github-copilot/gpt-5.4-nano",
      "suggestedAlias": "GPT-5.4 nano"
    },
    {
      "id": "github-copilot/gpt-5.5",
      "suggestedAlias": "GPT-5.5"
    },
    {
      "id": "github-copilot/raptor-mini",
      "suggestedAlias": "Raptor mini"
    }
  ],
  "minimax": [
    {
      "id": "minimax/MiniMax-M2.7",
      "suggestedAlias": "minimax-m27"
    },
    {
      "id": "minimax/MiniMax-M2.7-highspeed",
      "suggestedAlias": "minimax-fast"
    }
  ],
  "moonshot": [
    {
      "id": "moonshot/kimi-k2.6",
      "suggestedAlias": "Kimi K2.6",
      "supportsImage": true
    },
    {
      "id": "moonshot/kimi-k2.7-code",
      "suggestedAlias": "Kimi K2.7 Code"
    }
  ],
  "zai": [
    {
      "id": "zai/glm-4.5",
      "suggestedAlias": "glm-4.5"
    },
    {
      "id": "zai/glm-4.5-air",
      "suggestedAlias": "glm-4.5-air"
    },
    {
      "id": "zai/glm-4.5-flash",
      "suggestedAlias": "glm-4.5-flash"
    },
    {
      "id": "zai/glm-4.5v",
      "suggestedAlias": "glm-4.5v",
      "supportsImage": true
    },
    {
      "id": "zai/glm-4.6",
      "suggestedAlias": "glm-4.6"
    },
    {
      "id": "zai/glm-4.6v",
      "suggestedAlias": "glm-4.6v",
      "supportsImage": true
    },
    {
      "id": "zai/glm-4.7",
      "suggestedAlias": "glm-4.7"
    },
    {
      "id": "zai/glm-4.7-flash",
      "suggestedAlias": "glm-4.7-flash"
    },
    {
      "id": "zai/glm-4.7-flashx",
      "suggestedAlias": "glm-4.7-flashx"
    },
    {
      "id": "zai/glm-5",
      "suggestedAlias": "glm-5"
    },
    {
      "id": "zai/glm-5-turbo",
      "suggestedAlias": "glm-5-turbo"
    },
    {
      "id": "zai/glm-5.1",
      "suggestedAlias": "glm-5.1"
    },
    {
      "id": "zai/glm-5v-turbo",
      "suggestedAlias": "glm-5v-turbo",
      "supportsImage": true
    }
  ],
  "deepseek": [
    {
      "id": "deepseek/deepseek-chat",
      "suggestedAlias": "DeepSeek Chat"
    },
    {
      "id": "deepseek/deepseek-reasoner",
      "suggestedAlias": "DeepSeek Reasoner"
    }
  ],
  "siliconflow": [],
  "qianfan": [
    {
      "id": "qianfan/deepseek-v3.2",
      "suggestedAlias": "ds-v3"
    },
    {
      "id": "qianfan/ernie-5.0-thinking-preview",
      "suggestedAlias": "ernie5",
      "supportsImage": true
    }
  ],
  "qwen": [
    {
      "id": "qwen/glm-4.7",
      "suggestedAlias": "glm-4.7"
    },
    {
      "id": "qwen/glm-5",
      "suggestedAlias": "glm-5"
    },
    {
      "id": "qwen/kimi-k2.5",
      "suggestedAlias": "kimi-k2.5",
      "supportsImage": true
    },
    {
      "id": "qwen/MiniMax-M2.5",
      "suggestedAlias": "minimax-m2.5"
    },
    {
      "id": "qwen/qwen3-coder-next",
      "suggestedAlias": "qwen-coder-next"
    },
    {
      "id": "qwen/qwen3-coder-plus",
      "suggestedAlias": "qwen-coder-plus"
    },
    {
      "id": "qwen/qwen3-max-2026-01-23",
      "suggestedAlias": "qwen3-max"
    },
    {
      "id": "qwen/qwen3.5-plus",
      "suggestedAlias": "qwen3.5-plus",
      "supportsImage": true
    },
    {
      "id": "qwen/qwen3.6-plus",
      "suggestedAlias": "qwen3.6-plus",
      "supportsImage": true
    }
  ],
  "volcengine": [
    {
      "id": "volcengine/deepseek-v3-2-251201",
      "suggestedAlias": "DeepSeek V3.2",
      "supportsImage": true
    },
    {
      "id": "volcengine/doubao-seed-1-8-251228",
      "suggestedAlias": "Doubao Seed 1.8",
      "supportsImage": true
    },
    {
      "id": "volcengine/doubao-seed-code-preview-251028",
      "suggestedAlias": "doubao-seed-code-preview-251028",
      "supportsImage": true
    },
    {
      "id": "volcengine/glm-4-7-251222",
      "suggestedAlias": "GLM 4.7"
    },
    {
      "id": "volcengine/kimi-k2-5-260127",
      "suggestedAlias": "Kimi K2.5"
    }
  ],
  "xiaomi": [
    {
      "id": "xiaomi/mimo-v2-flash",
      "suggestedAlias": "Xiaomi MiMo V2 Flash"
    },
    {
      "id": "xiaomi/mimo-v2-omni",
      "suggestedAlias": "Xiaomi MiMo V2 Omni",
      "supportsImage": true
    },
    {
      "id": "xiaomi/mimo-v2-pro",
      "suggestedAlias": "Xiaomi MiMo V2 Pro"
    }
  ],
  "kimi-coding": [
    {
      "id": "kimi-coding/k2p5",
      "suggestedAlias": "kimi-code"
    }
  ],
  "ollama": [
    {
      "id": "ollama/deepseek-r1:7b",
      "suggestedAlias": "ds-r1"
    },
    {
      "id": "ollama/llama3.2",
      "suggestedAlias": "llama"
    },
    {
      "id": "ollama/qwen3:8b",
      "suggestedAlias": "qwen"
    }
  ],
  "vllm": [],
  "custom": [],
  "byteplus": [
    {
      "id": "byteplus/glm-4-7-251222",
      "suggestedAlias": "GLM 4.7"
    },
    {
      "id": "byteplus/kimi-k2-5-260127",
      "suggestedAlias": "Kimi K2.5"
    },
    {
      "id": "byteplus/seed-1-8-251228",
      "suggestedAlias": "Seed 1.8"
    }
  ],
  "byteplus-plan": [
    {
      "id": "byteplus-plan/ark-code-latest",
      "suggestedAlias": "Ark Coding Plan"
    },
    {
      "id": "byteplus-plan/doubao-seed-code",
      "suggestedAlias": "Doubao Seed Code"
    },
    {
      "id": "byteplus-plan/glm-4.7",
      "suggestedAlias": "GLM 4.7 Coding"
    },
    {
      "id": "byteplus-plan/kimi-k2-thinking",
      "suggestedAlias": "Kimi K2 Thinking"
    },
    {
      "id": "byteplus-plan/kimi-k2.5",
      "suggestedAlias": "Kimi K2.5 Coding"
    }
  ],
  "claude-cli": [
    {
      "id": "claude-cli/claude-opus-4-6",
      "suggestedAlias": "Claude Opus 4.6 (Claude CLI)"
    },
    {
      "id": "claude-cli/claude-opus-4-7",
      "suggestedAlias": "Claude Opus 4.7 (Claude CLI)"
    },
    {
      "id": "claude-cli/claude-opus-4-8",
      "suggestedAlias": "Claude Opus 4.8 (Claude CLI)"
    },
    {
      "id": "claude-cli/claude-sonnet-4-6",
      "suggestedAlias": "Claude Sonnet 4.6 (Claude CLI)"
    },
    {
      "id": "claude-cli/claude-sonnet-5",
      "suggestedAlias": "Claude Sonnet 5 (Claude CLI)"
    }
  ],
  "cohere": [
    {
      "id": "cohere/command-a-03-2025",
      "suggestedAlias": "Command A"
    }
  ],
  "meta": [
    {
      "id": "meta/muse-spark-1.1",
      "suggestedAlias": "Muse Spark 1.1"
    }
  ],
  "novita": [
    {
      "id": "novita/deepseek/deepseek-r1-0528",
      "suggestedAlias": "DeepSeek R1 0528"
    },
    {
      "id": "novita/deepseek/deepseek-v3-0324",
      "suggestedAlias": "DeepSeek V3 0324"
    },
    {
      "id": "novita/minimax/minimax-m2.7",
      "suggestedAlias": "MiniMax M2.7"
    },
    {
      "id": "novita/moonshotai/kimi-k2.5",
      "suggestedAlias": "Kimi K2.5"
    },
    {
      "id": "novita/qwen/qwen3-235b-a22b-fp8",
      "suggestedAlias": "Qwen3 235B A22B FP8"
    },
    {
      "id": "novita/zai-org/glm-5",
      "suggestedAlias": "GLM-5"
    }
  ],
  "ollama-cloud": [
    {
      "id": "ollama-cloud/glm-5.1:cloud",
      "suggestedAlias": "glm-5.1:cloud"
    },
    {
      "id": "ollama-cloud/glm-5.2:cloud",
      "suggestedAlias": "glm-5.2:cloud"
    },
    {
      "id": "ollama-cloud/kimi-k2.5:cloud",
      "suggestedAlias": "kimi-k2.5:cloud"
    },
    {
      "id": "ollama-cloud/minimax-m2.7:cloud",
      "suggestedAlias": "minimax-m2.7:cloud"
    }
  ],
  "volcengine-plan": [
    {
      "id": "volcengine-plan/ark-code-latest",
      "suggestedAlias": "Ark Coding Plan"
    },
    {
      "id": "volcengine-plan/doubao-seed-code",
      "suggestedAlias": "Doubao Seed Code"
    },
    {
      "id": "volcengine-plan/doubao-seed-code-preview-251028",
      "suggestedAlias": "Doubao Seed Code Preview"
    },
    {
      "id": "volcengine-plan/glm-4.7",
      "suggestedAlias": "GLM 4.7 Coding"
    },
    {
      "id": "volcengine-plan/kimi-k2-thinking",
      "suggestedAlias": "Kimi K2 Thinking"
    },
    {
      "id": "volcengine-plan/kimi-k2.5",
      "suggestedAlias": "Kimi K2.5 Coding"
    }
  ]
} as const;
