import assert from 'node:assert/strict';
import test from 'node:test';
import { installationConsoleMode } from './SetupFlowPanels';

test('Gateway 就绪后使用紧凑完成摘要，不再保留安装活动双栏', () => {
  assert.equal(installationConsoleMode({ kind: 'gateway-ready' }), 'completion');
  assert.equal(installationConsoleMode({ kind: 'installation' }), 'activity');
  assert.equal(installationConsoleMode({ kind: 'model-checking' }), 'activity');
  assert.equal(
    installationConsoleMode({ kind: 'model-check-failed', message: 'failed' }),
    'activity',
  );
});
