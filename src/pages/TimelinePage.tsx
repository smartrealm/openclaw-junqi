// ═══════════════════════════════════════════════════════════
// TimelinePage — task timeline view
//
// Reads tasks from chatStore (current sessions' messages) + workshopStore
// (kanban tasks) and renders them as a unified timeline grouped by day.
//
// Uses the shared TimelineView component (adapted from nezha).
// ═══════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TimelineView, type TimelineTask } from '@/components/shared/TimelineView';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';

function deriveTimelineTasks(): TimelineTask[] {
  const chat = useChatStore.getState();
  const workshop = useWorkshopStore.getState();
  const out: TimelineTask[] = [];

  // Workshop kanban tasks
  for (const task of workshop.tasks) {
    const created = Date.parse(task.createdAt);
    if (Number.isNaN(created)) continue;
    out.push({
      id: `workshop:${task.id}`,
      title: task.title,
      agent: task.assignedAgent,
      status: task.status,
      createdAt: created,
      project: 'Workshop',
    });
  }

  // Chat session user messages (last 100 across all sessions)
  const sessions = chat.sessions ?? [];
  let pushed = 0;
  for (let i = sessions.length - 1; i >= 0 && pushed < 100; i--) {
    const sessionKey = sessions[i].key;
    const msgs = chat.messagesPerSession?.[sessionKey] ?? [];
    for (const msg of msgs) {
      if (msg.role !== 'user') continue;
      const ts = msg.timestamp ? Date.parse(msg.timestamp) : 0;
      if (!ts) continue;
      const text = typeof msg.content === 'string' ? msg.content : '';
      const title = text.trim().split('\n')[0]?.slice(0, 80) || '(empty)';
      out.push({
        id: `chat:${msg.id}`,
        title,
        agent: sessions[i].label,
        status: 'queued',
        createdAt: ts,
        project: sessions[i].label,
      });
      pushed++;
    }
  }

  return out;
}

export function TimelinePage() {
  const { t } = useTranslation();
  const tasks = useMemo(() => deriveTimelineTasks(), []);

  return (
    <TimelineView
      tasks={tasks}
      title={t('timeline.title', 'Timeline')}
      subtitle={t('timeline.subtitle', 'Recent task activity across chat sessions and the workshop kanban.')}
      emptyMessage={t('timeline.empty', 'No tasks in the past 7 days.')}
    />
  );
}

export default TimelinePage;