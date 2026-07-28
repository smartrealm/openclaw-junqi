import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MessageBubble.tsx', import.meta.url), 'utf8');

test('chat file cards use shared workspace file kind authority', () => {
  assert.match(source, /workspaceFileKind\(name\)/);
  assert.match(source, /fileExtension\(name\)/);
  assert.doesNotMatch(source, /imageExts|audioExts|videoExts|archiveExts|codeExts|docExts|sheetExts/);
});
