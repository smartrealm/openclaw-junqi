// ═══════════════════════════════════════════════════════════
// ChatPage — Multi-session chat with tab bar
// ═══════════════════════════════════════════════════════════

import { ChatTabs } from '@/components/Chat/ChatTabs';
import { ChatView } from '@/components/Chat/ChatView';
import { SessionContextBar } from '@/components/Chat/SessionContextBar';
import { useAgentScopedSession } from '@/hooks/useAgentScopedSession';

export function ChatPage() {
  // Check for ?agent=<id>&new=1 and create a fresh per-agent session
  // before the first paint — the user sees their agent-scoped chat
  // instantly rather than landing on the main session first.
  useAgentScopedSession();

  return (
    <div className="flex flex-col h-full">
      <SessionContextBar />
      <ChatTabs />
      <ChatView />
    </div>
  );
}
