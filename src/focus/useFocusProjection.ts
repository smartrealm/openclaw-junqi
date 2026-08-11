import { useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useFocusContextStore } from '@/stores/focusContextStore';
import { projectFocusContext } from './focusContext';

export function useFocusProjection() {
  const focus = useFocusContextStore((state) => state.focus);
  const sessions = useChatStore((state) => state.sessions);
  const typing = useChatStore((state) => state.typingBySession);
  const thinking = useChatStore((state) => state.thinkingBySession);
  const sending = useChatStore((state) => state.sendingBySession);
  const activeChatSessionKeys = useMemo(() => new Set(
    Object.keys({ ...typing, ...thinking, ...sending })
      .filter((key) => typing[key] || thinking[key] || sending[key]),
  ), [sending, thinking, typing]);
  return useMemo(() => projectFocusContext(focus, {
    chatSessions: sessions,
    activeChatSessionKeys,
  }), [activeChatSessionKeys, focus, sessions]);
}
