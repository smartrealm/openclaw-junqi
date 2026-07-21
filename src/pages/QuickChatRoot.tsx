import { useEffect, useRef, useState } from 'react';
import { QuickChatPage } from './QuickChatPage';
import { gateway } from '@/services/gateway';
import { GatewayClientLease } from '@/services/gateway/GatewayClientLease';
import { useChatStore } from '@/stores/chatStore';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';

/** Quick Chat owns one generated session and must not speak main-window events. */
export function isOwnedQuickChatSession(sessionKey: string, ownedSessionKey: string): boolean {
  return sessionKey.startsWith('quickchat:') && sessionKey === ownedSessionKey;
}

/** Lightweight QuickChat host. It connects to an existing Gateway process but
 * never participates in process detection, startup, recovery, or restart. */
export default function QuickChatRoot() {
  const leaseRef = useRef<GatewayClientLease | null>(null);
  const [sessionKey] = useState(() => `quickchat:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
  if (!leaseRef.current) leaseRef.current = new GatewayClientLease();

  useEffect(() => {
    const lease = leaseRef.current!;
    gateway.setCallbacks({
      onMessage: (message) => {
        const explicitKey = (message as { sessionKey?: string }).sessionKey;
        if (!explicitKey) return;
        if (!isOwnedQuickChatSession(explicitKey, sessionKey)) return;
        useChatStore.getState().addMessage(message, explicitKey);
        if (message.role === 'assistant') {
          voiceRuntime.speakMessage(explicitKey, message.content, (message as any).mediaUrl);
        }
      },
      onStreamChunk: (eventSessionKey, messageId, content, media, runId) => {
        if (!isOwnedQuickChatSession(eventSessionKey, sessionKey)) return;
        voiceRuntime.consumeStream(eventSessionKey, content, messageId, media?.mediaUrl);
        useChatStore.getState().updateStreamingMessage(messageId, content, {
          ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
          ...(runId ? { runId } : {}),
          responseState: 'streaming',
        }, eventSessionKey);
      },
      onStreamEnd: (eventSessionKey, messageId, content, media, meta) => {
        if (!isOwnedQuickChatSession(eventSessionKey, sessionKey)) return;
        voiceRuntime.finishStream(eventSessionKey, content, meta?.state ?? 'final', messageId, media?.mediaUrl);
        const store = useChatStore.getState();
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
        }, eventSessionKey);
        store.setIsTyping(false, eventSessionKey);
      },
      onStatusChange: (status) => {
        if (!status.connected && !status.connecting) {
          voiceRuntime.interruptAll({ broadcast: false, preserveRemote: true });
        }
        useChatStore.getState().setConnectionStatus(status);
        if (status.connected) {
          const store = useChatStore.getState();
          if ((store.messageQueue[sessionKey]?.length ?? 0) > 0 && !store.typingBySession[sessionKey]) {
            void store.drainQueue(sessionKey);
          }
        }
      },
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
    const unsubscribeQueue = useChatStore.subscribe((state, previous) => {
      if (
        previous.typingBySession[sessionKey] === true
        && state.typingBySession[sessionKey] === false
        && (state.messageQueue[sessionKey]?.length ?? 0) > 0
      ) {
        void state.drainQueue(sessionKey);
      }
    });
    return () => {
      unsubscribeQueue();
      voiceRuntime.interrupt(sessionKey);
      const store = useChatStore.getState();
      store.clearQueue(sessionKey);
      if (store.typingBySession[sessionKey]) {
        void gateway.abortChat(sessionKey).catch(() => undefined).finally(() => lease.release());
      } else {
        lease.release();
      }
    };
  }, [sessionKey]);

  return <QuickChatPage sessionKey={sessionKey} />;
}
