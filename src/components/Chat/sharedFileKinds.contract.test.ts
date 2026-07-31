import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const messageBubbleSource = readFileSync(new URL('./MessageBubble.tsx', import.meta.url), 'utf8');
const markdownRendererSource = readFileSync(new URL('./ChatMarkdownRenderer.tsx', import.meta.url), 'utf8');

test('chat file cards use shared workspace file kind authority', () => {
  assert.match(messageBubbleSource, /<ChatMarkdownRenderer markdown=\{content\} \/>/);
  assert.match(markdownRendererSource, /workspaceFileKind\(name\)/);
  assert.match(markdownRendererSource, /fileExtension\(name\)/);
  assert.doesNotMatch(markdownRendererSource, /imageExts|audioExts|videoExts|archiveExts|codeExts|docExts|sheetExts/);
});
