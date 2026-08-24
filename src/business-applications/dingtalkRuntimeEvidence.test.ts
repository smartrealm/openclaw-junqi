import assert from 'node:assert/strict';
import test from 'node:test';
import { presentDingTalkRuntimeEvidence } from './dingtalkRuntimeEvidence';

test('运行页摘要不携带内部 Session 标识与插件版本', () => {
  const presentation = presentDingTalkRuntimeEvidence({
    sessionLabel: 'agent:main:dashboard:private-session',
    agentId: 'main',
    effectiveToolCount: 32,
    pluginVersion: '0.1.0',
    bundledPluginVersion: '0.1.0',
  });

  assert.deepEqual(
    {
      sessionVerified: presentation.sessionVerified,
      agentId: presentation.agentId,
      effectiveToolCount: presentation.effectiveToolCount,
    },
    { sessionVerified: true, agentId: 'main', effectiveToolCount: 32 },
  );
  assert.deepEqual(presentation.diagnostics, {
    sessionLabel: 'agent:main:dashboard:private-session',
    pluginVersion: '0.1.0',
    bundledPluginVersion: '0.1.0',
  });
});
