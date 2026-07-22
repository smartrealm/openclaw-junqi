import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('CHAT-01 generated artifacts never receive iframe script permission', () => {
  const bubble = source('src/components/Chat/MessageBubble.tsx');
  const resultCards = source('src/components/Chat/ResultCards.tsx');
  assert.doesNotMatch(bubble, /sandbox=["']allow-scripts/);
  assert.doesNotMatch(resultCards, /sandbox=["']allow-scripts/);
  assert.match(bubble, /useState<'preview' \| 'source'>\('source'\)/);
  const config = JSON.parse(source('src-tauri/tauri.conf.json'));
  assert.equal(typeof config.app.security.csp, 'string');
  assert.match(config.app.security.csp, /script-src 'self'/);
});

test('CHAT-03 composer state and prepared attachments are keyed by session', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const store = source('src/stores/chatStore.ts');
  assert.match(input, /s\.drafts\[activeSessionKey\]/);
  assert.match(input, /s\.preparedAttachments\[activeSessionKey\]/);
  assert.match(input, /const sendSessionKey = activeSessionKey/);
  assert.match(store, /preparedAttachments: Record<string, PreparedAttachment\[\]>/);
  assert.match(store, /sendingBySession: Record<string, boolean>/);
  assert.match(store, /loadingHistoryBySession: Record<string, boolean>/);
});

test('CHAT-02 and CHAT-10 expose one cancellable queue and preserve transcript semantics', () => {
  const connection = source('src/services/gateway/Connection.ts');
  const send = source('src/services/chat/sendTransaction.ts');
  const view = source('src/components/Chat/ChatView.tsx');
  const bubble = source('src/components/Chat/MessageBubble.tsx');
  const app = source('src/App.tsx');
  assert.doesNotMatch(connection, /enqueueMessage|flushQueue|getQueueSize/);
  assert.match(send, /sessionMutationGate\.isBlocked/);
  assert.match(view, /handleRecallMessage/);
  assert.doesNotMatch(view, /handleEditMessage|handleRegenerate|onDelete=/);
  assert.doesNotMatch(bubble, /onRegenerate|onDelete\?|isEditing/);
  const streamEnd = app.slice(
    app.indexOf('onStreamEnd:'),
    app.indexOf('onRetryState:'),
  );
  assert.ok(
    streamEnd.indexOf('finalizeStreamingMessage(') < streamEnd.indexOf('settleSessionRunUi(sessionKey)'),
    'the current response must finalize before the queue is released',
  );
});

test('CHAT-05 forced history refreshes queue behind the active request', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  assert.match(view, /queuedForcedHistoryBySession/);
  assert.match(view, /await inFlightHistoryBySession\.current\[sessionKey\]/);
  assert.match(view, /await loadHistory\(sessionKey, queued\)/);
});

test('CHAT-06 history pagination uses chat.history offsets only', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  assert.doesNotMatch(view, /fetchSessionHistoryPage|nextCursor/);
  assert.match(view, /\{ offset: requestedOffset \}/);
  assert.match(view, /resolveHistoryPageMetadata/);
});

test('CHAT-07 persona never calls unsupported sessions.patch systemPrompt', () => {
  const gateway = source('src/services/gateway/index.ts');
  const tabs = source('src/components/Chat/ChatTabs.tsx');
  assert.doesNotMatch(gateway, /setSessionPersona|systemPrompt/);
  assert.match(tabs, /applyPersonaToSessionDraft/);
});

test('CHAT-08 Gateway sends user-authored text without private context injection', () => {
  const gateway = source('src/services/gateway/index.ts');
  assert.doesNotMatch(gateway, /injectDesktopContext|OPENCLAW_DESKTOP_CONTEXT|finalMessage/);
  assert.match(gateway, /message,\n\s+idempotencyKey/);
});

test('CHAT-09 voice paths use an official attachment and never truncated base64 text', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  assert.doesNotMatch(input, /substring\(0,\s*50\)|\[voice:[^\]]*:base64\]/);
  assert.match(input, /toGatewayAttachments\(\[createPreparedAttachment\(\{/);
  const adapter = source('src/api/tauri-adapter.ts');
  assert.match(adapter, /mkdir\(voiceDir, \{ recursive: true \}\)/);
});

test('CHAT-11 truncated history has a chat.message.get recovery action', () => {
  const gateway = source('src/services/gateway/index.ts');
  const view = source('src/components/Chat/ChatView.tsx');
  assert.match(gateway, /connection\.request\('chat\.message\.get'/);
  assert.match(view, /handleLoadFullMessage/);
});

test('React external-store selectors never allocate empty fallback snapshots', () => {
  const quickChat = source('src/pages/QuickChatPage.tsx');
  const welcome = source('src/components/shared/WelcomePage.tsx');
  const sidebar = source('src/components/Layout/NavSidebar.tsx');
  const sidebarPanels = source('src/components/Layout/NavSidebarPanels.tsx');
  assert.match(quickChat, /const EMPTY_MESSAGES:/);
  assert.match(quickChat, /const EMPTY_QUEUE:/);
  assert.match(quickChat, /retryQueuedMessage/);
  for (const candidate of [welcome, sidebar, sidebarPanels]) {
    assert.doesNotMatch(candidate, /use(?:Chat|GatewayData)Store\([^\n]+\?\?\s*(?:\[\]|\{\})/);
  }
});
