import { isWeakSessionTopic } from '@/stores/chatStore';
import { isAgentMainSession } from '@/utils/sessionLifecycle';

type SessionLike = {
  key?: string;
  topic?: string;
  lastMessage?: string | { content?: string };
  label?: string;
};

function normalizeText(value?: string): string {
  return String(value ?? '').trim();
}

/**
 * Returns true when `session.label` looks like a gateway default (i.e. the
 * openclaw side stamped it on a fresh session, the user never edited it).
 * Used to short-circuit auto-derived labels so a real rename isn't
 * shadowed by a stale placeholder.
 */
function isGatewayDefaultLabel(label: string, key: string): boolean {
  if (!label || !key) return true;
  if (label === key) return true;
  if (/^desktop-[a-z0-9-]+$/i.test(label)) return true;
  // English / Chinese / Arabic gateway defaults
  if (/^(main session|主智能体|new session|新会话|default session|untitled)$/i.test(label)) return true;
  return false;
}

export function getSessionDisplayLabel(
  session: SessionLike | undefined,
  options?: { mainSessionLabel?: string; genericSessionLabel?: string },
): string {
  const key = normalizeText(session?.key);
  const mainSessionLabel = options?.mainSessionLabel ?? 'Main Session';
  const genericSessionLabel = options?.genericSessionLabel ?? 'Session';

  if (!key) return genericSessionLabel;

  // The main session is identified by key, not by label. We still allow
  // user renames to surface here so "我的主会话" doesn't get clobbered
  // by the gateway's hardcoded "Main Session" placeholder.
  const label = normalizeText(session?.label);
  if (label && !isGatewayDefaultLabel(label, key)) return label;

  // Auto-derived fallbacks only kick in when the user hasn't renamed.
  if (isAgentMainSession(key)) return mainSessionLabel;

  const topic = normalizeText(session?.topic);
  if (topic && !isWeakSessionTopic(topic)) return topic;

  const rawLastMessage = session?.lastMessage;
  const lastMessage = normalizeText(
    typeof rawLastMessage === 'string' ? rawLastMessage : rawLastMessage?.content,
  );
  if (lastMessage && !isWeakSessionTopic(lastMessage)) return lastMessage.slice(0, 32);

  const lastKeyPart = key.split(':').pop() || key;
  if (/^desktop-[a-z0-9-]+$/i.test(lastKeyPart)) return genericSessionLabel;
  return lastKeyPart;
}
