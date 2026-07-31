import { useCallback, useEffect, useState } from 'react';
import type { ChatMessagePreview } from './chatMessagePreview';

export type ChatSidePanelState =
  | { kind: 'message-preview'; preview: ChatMessagePreview }
  | { kind: 'response-trace'; groupId: string }
  | { kind: 'trace-source-message'; groupId: string; sourceMessageId: string }
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
  const openTraceSourceMessage = useCallback((groupId: string, sourceMessageId: string) => {
    setPanel({ kind: 'trace-source-message', groupId, sourceMessageId });
  }, []);

  useEffect(() => {
    closePanel();
  }, [closePanel, resetKey]);

  return { panel, openMessagePreview, openResponseTrace, openTraceSourceMessage, closePanel };
}
