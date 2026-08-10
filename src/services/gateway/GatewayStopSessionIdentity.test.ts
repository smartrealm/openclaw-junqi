import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawSessionTargetError } from './OpenClawSessionTarget';
import { gateway } from './index';

test('空 Stop 目标会在请求 Gateway 前失败', async () => {
  await assert.rejects(gateway.abortChat('  '), OpenClawSessionTargetError);
});
