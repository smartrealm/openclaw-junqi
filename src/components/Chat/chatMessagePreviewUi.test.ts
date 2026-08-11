import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actionsSource = readFileSync(new URL('./MessageBubbleActions.tsx', import.meta.url), 'utf8');
const bubbleSource = readFileSync(new URL('./MessageBubble.tsx', import.meta.url), 'utf8');
const iconButtonSource = readFileSync(new URL('./ChatIconButton.tsx', import.meta.url), 'utf8');
const inlineEditorSource = readFileSync(new URL('./InlineUserMessageEditor.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('./ChatMessagePreviewPanel.tsx', import.meta.url), 'utf8');
const markdownRendererSource = readFileSync(new URL('./ChatMarkdownRenderer.tsx', import.meta.url), 'utf8');
const sidePanelSource = readFileSync(new URL('./ChatSidePanel.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('./useChatSidePanel.ts', import.meta.url), 'utf8');
const tracePanelSource = readFileSync(new URL('./ChatResponseTracePanel.tsx', import.meta.url), 'utf8');
const traceNodeCardSource = readFileSync(new URL('./ChatResponseTraceNodeCard.tsx', import.meta.url), 'utf8');
const traceSourcePanelSource = readFileSync(new URL('./ChatTraceSourceMessagePanel.tsx', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../../pages/ChatView.tsx', import.meta.url), 'utf8');
const quickChatSource = readFileSync(new URL('../../pages/QuickChatPage.tsx', import.meta.url), 'utf8');

test('message preview uses the official panel-open action without glow effects', () => {
  assert.match(actionsSource, /PanelRightOpen/);
  assert.doesNotMatch(actionsSource, /\bEye\b/);
  assert.doesNotMatch(actionsSource, /opacity-0/);
  assert.doesNotMatch(actionsSource, /shadow|backdrop-blur/);
  assert.doesNotMatch(panelSource, /text-shadow|drop-shadow/);
  assert.match(bubbleSource, /data-message-bubble-actions/);
  assert.doesNotMatch(bubbleSource, /absolute end-2 top-2 z-10[\s\S]*data-message-bubble-actions/);
  assert.match(bubbleSource, /const hasBubbleActions = !isUser && Boolean\(messageActions\);/);
  assert.match(bubbleSource, /const footerActions = isUser \? messageActions : null;/);
  assert.doesNotMatch(bubbleSource, /<AssistantResponseFooter[\s\S]*?\{messageActions\}/);
});

test('message icon actions use the shared localized tooltip button', () => {
  assert.match(iconButtonSource, /<Tooltip>/);
  assert.match(iconButtonSource, /<TooltipContent side="top">\{label\}<\/TooltipContent>/);
  assert.match(iconButtonSource, /aria-label=\{label\}/);
  assert.match(actionsSource, /<ChatIconButton/);
  assert.match(bubbleSource, /<ChatIconButton type="button" onClick=\{onClick\}/);
  assert.match(inlineEditorSource, /<ChatIconButton/);
});

test('main and quick chat reuse the shared message preview panel', () => {
  assert.match(chatSource, /<ChatMessagePreviewPanel/);
  assert.match(quickChatSource, /<ChatMessagePreviewPanel/);
  assert.match(chatSource, /useChatSidePanel\(activeSessionKey\)/);
  assert.match(quickChatSource, /useChatSidePanel\(sessionKey\)/);
  assert.match(hookSource, /useEffect/);
  assert.match(panelSource, /<ChatSidePanel/);
  assert.match(panelSource, /<ChatMarkdownRenderer/);
  assert.doesNotMatch(panelSource, /ReactMarkdown/);
  assert.match(markdownRendererSource, /@tauri-apps\/plugin-shell/);
  assert.match(markdownRendererSource, /urlTransform=\{desktopUrlTransform\}/);
  assert.match(markdownRendererSource, /ChatVideo/);
  assert.match(markdownRendererSource, /CodeBlock/);
  assert.match(tracePanelSource, /<ChatSidePanel/);
  assert.match(sidePanelSource, /aria-labelledby/);
  assert.match(quickChatSource, /\boverlay\b/);
});

test('Quick Chat keeps the compact desktop shell within Aegis surfaces and reduces nonessential motion', () => {
  assert.match(quickChatSource, /bg-aegis-bg text-aegis-text/);
  assert.match(quickChatSource, /bg-aegis-surface/);
  assert.doesNotMatch(quickChatSource, /bg-black\//);
  assert.doesNotMatch(quickChatSource, /bg-white\//);
  assert.match(quickChatSource, /motion-reduce:animate-none/);
  assert.match(quickChatSource, /focus-visible:ring-2 focus-visible:ring-aegis-primary/);
});

test('main chat keeps connection feedback and lazy fallbacks visually stationary', () => {
  assert.doesNotMatch(chatSource, /animate-pulse-soft/);
  assert.doesNotMatch(chatSource, /animate-pulse/);
  assert.match(chatSource, /bg-aegis-warning rounded-full/);
  assert.match(chatSource, /h-11 rounded-xl border border-aegis-border bg-aegis-surface/);
});

test('chat side panels use the shared compact scrollbar', () => {
  assert.match(chatSource, /chat-scrollbar/);
  assert.match(panelSource, /chat-scrollbar/);
  assert.match(tracePanelSource, /chat-scrollbar/);
  assert.match(stylesSource, /\.chat-scrollbar::\-webkit-scrollbar \{ width: 4px; height: 4px; \}/);
});

test('message preview labels resolve from the chat namespace in every shipped language', () => {
  for (const language of ['en', 'zh', 'zh-TW']) {
    const locale = JSON.parse(readFileSync(
      new URL(`../../locales/${language}.json`, import.meta.url),
      'utf8',
    )) as { chat?: Record<string, unknown>; common?: Record<string, unknown> };

    assert.equal(typeof locale.chat?.messagePreviewTitle, 'string', `${language} is missing chat.messagePreviewTitle`);
    assert.equal(typeof locale.chat?.closeMessagePreview, 'string', `${language} is missing chat.closeMessagePreview`);
    assert.equal(locale.common?.messagePreviewTitle, undefined, `${language} retains the preview title in common`);
    assert.equal(locale.common?.closeMessagePreview, undefined, `${language} retains the preview close label in common`);
  }

  assert.match(panelSource, /t\('chat\.messagePreviewTitle'\)/);
  assert.match(panelSource, /t\('chat\.closeMessagePreview'\)/);
});

test('main and quick chat expose the same response trace entry and panel', () => {
  assert.match(chatSource, /onOpenTrace=/);
  assert.match(quickChatSource, /onOpenTrace=/);
  assert.match(chatSource, /<ChatResponseTracePanel/);
  assert.match(quickChatSource, /<ChatResponseTracePanel/);
  assert.match(tracePanelSource, /formalReviewId/);
  assert.match(tracePanelSource, /reviewFormalRelation/);
  assert.doesNotMatch(tracePanelSource, /onOpenCollaborationHistory/);
  assert.match(tracePanelSource, /reviewTranscriptOnly/);
  assert.match(tracePanelSource, /onOpenSourceMessage/);
  assert.match(tracePanelSource, /onLoadAuditEvents/);
  assert.match(tracePanelSource, /metadataOnly/);
  assert.match(traceNodeCardSource, /compactionDescription/);
  assert.match(chatSource, /openTraceSourceMessage/);
  assert.match(quickChatSource, /openTraceSourceMessage/);
  assert.match(chatSource, /listAuditEvents/);
  assert.match(quickChatSource, /listAuditEvents/);
  assert.match(traceNodeCardSource, /technicalDetails/);
  assert.match(traceNodeCardSource, /viewSourceRecord/);
  assert.match(traceSourcePanelSource, /sourceRecordUnavailableDescription/);
  assert.doesNotMatch(tracePanelSource, /font-mono text-aegis-text-muted>\{trace\.sessionKey\}/);
});

test('audit ledger labels exist in every shipped language', () => {
  for (const language of ['en', 'zh', 'zh-TW']) {
    const locale = JSON.parse(readFileSync(
      new URL(`../../locales/${language}.json`, import.meta.url),
      'utf8',
    )) as { chat?: { trace?: { audit?: Record<string, unknown> } } };
    assert.equal(typeof locale.chat?.trace?.audit?.title, 'string', `${language} is missing chat.trace.audit.title`);
    assert.equal(typeof locale.chat?.trace?.audit?.metadataOnly, 'string', `${language} is missing chat.trace.audit.metadataOnly`);
  }
});
