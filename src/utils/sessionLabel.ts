import { isWeakSessionTopic } from '@/stores/chatStore';
import { isGatewayMainSession } from '@/utils/sessionLifecycle';

type SessionLike = {
  key?: string;
  derivedTitle?: string;
  displayName?: string;
  lastMessagePreview?: string;
  topic?: string;
  lastMessage?: string | { content?: string };
  label?: string;
};

export interface SessionDisplayLabelOptions {
  readonly mainSessionLabel: string;
  readonly genericSessionLabel: string;
  /** Gateway 路由规则解析出的完整默认主会话 key，缺失时不把任意 `:main` 当作全局主会话。 */
  readonly mainSessionKey?: string | null;
  /** Read-only transcript preview when the Gateway has not named the session. */
  readonly messageFallback?: string;
}

function normalizeText(value?: string): string {
  return String(value ?? '').trim();
}

function summarizeFallback(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || isWeakSessionTopic(normalized)) return '';
  return normalized.slice(0, 32);
}

export function getSessionDisplayLabel(
  session: SessionLike | undefined,
  options: SessionDisplayLabelOptions,
): string {
  const key = normalizeText(session?.key);
  const { mainSessionLabel, genericSessionLabel, messageFallback } = options;

  if (!key) return genericSessionLabel;

  // Gateway label is authoritative. Presentation fallbacks never overwrite it.
  const label = normalizeText(session?.label);
  if (label) return label;

  const derivedTitle = normalizeText(session?.derivedTitle);
  if (derivedTitle) return derivedTitle;

  const displayName = normalizeText(session?.displayName);
  if (displayName) return displayName;

  const topic = normalizeText(session?.topic);
  if (topic && !isWeakSessionTopic(topic)) return topic;

  const explicitFallback = summarizeFallback(normalizeText(messageFallback));
  if (explicitFallback) return explicitFallback;

  const officialPreview = summarizeFallback(normalizeText(session?.lastMessagePreview));
  if (officialPreview) return officialPreview;

  const rawLastMessage = session?.lastMessage;
  const lastMessage = summarizeFallback(normalizeText(
    typeof rawLastMessage === 'string' ? rawLastMessage : rawLastMessage?.content,
  ));
  if (lastMessage) return lastMessage;

  // 只有 Gateway 明确返回的主会话才能使用主会话展示名。
  if (isGatewayMainSession(key, options.mainSessionKey)) return mainSessionLabel;

  const lastKeyPart = key.split(':').pop() || key;
  if (/^desktop-[a-z0-9-]+$/i.test(lastKeyPart)) return genericSessionLabel;
  return lastKeyPart;
}
