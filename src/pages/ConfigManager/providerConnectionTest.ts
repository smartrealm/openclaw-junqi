import type { ProviderTemplate } from './providerTemplates';
import { GENERATED_PROVIDER_CATALOG } from '@/generated/providerCatalog.generated';

export interface ConnectionPrecheckProbe {
  providerId: string;
  profileKey: string;
  baseUrl: string;
  apiKey: string;
  modelOverride?: string;
}

/** Build path suffix for baseUrl: either /models or /chat/completions (same version segment). */
export function modelsEndpointUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (!base) return '';
  if (/\/v\d+(beta)?$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function chatCompletionsEndpointUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (!base) return '';
  if (/\/v\d+(beta)?$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export const PROVIDER_TEST_TIMEOUT_MS = 15_000;

function normalizeProviderIdForCatalog(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === 'modelstudio' || normalized === 'qwencloud' || normalized === 'qwen-dashscope') return 'qwen';
  if (normalized === 'kimi-coding' || normalized === 'kimi-code' || normalized === 'kimi') return 'kimi-coding';
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai';
  return normalized;
}

function getGeneratedCatalogRows(providerId: string) {
  return GENERATED_PROVIDER_CATALOG[normalizeProviderIdForCatalog(providerId)] ?? [];
}

export function buildTestHeaders(tmpl: ProviderTemplate | undefined, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!apiKey) return headers;
  if (tmpl?.id === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (tmpl?.id === 'google') {
    // Gemini API authenticates with ?key=... on the URL, not a Bearer token.
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

/** Test provider connection. Tries GET /models first; on 404, tries POST /chat/completions (minimal body). */
export async function testProviderConnection(
  baseUrl: string,
  apiKey: string,
  tmpl?: ProviderTemplate,
  modelOverride?: string
): Promise<{ ok: boolean; message: string }> {
  const modelsUrl = modelsEndpointUrl(baseUrl);
  if (!modelsUrl) return { ok: false, message: 'Missing API endpoint' };

  const headers = buildTestHeaders(tmpl, apiKey);
  const isGoogle = tmpl?.id === 'google';
  const url = isGoogle && apiKey ? `${modelsUrl}?key=${encodeURIComponent(apiKey)}` : modelsUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) return { ok: true, message: 'OK' };
    if (res.status !== 404) {
      const text = await res.text();
      const short = text ? text.slice(0, 120).replace(/\s+/g, ' ') : '';
      return { ok: false, message: `${res.status} ${res.statusText}${short ? ` — ${short}` : ''}` };
    }

    // Anthropic 和 anthropic-messages（MiniMax 等兼容 provider）均不走 fallback
    if (tmpl?.api === 'anthropic-messages') {
      const text = await res.text();
      const short = text ? text.slice(0, 120).replace(/\s+/g, ' ') : '';
      return { ok: false, message: `404 ${res.statusText}${short ? ` — ${short}` : ''}` };
    }
    const chatUrl = isGoogle && apiKey
      ? `${chatCompletionsEndpointUrl(baseUrl)}?key=${encodeURIComponent(apiKey)}`
      : chatCompletionsEndpointUrl(baseUrl);
    const generatedRows = tmpl ? getGeneratedCatalogRows(tmpl.id) : [];
    const modelId =
      modelOverride ??
      generatedRows[0]?.id?.split('/').pop() ??
      'gpt-3.5-turbo';
    const body = JSON.stringify({
      model: modelId,
      messages: [{ role: 'user' as const, content: 'Hi' }],
      max_tokens: 1,
    });

    const controller2 = new AbortController();
    const t2 = setTimeout(() => controller2.abort(), PROVIDER_TEST_TIMEOUT_MS);
    try {
      const res2 = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller2.signal,
      });
      clearTimeout(t2);
      if (res2.ok) return { ok: true, message: 'OK' };
      if (res2.status === 401 || res2.status === 403) {
        return { ok: false, message: `__i18n:config.connectionReachableCheckKey:${res2.status}__` };
      }
      const text2 = await res2.text();
      const short2 = text2 ? text2.slice(0, 120).replace(/\s+/g, ' ') : '';
      return { ok: false, message: `${res2.status} ${res2.statusText}${short2 ? ` — ${short2}` : ''}` };
    } catch (e2: any) {
      clearTimeout(t2);
      if (e2?.name === 'AbortError') {
        return { ok: false, message: `Connection timed out (${PROVIDER_TEST_TIMEOUT_MS / 1000}s)` };
      }
      return { ok: false, message: e2?.message || String(e2) };
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === 'AbortError') {
      return { ok: false, message: `Connection timed out (${PROVIDER_TEST_TIMEOUT_MS / 1000}s)` };
    }
    return { ok: false, message: e?.message || String(e) };
  }
}
