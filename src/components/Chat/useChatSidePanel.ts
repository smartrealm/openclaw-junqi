import { useCallback, useEffect, useState } from 'react';
import type { ChatMessagePreview } from './chatMessagePreview';

export type ChatSidePanelState =
  | { kind: 'message-preview'; preview: ChatMessagePreview }
  | { kind: 'response-trace'; groupId: string }
  | null;

export function useChatSidePanel(resetKey: string) {
  const [panel, setPanel] = useState<ChatSidePanelState>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const openMessagePreview = useCallback((preview: ChatMessagePreview) => {
    setPanel({ kind: 'message-preview', preview });
  }, []);
  const openResponseTrace = useCallback((groupId: string) => {
    setPanel({ kind: 'response-trace', groupId });
  }, []);

  useEffect(() => {
    closePanel();
  }, [closePanel, resetKey]);

  return { panel, openMessagePreview, openResponseTrace, closePanel };
}
