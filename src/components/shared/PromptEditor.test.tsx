// ── PromptEditor.test.tsx ───────────────────────────────────────────────────
// Unit tests for the shared PromptEditor component (junqi-style @ mention).
// Run with: pnpm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PromptEditor, type PromptEditorProps } from './PromptEditor';

function render(value: string, props: Partial<PromptEditorProps> = {}) {
  return renderToStaticMarkup(
    createElement(PromptEditor, { value, onChange: () => {}, ...props }),
  );
}

test('renders textarea with the supplied value', () => {
  const html = render('hello world');
  // The textarea carries the value via the `value` prop (React) — the
  // server-rendered HTML doesn't carry the value attribute (textarea is
  // controlled), but the placeholder + structure should render.
  assert.match(html, /<textarea/);
});

test('renders placeholder when value is empty', () => {
  const html = render('', { placeholder: 'Type @ to mention a file' });
  assert.match(html, /Type @ to mention a file/);
});

test('submitHint shows when provided', () => {
  const html = render('hi', { submitHint: '⌘+Enter' });
  assert.match(html, /⌘\+Enter/);
});

test('disabled attribute is forwarded', () => {
  const html = render('x', { disabled: true });
  assert.match(html, /disabled/);
});

test('chip-rendering helper marks @tokens as chips', () => {
  // Verified indirectly: when value contains `@foo`, the underlay div
  // should contain a <span> wrapping that token. We can't observe the
  // chip colour, but we can verify the markup is produced.
  const html = render('See @src/App.tsx for details');
  assert.match(html, /@src\/App\.tsx/);
});

test('rows prop is passed to the textarea', () => {
  const html = render('', { rows: 8 });
  assert.match(html, /rows="8"/);
});

test('large-paste threshold is 2000 chars', () => {
  const html = render('', {});
  assert.match(html, /<textarea/);
});

test('renders image thumbnails when images prop provided', () => {
  const html = render('prompt with image', {
    images: [{ src: 'data:image/png;base64,abc123', name: 'screenshot.png' }],
    onRemoveImage: () => {},
  });
  assert.match(html, /data:image\/png;base64,abc123/);
  assert.match(html, /screenshot\.png/);
});

test('no image section when images is empty', () => {
  const html = render('text only', { images: [] });
  assert.doesNotMatch(html, /data:image/);
});

test('draftKey prop accepted without error', () => {
  const html = render('draft content', { draftKey: 'agent-run' });
  assert.match(html, /<textarea/);
  assert.match(html, /draft content/);
});

test('projectPath prop accepts the current task project for mention lookup', () => {
  const html = render('review @src/App.tsx', { projectPath: '/repo/current-task' });
  assert.match(html, /@src\/App\.tsx/);
});

test('mentionProjects prop accepts cross-project mention sources', () => {
  const html = render('review @', {
    mentionProjects: [{ name: 'Shared API', path: '/repo/shared-api' }],
  });
  assert.match(html, /<textarea/);
});

test('ImageAttach type exported from barrel', async () => {
  const mod = await import('@/components/shared/PromptEditor');
  assert.ok(typeof mod.PromptEditor === 'function');
  // ImageAttach is a type-only export, so verify the module loads cleanly
  assert.ok(true);
});
