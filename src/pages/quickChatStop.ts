import { selectSessionRequestActive } from '@/stores/chatStore';

type SessionRequestActivity = Parameters<typeof selectSessionRequestActive>[0];
type AbortChat = (sessionKey: string, sessionId?: string) => Promise<unknown>;

/** Quick Chat uses the same request fence for its visible Stop and window teardown. */
export async function stopQuickChatRequest(
  sessionKey: string,
  sessionId: string | undefined,
  state: SessionRequestActivity,
  abortChat: AbortChat,
): Promise<boolean> {
  if (!selectSessionRequestActive(state, sessionKey)) return false;
  await abortChat(sessionKey, sessionId);
  return true;
}
