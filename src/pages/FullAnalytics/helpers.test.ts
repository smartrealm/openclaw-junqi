import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentIconKind } from './agentIconKind';

test('智能体图标辅助函数只返回可映射类型，不返回 JSX 源码文本', () => {
  for (const agentId of ['main', 'workspace-mozhi', 'novelsmith', 'legal', 'jarvis']) {
    const kind = getAgentIconKind(agentId);
    assert.equal(kind.includes('<'), false);
    assert.equal(kind.includes('='), false);
  }
});
