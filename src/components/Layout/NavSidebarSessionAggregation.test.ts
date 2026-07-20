import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./NavSidebar.tsx', import.meta.url), 'utf8');

test('background activity is fixed below the independently scrolling session list', () => {
  const scrollRegion = source.indexOf('className="flex-1 overflow-y-auto min-h-0 px-1"');
  const backgroundRegion = source.indexOf('{backgroundTotal > 0 && (');
  const fixedBackground = source.indexOf('mx-3 shrink-0 border-t', backgroundRegion);

  assert.ok(scrollRegion >= 0);
  assert.ok(backgroundRegion > scrollRegion);
  assert.ok(fixedBackground > backgroundRegion);
  assert.match(source.slice(scrollRegion, backgroundRegion), /\n\s*<\/div>\s*$/);
});
