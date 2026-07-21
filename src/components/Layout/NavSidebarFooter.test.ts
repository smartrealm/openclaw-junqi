import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./NavSidebarFooter.tsx', import.meta.url), 'utf8');

test('sidebar usage entry follows the JunQi platform capability', () => {
  assert.match(source, /ENABLE_USAGE_INSIGHTS && <UsagePopover \/>/);
  assert.equal((source.match(/ENABLE_USAGE_INSIGHTS && <UsagePopover \/>/g) ?? []).length, 2);
});
