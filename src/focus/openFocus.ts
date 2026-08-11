import type { FocusContext } from './focusContext';
import { focusNavigationTarget } from './focusContext';
import { useChatStore } from '@/stores/chatStore';

export function prepareFocusNavigation(context: FocusContext): string | null {
  const route = focusNavigationTarget(context);
  if (!route) return null;
  const store = useChatStore.getState();
  if (!store.sessions.some((session) => session.key === context.target.id)) return null;
  store.openTab(context.target.id);
  return route;
}
