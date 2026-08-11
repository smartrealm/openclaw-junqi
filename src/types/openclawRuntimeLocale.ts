export const OPENCLAW_RUNTIME_LOCALES = ['en', 'zh-CN', 'zh-TW'] as const;

export type OpenClawRuntimeLocale = typeof OPENCLAW_RUNTIME_LOCALES[number];

export interface OpenClawRuntimeLanguageMessage {
  kind: 'success' | 'error' | 'notice';
  text: string;
}
