import type { useChatStore } from './chatStore';

type ChatState = ReturnType<typeof useChatStore.getState>;

export function selectAppChatRuntime(state: ChatState) {
  return {
    addMessage: state.addMessage,
    updateStreamingMessage: state.updateStreamingMessage,
    finalizeStreamingMessage: state.finalizeStreamingMessage,
    setConnectionStatus: state.setConnectionStatus,
    settleSessionRunUi: state.settleSessionRunUi,
    incrementSessionUnread: state.incrementSessionUnread,
    markSessionCompleted: state.markSessionCompleted,
    setSessions: state.setSessions,
    setAvailableModels: state.setAvailableModels,
    setSessionAvailableModels: state.setSessionAvailableModels,
    setSessionModelsLoading: state.setSessionModelsLoading,
    clearSessionAvailableModels: state.clearSessionAvailableModels,
    setDefaultMainSessionKey: state.setDefaultMainSessionKey,
  };
}

export function selectMessageInputRuntime(state: ChatState) {
  return {
    setIsSending: state.setIsSending,
    connected: state.connected,
    activeSessionKey: state.activeSessionKey,
    messageCount: state.messages.length,
    historyLoader: state.historyLoader,
  };
}
