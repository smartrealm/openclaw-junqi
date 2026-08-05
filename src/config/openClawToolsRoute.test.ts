import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENCLAW_TOOLS_ROUTE } from './openClawToolsRoute';

test('the legacy tools entry targets the OpenClaw-native configuration tab', () => {
  const target = new URL(OPENCLAW_TOOLS_ROUTE, 'https://junqi.invalid');

  assert.equal(target.pathname, '/config');
  assert.equal(target.searchParams.get('tab'), 'tools');
});
