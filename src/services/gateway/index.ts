// ═══════════════════════════════════════════════════════════
// Gateway Service — Public API Facade
// Wires Connection + ChatHandler into a single interface.
// Backward-compatible with: import { gateway } from '@/services/gateway'
// ═══════════════════════════════════════════════════════════

import { GatewayConnection, type GatewayCallbacks, type ChatMessage, type MediaInfo } from './Connection';
import { ChatHandler } from './ChatHandler';

// Re-export types for consumers
export type { ChatMessage, MediaInfo, GatewayCallbacks };

// ── Create instances ──
const connection = new GatewayConnection();
const chatHandler = new ChatHandler(connection);

// Wire event handler: Connection dispatches events to ChatHandler
connection.onEvent = (msg: any) => chatHandler.handleEvent(msg);

// ── Public API (matches original gateway.ts exactly) ──
export const gateway = {
  // Setup
  setCallbacks(cb: GatewayCallbacks) { connection.setCallbacks(cb); },

  // Connection
  connect(url: string, token: string) { connection.connect(url, token); },
  disconnect() { connection.disconnect(); },
  getStatus() { return connection.getStatus(); },
  getLastError() { return connection.getLastError(); },

  // Messaging
  async sendMessage(message: string, attachments?: any[], sessionKey = 'agent:main:main') {
    // Inject Desktop context with first message
    const finalMessage = chatHandler.injectDesktopContext(message);

    // Queue if disconnected
    if (!connection.isConnected()) {
      connection.enqueueMessage(finalMessage, attachments, sessionKey);
      return { queued: true, queueSize: connection.getQueueSize() };
    }

    // Build attachments
    const gwAttachments = attachments?.map((att) => {
      let rawBase64 = att.content || '';
      if (rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      }
      return {
        type: att.mimeType?.startsWith('image/') ? 'image' : 'file',
        mimeType: att.mimeType,
        content: rawBase64,
        fileName: att.fileName || 'file',
      };
    });

    // Enable reasoning stream lazily only when the user actually sends a message.
    await connection.ensureReasoningStream(sessionKey);

    return connection.request('chat.send', {
      sessionKey,
      message: finalMessage,
      idempotencyKey: `aegis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(gwAttachments?.length ? { attachments: gwAttachments } : {}),
    });
  },

  // Sessions & Agents
  async getSessions() { return connection.request('sessions.list', {}); },
  async getAgents() { return connection.request('agents.list', {}); },
  async createAgent(agent: any) { return connection.request('agents.create', agent); },
  async updateAgent(agentId: string, patch: any) { return connection.request('agents.update', { agentId, ...patch }); },
  async deleteAgent(agentId: string) { return connection.request('agents.delete', { agentId }); },

  // History & Abort
  async getHistory(sessionKey: string, limit = 200, timeoutMs = 15_000) {
    return connection.request('chat.history', { sessionKey, limit }, { timeoutMs });
  },
  async abortChat(sessionKey = 'agent:main:main') { return connection.request('chat.abort', { sessionKey }); },

  // Session Lifecycle
  async deleteSession(sessionKey: string, deleteTranscript = true) {
    const result = await connection.request('sessions.delete', { key: sessionKey, deleteTranscript });
    if (result?.success === false) return result;
    try {
      await Promise.allSettled([
        window.aegis?.uploads?.cleanupSession?.({ sessionKey }),
        window.aegis?.managedFiles?.cleanupSessionRefs?.({ sessionKey, kind: 'outputs' }),
        window.aegis?.voice?.cleanupSession?.({ sessionKey }),
      ]);
    } catch {}
    return result;
  },
  async resetSession(sessionKey: string) {
    const result = await connection.request('sessions.reset', { key: sessionKey });
    if (result?.success === false) return result;
    try {
      await Promise.allSettled([
        window.aegis?.uploads?.cleanupSession?.({ sessionKey }),
        window.aegis?.managedFiles?.cleanupSessionRefs?.({ sessionKey, kind: 'outputs' }),
        window.aegis?.voice?.cleanupSession?.({ sessionKey }),
      ]);
    } catch {}
    return result;
  },

  // Session Settings
  async setSessionModel(model: string, sessionKey = 'agent:main:main') {
    return connection.request('sessions.patch', { key: sessionKey, model });
  },
  async setSessionThinking(level: string | null, sessionKey = 'agent:main:main') {
    return connection.request('sessions.patch', { key: sessionKey, thinkingLevel: level });
  },
  async setSessionLabel(label: string | null, sessionKey = 'agent:main:main') {
    return connection.request('sessions.patch', { key: sessionKey, label });
  },
  // Inject a per-session system prompt (persona). Backend may not yet support
  // `systemPrompt` in sessions.patch; callers should `.catch(console.warn)`
  // and let the session open normally without the persona in that case.
  async setSessionPersona(systemPrompt: string | null, sessionKey = 'agent:main:main') {
    return connection.request('sessions.patch', { key: sessionKey, systemPrompt });
  },
  async updateAgentParams(agentId: string, params: Record<string, any>) {
    return connection.request('agents.update', { agentId, params });
  },

  // Models & Usage
  async getSessionStatus(sessionKey = 'agent:main:main') { return connection.request('sessions.list', {}); },
  async getAvailableModels() { return connection.request('models.list', {}); },
  async call(method: string, params: any = {}) { return connection.request(method, params); },
  // Skills — list installed skills with status (input for the @skill picker)
  async getSkills(agentId?: string) { return connection.request('skills.status', agentId ? { agentId } : {}); },
  async getCostSummary(days = 30) { return connection.request('usage.cost', { days }); },
  async getSessionsUsage(params: any = {}) { return connection.request('sessions.usage', { limit: 50, ...params }); },
  async getSessionTimeseries(key: string) { return connection.request('sessions.usage.timeseries', { key }); },
  async getSessionLogs(key: string, limit = 200) { return connection.request('sessions.usage.logs', { key, limit }); },

  // Queue
  getQueueSize() { return connection.getQueueSize(); },

  // Pairing
  getHttpBaseUrl() { return connection.getHttpBaseUrl(); },
  getToken() { return connection.token; },
  stopPairingRetry() { connection.stopPairingRetry(); },
  async requestPairing() { return connection.requestPairing(); },
  async pollPairingStatus(deviceId: string) { return connection.pollPairingStatus(deviceId); },
  reconnectWithToken(newToken: string) { connection.reconnectWithToken(newToken); },
};
