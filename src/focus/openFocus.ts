import type { FocusContext } from './focusContext';
import { focusNavigationTarget } from './focusContext';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { useTaskBriefStore } from '@/stores/taskBriefStore';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';

/**
 * Reconciles the source authority before navigating. Consumers in TopBar and
 * auxiliary windows use this same coordinator so a route never opens with a
 * different task/session/worktree selected.
 */
export function prepareFocusNavigation(context: FocusContext): string | null {
  const route = focusNavigationTarget(context);
  if (!route) return null;
  if (context.target.kind === 'agent-task') {
    const store = useAgentWorkspaceStore.getState();
    if (!store.tasks.some((task) => task.id === context.target.id)) return null;
    store.selectTask(context.target.id);
    return route;
  }
  if (context.target.kind === 'chat-session') {
    const store = useChatStore.getState();
    if (!store.sessions.some((session) => session.key === context.target.id)) return null;
    store.openTab(context.target.id);
    return route;
  }
  if (context.target.kind === 'worktree') {
    const store = useWorkbenchStore.getState();
    if (!store.worktrees[context.target.id]) return null;
    store.activateWorktree(context.target.id);
    return route;
  }
  const store = useTaskBriefStore.getState();
  if (!store.briefs.some((brief) => brief.id === context.target.id)) return null;
  store.selectBrief(context.target.id);
  return route;
}

