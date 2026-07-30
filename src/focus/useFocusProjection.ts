import { useMemo } from 'react';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { useFocusContextStore } from '@/stores/focusContextStore';
import { useTaskBriefStore } from '@/stores/taskBriefStore';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';
import { projectFocusContext } from './focusContext';

export function useFocusProjection() {
  const focus = useFocusContextStore((state) => state.focus);
  const agentTasks = useAgentWorkspaceStore((state) => state.tasks);
  const sessions = useChatStore((state) => state.sessions);
  const typing = useChatStore((state) => state.typingBySession);
  const thinking = useChatStore((state) => state.thinkingBySession);
  const sending = useChatStore((state) => state.sendingBySession);
  const worktrees = useWorkbenchStore((state) => state.worktrees);
  const briefs = useTaskBriefStore((state) => state.briefs);
  const activeChatSessionKeys = useMemo(() => new Set(
    Object.keys({ ...typing, ...thinking, ...sending })
      .filter((key) => typing[key] || thinking[key] || sending[key]),
  ), [sending, thinking, typing]);
  return useMemo(() => projectFocusContext(focus, {
    agentTasks,
    chatSessions: sessions,
    activeChatSessionKeys,
    worktrees: Object.values(worktrees),
    taskBriefs: briefs,
  }), [activeChatSessionKeys, agentTasks, briefs, focus, sessions, worktrees]);
}
