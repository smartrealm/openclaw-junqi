import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerSessionKeys } from './OpenClawSessionViewerPresenceRuntime';

test('仅在桌面主窗口已就绪、已连接且获得焦点时声明活动会话', () => {
  assert.deepEqual(viewerSessionKeys({
    setupComplete: true,
    connected: true,
    focused: true,
    activeSessionKey: ' agent:main:desk ',
  }), ['agent:main:desk']);

  for (const input of [
    { setupComplete: false, connected: true, focused: true, activeSessionKey: 'agent:main:desk' },
    { setupComplete: true, connected: false, focused: true, activeSessionKey: 'agent:main:desk' },
    { setupComplete: true, connected: true, focused: false, activeSessionKey: 'agent:main:desk' },
    { setupComplete: true, connected: true, focused: true, activeSessionKey: '   ' },
  ]) {
    assert.deepEqual(viewerSessionKeys(input), []);
  }
});
