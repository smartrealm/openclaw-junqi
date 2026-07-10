import { useEffect, useRef } from 'react';
import { QuickChatPage } from './QuickChatPage';
import { gateway } from '@/services/gateway';
import { GatewayClientLease } from '@/services/gateway/GatewayClientLease';
import { useChatStore } from '@/stores/chatStore';

/** Lightweight QuickChat host. It connects to an existing Gateway process but
 * never participates in process detection, startup, recovery, or restart. */
export default function QuickChatRoot() {
  const leaseRef = useRef<GatewayClientLease | null>(null);
  if (!leaseRef.current) leaseRef.current = new GatewayClientLease();

  useEffect(() => {
    const lease = leaseRef.current!;
    gateway.setCallbacks({
      onMessage: (message) => {
        const explicitKey = (message as { sessionKey?: string }).sessionKey;
        useChatStore.getState().addMessage(message, explicitKey);
      },
      onStreamChunk: (sessionKey, messageId, content, media, runId) => {
        useChatStore.getState().updateStreamingMessage(messageId, content, {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(runId ? { runId } : {}),
          responseState: 'streaming',
        }, sessionKey);
      },
      onStreamEnd: (sessionKey, messageId, content, media, meta) => {
        const store = useChatStore.getState();
        store.setIsTyping(false, sessionKey);
        store.finalizeStreamingMessage(messageId, content, {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(meta?.runId ? { runId: meta.runId } : {}),
          responseState: meta?.state ?? 'final',
          ...(meta?.fileRefs ? { fileRefs: meta.fileRefs } : {}),
          ...(meta?.decisionOptions ? { decisionOptions: meta.decisionOptions } : {}),
          ...(meta?.workshopEvents ? { workshopEvents: meta.workshopEvents } : {}),
          ...(meta?.sessionEvents ? { sessionEvents: meta.sessionEvents } : {}),
          ...(meta?.usage ? { usage: meta.usage } : {}),
          ...(meta?.model ? { model: meta.model } : {}),
        }, sessionKey);
      },
      onStatusChange: (status) => useChatStore.getState().setConnectionStatus(status),
      onScopeError: (error) => useChatStore.getState().setConnectionStatus({
        connected: false,
        connecting: false,
        error,
      }),
    });

    void lease.acquire(() => undefined).catch((error) => {
      useChatStore.getState().setConnectionStatus({
        connected: false,
        connecting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => lease.release();
  }, []);

  return <QuickChatPage />;
}
