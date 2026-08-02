import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('CHAT-01 generated artifacts stay scriptless while local file previews use the scoped protocol', () => {
  const bubble = source('src/components/Chat/MessageBubble.tsx');
  const resultCards = source('src/components/Chat/ResultCards.tsx');
  const managedPreview = source('src/components/FileExplorer/ManagedFilePreview.tsx');
  const previewProtocol = source('src-tauri/src/commands/file_preview.rs');
  assert.doesNotMatch(bubble, /sandbox=["']allow-scripts/);
  assert.match(bubble, /srcDoc=\{artifact\.content\}[\s\S]*?sandbox=""/);
  assert.match(managedPreview, /src=\{preview\.mode === 'interactive' \? preview\.url/);
  assert.match(managedPreview, /sandbox=\{preview\.mode === 'interactive' \? 'allow-scripts' : ''\}/);
  assert.match(resultCards, /loadLocalFilePreview\(path, name, workspaceRoot\)/);
  assert.match(previewProtocol, /PREVIEW_GRANT_TTL/);
  assert.match(previewProtocol, /resolve_granted_path/);
  assert.match(previewProtocol, /connect-src 'self'/);
  assert.match(bubble, /useState<'preview' \| 'source'>\('source'\)/);
  const config = JSON.parse(source('src-tauri/tauri.conf.json'));
  assert.equal(typeof config.app.security.csp, 'string');
  assert.match(config.app.security.csp, /script-src 'self'/);
  assert.match(config.app.security.csp, /frame-src[^;]*junqi-preview/);
});

test('CHAT-12 file result rows keep full paths out of the default chat layout', () => {
  const resultCards = source('src/components/Chat/ResultCards.tsx');
  assert.match(resultCards, /getFileParentFolder\(path \|\| file\.path\)/);
  assert.match(resultCards, /max-w-\[760px\]/);
  assert.doesNotMatch(resultCards, /\{detail \|\| path\}/);
});

test('assistant Markdown typography scales with the available viewport', () => {
  const bubble = source('src/components/Chat/MessageBubble.tsx');
  const styles = source('src/styles/index.css');
  assert.match(bubble, /!isUser && 'assistant-markdown-body'/);
  assert.match(styles, /\.assistant-markdown-body\s*\{[\s\S]*?font-size:\s*clamp\(/);
  assert.doesNotMatch(styles, /\.assistant-markdown-body[^}]*font-weight/);
});

test('CHAT-14 persisted OpenClaw media uses a state-scoped preview bridge', () => {
  const image = source('src/components/Chat/ChatImage.tsx');
  const mediaPreview = source('src/services/chat/openclawMediaPreview.ts');
  const commands = source('src/api/tauri-commands.ts');
  const previewCommand = source('src-tauri/src/commands/openclaw_media_preview.rs');
  assert.match(image, /resolveOpenClawMediaPreviewUrl\(src\)/);
  assert.doesNotMatch(image, /window\.aegis\?\.openclawMedia/);
  assert.match(mediaPreview, /createOpenClawMediaPreviewUrl/);
  assert.match(commands, /create_openclaw_media_preview_url/);
  assert.match(previewCommand, /media_state_dirs_for_preview/);
  assert.match(previewCommand, /create_exact_preview_url_for_file/);
  assert.match(previewCommand, /outside the active OpenClaw media directory/);
  const config = JSON.parse(source('src-tauri/tauri.conf.json'));
  assert.match(config.app.security.csp, /connect-src[^;]*junqi-preview/);
});

test('CHAT-17 native file actions never fall back to the retired uploads bridge', () => {
  const resultCards = source('src/components/Chat/ResultCards.tsx');
  const markdown = source('src/components/Chat/ChatMarkdownRenderer.tsx');
  const gateway = source('src/services/gateway/index.ts');
  assert.doesNotMatch(resultCards, /uploads\?\.(?:open|reveal)/);
  assert.doesNotMatch(markdown, /uploads\?\.open/);
  assert.doesNotMatch(gateway, /uploads\?\.cleanupSession/);
});

test('CHAT-03 composer state and prepared attachments are keyed by session', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const attachments = source('src/components/Chat/message-input/useComposerAttachments.ts');
  const send = source('src/components/Chat/message-input/useMessageSend.ts');
  const store = source('src/stores/chatStore.ts');
  assert.match(input, /drafts\[activeSessionKey\]/);
  assert.match(attachments, /preparedAttachments\[activeSessionKey\]/);
  assert.match(send, /const sessionKey = activeSessionKey/);
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
  assert.doesNotMatch(view, /handleRecallMessage|setDraft\(activeSessionKey, content\)/);
  assert.match(view, /localUserMessageCapabilities\(sourceMessage\)/);
  assert.match(view, /handleEditFailedMessage/);
  assert.match(view, /handleDeleteLocalMessage/);
  assert.match(bubble, /InlineUserMessageEditor/);
  assert.match(bubble, /<Trash2 size=\{14\}/);
  const streamEnd = app.slice(
    app.indexOf('onStreamEnd:'),
    app.indexOf('onRetryState:'),
  );
  assert.ok(
    streamEnd.indexOf('finalizeStreamingMessage(') < streamEnd.indexOf('settleSessionRunUi(sessionKey)'),
    'the current response must finalize before the queue is released',
  );
});

test('CHAT-15 never claims durable per-message mutation support from OpenClaw', () => {
  const gateway = source('src/services/gateway/index.ts');
  const policy = source('src/components/Chat/localUserMessageMutations.ts');
  assert.doesNotMatch(gateway, /chat\.message\.(?:edit|delete)|messages\.(?:edit|delete)/);
  assert.match(policy, /!message\.nativeMessageId/);
  assert.match(policy, /message\?\.status === 'failed'/);
});

test('CHAT-05 forced history refreshes queue behind the active request', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  assert.match(view, /queuedForcedHistoryBySession/);
  assert.match(view, /await inFlightHistoryBySession\.current\[sessionKey\]/);
  assert.match(view, /await loadHistory\(sessionKey, queued\)/);
});

test('CHAT-16 every detached history load stays in the recoverable chat surface', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  const app = source('src/App.tsx');
  assert.doesNotMatch(view, /void loadHistory\(/);
  assert.match(view, /startRecoverableTask\([\s\S]*?\(\) => loadHistory\(\)/);
  assert.equal(
    [...view.matchAll(/\(\) => loadHistory\(sessionKey, \{ force: true, background: true \}\)/g)].length,
    3,
  );
  assert.match(view, /Manual reconnect failed/);
  assert.doesNotMatch(app, /void historyLoader\(/);
  assert.match(app, /startRecoverableTask\([\s\S]*?\(\) => historyLoader\(/);
  assert.match(app, /onTranscriptChanged:[\s\S]*?refreshDurableTranscript\(sessionKey\)/);
});

test('CHAT-06 history pagination uses chat.history offsets only', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  assert.doesNotMatch(view, /fetchSessionHistoryPage|nextCursor/);
  assert.match(view, /\{ offset: requestedOffset \}/);
  assert.match(view, /resolveHistoryPageMetadata/);
});

test('ChatView does not retain an unmounted Virtuoso header', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  assert.doesNotMatch(view, /const Header = useCallback/);
  assert.doesNotMatch(view, /chat\.historyExhausted/);
});

test('CHAT-07 persona never calls unsupported sessions.patch systemPrompt', () => {
  const gateway = source('src/services/gateway/index.ts');
  const tabs = source('src/components/Chat/ChatTabs.tsx');
  assert.doesNotMatch(gateway, /setSessionPersona|systemPrompt/);
  assert.match(tabs, /applyPersonaToSessionDraft/);
});

test('agent status cards are available to every canonical Agent session', () => {
  const tabs = source('src/components/Chat/ChatTabs.tsx');
  const tooltip = tabs.slice(
    tabs.indexOf('function AgentStatusTooltip'),
    tabs.indexOf('// ═══════════════════════════════════════════════════════════\n// New Session Picker'),
  );
  assert.match(tabs, /data-agent-status-tab=\{isMainSession \? key : undefined\}/);
  assert.match(tabs, /onMouseEnter=\{isMainSession \?/);
  assert.match(tabs, /resolveAgentStatusSnapshot\(\{/);
  assert.doesNotMatch(tooltip, /agent:main:main/);
  assert.doesNotMatch(tooltip, /useGatewayDataStore/);
});

test('CHAT-08 Gateway sends user-authored text without private context injection', () => {
  const gateway = source('src/services/gateway/index.ts');
  assert.doesNotMatch(gateway, /injectDesktopContext|OPENCLAW_DESKTOP_CONTEXT|finalMessage/);
  assert.match(gateway, /message,\n\s+idempotencyKey/);
});

test('CHAT-09 voice paths use an official attachment and never truncated base64 text', () => {
  const voice = source('src/components/Chat/message-input/useComposerVoice.ts');
  assert.doesNotMatch(voice, /substring\(0,\s*50\)|\[voice:[^\]]*:base64\]/);
  assert.match(voice, /toGatewayAttachments\(\[createPreparedAttachment\(\{/);
  const files = source('src/services/chat/voiceFileRuntime.ts');
  assert.match(files, /await mkdir\(directory, \{ recursive: true \}\)/);
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
