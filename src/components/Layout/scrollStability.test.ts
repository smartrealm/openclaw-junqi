import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('primary scrolling pages delegate vertical scrolling to AppLayout', async () => {
  const sources = await Promise.all([
    read('../../pages/Dashboard/index.tsx'),
    read('../../pages/OpenClawCommands/index.tsx'),
  ]);

  for (const source of sources) {
    const pageTransition = source.match(/<(?:Page|Scene)Transition(?:\s|\n)+className="([^"]+)"/)?.[1] ?? '';
    assert.doesNotMatch(pageTransition, /overflow-y-auto/);
    assert.equal(pageTransition.split(/\s+/).includes('h-full'), false);
    assert.match(pageTransition, /min-h-full/);
  }
});
