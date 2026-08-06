import { isWeakSessionTopic } from '@/stores/chatStore';
import { isAgentMainSession } from '@/utils/sessionLifecycle';

type SessionLike = {
  key?: string;
  topic?: string;
  lastMessage?: string | { content?: string };
  label?: string;
  initialLabel?: string;
};

function normalizeText(value?: string): string {
  return String(value ?? '').trim();
}

export function getSessionDisplayLabel(
  session: SessionLike | undefined,
  options?: { mainSessionLabel?: string; genericSessionLabel?: string },
): string {
  const key = normalizeText(session?.key);
  const mainSessionLabel = options?.mainSessionLabel ?? 'Main Session';
  const genericSessionLabel = options?.genericSessionLabel ?? 'Session';

  if (!key) return genericSessionLabel;

  // Gateway label 是会话权威名称。仅 JunQi 创建时留下的默认名称在首条
  // 消息出现后让位给消息主题；手动重命名和 Gateway 标签变化都会清除标记。
  const label = normalizeText(session?.label);
  const initialLabel = normalizeText(session?.initialLabel);
  if (label && (!initialLabel || label !== initialLabel)) return label;

  // 只有 Gateway 未提供 label 时才使用展示回退。
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
