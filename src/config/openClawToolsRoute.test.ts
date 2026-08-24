import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENCLAW_TOOLS_ROUTE } from './openClawToolsRoute';

test('工具入口指向 OpenClaw 原生工具配置页', () => {
  const target = new URL(OPENCLAW_TOOLS_ROUTE, 'https://junqi.invalid');

  assert.equal(target.pathname, '/config');
  assert.equal(target.searchParams.get('tab'), 'tools');
});
