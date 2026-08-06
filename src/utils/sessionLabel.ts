import { isWeakSessionTopic } from '@/stores/chatStore';
import { isAgentMainSession } from '@/utils/sessionLifecycle';

type SessionLike = {
  key?: string;
  topic?: string;
  lastMessage?: string | { content?: string };
  label?: string;
};

export interface SessionDisplayLabelOptions {
  readonly mainSessionLabel: string;
  readonly genericSessionLabel: string;
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

  const topic = normalizeText(session?.topic);
  if (topic && !isWeakSessionTopic(topic)) return topic;

  const explicitFallback = summarizeFallback(normalizeText(messageFallback));
  if (explicitFallback) return explicitFallback;

  const rawLastMessage = session?.lastMessage;
  const lastMessage = summarizeFallback(normalizeText(
    typeof rawLastMessage === 'string' ? rawLastMessage : rawLastMessage?.content,
  ));
  if (lastMessage) return lastMessage;

  // Only an unnamed canonical main session uses the agent-provided fallback.
  if (isAgentMainSession(key)) return mainSessionLabel;

  const lastKeyPart = key.split(':').pop() || key;
  if (/^desktop-[a-z0-9-]+$/i.test(lastKeyPart)) return genericSessionLabel;
  return lastKeyPart;
}
