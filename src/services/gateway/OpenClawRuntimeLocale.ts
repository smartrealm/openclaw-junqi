import type { OpenClawConfigSnapshot } from './OpenClawConfigSnapshot';
import type { OpenClawRuntimeLocale } from '@/types/openclawRuntimeLocale';

interface OpenClawRuntimeLocaleConfigClient {
  read(): Promise<OpenClawConfigSnapshot>;
  patch(
    config: Record<string, unknown>,
    snapshot: OpenClawConfigSnapshot,
    replacePaths?: string[],
  ): Promise<void>;
}

export interface OpenClawRuntimeLocaleState {
  locale: OpenClawRuntimeLocale | null;
  rawLocale: string | null;
}

function normalizedLocaleToken(value: string): string {
  return value.trim().split('.')[0]?.split('@')[0]?.replaceAll('_', '-') ?? '';
}

/** 使用 OpenClaw Wizard 的原生归一化规则识别其三种受支持语言。 */
export function resolveOpenClawRuntimeLocale(value: unknown): OpenClawRuntimeLocale | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizedLocaleToken(value).toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (
    normalized === 'zh-tw'
    || normalized === 'zh-hk'
    || normalized === 'zh-mo'
    || normalized.includes('hant')
  ) return 'zh-TW';
  if (
    normalized === 'zh'
    || normalized === 'zh-cn'
    || normalized === 'zh-sg'
    || normalized.includes('hans')
  ) return 'zh-CN';
  return null;
}

export function readOpenClawRuntimeLocaleState(
  snapshot: OpenClawConfigSnapshot,
): OpenClawRuntimeLocaleState {
  const value = snapshot.config.env?.vars?.OPENCLAW_LOCALE;
  const rawLocale = typeof value === 'string' && value.trim() ? value.trim() : null;
  return {
    locale: resolveOpenClawRuntimeLocale(rawLocale),
    rawLocale,
  };
}

/** 读取最新快照后提交最小补丁，避免覆盖同一 Runtime 上的并发配置变更。 */
export async function saveOpenClawRuntimeLocale(
  client: OpenClawRuntimeLocaleConfigClient,
  locale: OpenClawRuntimeLocale,
): Promise<void> {
  const snapshot = await client.read();
  await client.patch({
    env: {
      vars: {
        OPENCLAW_LOCALE: locale,
      },
    },
  }, snapshot);
}
