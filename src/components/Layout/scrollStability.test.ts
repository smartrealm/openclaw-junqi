import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WORKSPACE_PAGE_FRAME_CLASS_NAME } from '../shared/workspacePageLayout';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('route scrolling resets before paint without reserving a wide gutter', async () => {
  const source = await read('./AppLayout.tsx');

  assert.match(source, /useLayoutEffect\(\(\) =>/);
  assert.match(source, /routeScrollRef\.current\.scrollTop = 0/);
  assert.doesNotMatch(source, /scrollbarGutter/);
  assert.match(source, /route-scrollbar/);
  assert.match(source, /data-route-scroll/);
});

test('route scrollbar remains visually slim', async () => {
  const css = await read('../../styles/index.css');

  assert.match(css, /\.route-scrollbar::-webkit-scrollbar\s*\{\s*width:\s*4px/);
});

test('page transitions do not translate the route scrollbar', async () => {
  const source = await read('../shared/PageTransition.tsx');

  assert.match(source, /animate-fade-in/);
  assert.doesNotMatch(source, /animate-slide-up/);
});

test('primary scrolling page contract delegates vertical scrolling to AppLayout', () => {
  assert.doesNotMatch(WORKSPACE_PAGE_FRAME_CLASS_NAME, /overflow-y-auto/);
  assert.equal(WORKSPACE_PAGE_FRAME_CLASS_NAME.split(/\s+/).includes('h-full'), false);
  assert.match(WORKSPACE_PAGE_FRAME_CLASS_NAME, /min-h-full/);
});
