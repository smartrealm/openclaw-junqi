import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGatewaySessionContextBudgetNotice,
  parseGatewaySessionContextBudgetStatus,
} from '@/processing/sessionContextBudgetStatus';

const valid = {
  schemaVersion: 1,
  source: 'pre-prompt-estimate',
  updatedAt: 1,
  provider: 'openai',
  model: 'gpt-5',
  route: 'compact_only',
  shouldCompact: true,
  estimatedPromptTokens: 1,
  contextTokenBudget: 2,
  promptBudgetBeforeReserve: 2,
  reserveTokens: 1,
  effectiveReserveTokens: 1,
  remainingPromptBudgetTokens: 0,
  overflowTokens: 1,
  toolResultReducibleChars: 0,
  messageCount: 1,
  unwindowedMessageCount: 0,
};

test('只投影完整的 Gateway 上下文预算状态', () => {
  assert.deepEqual(parseGatewaySessionContextBudgetStatus(valid), {
    route: 'compact_only', shouldCompact: true,
  });
  assert.equal(parseGatewaySessionContextBudgetStatus({ ...valid, route: 'unknown' }), null);
  assert.equal(parseGatewaySessionContextBudgetStatus({ ...valid, shouldCompact: 'true' }), null);
  assert.equal(parseGatewaySessionContextBudgetStatus({ ...valid, contextTokenBudget: -1 }), null);
  assert.equal(parseGatewaySessionContextBudgetStatus({ ...valid, source: 'local' }), null);
});

test('只对 Gateway 自洽的预算路线生成界面提示', () => {
  assert.equal(getGatewaySessionContextBudgetNotice({ route: 'compact_only', shouldCompact: true }), 'compact');
  assert.equal(getGatewaySessionContextBudgetNotice({ route: 'truncate_tool_results_only', shouldCompact: false }), 'trim-tools');
  assert.equal(getGatewaySessionContextBudgetNotice({ route: 'compact_then_truncate', shouldCompact: true }), 'compact-and-trim-tools');
  assert.equal(getGatewaySessionContextBudgetNotice({ route: 'fits', shouldCompact: false }), null);
  assert.equal(getGatewaySessionContextBudgetNotice({ route: 'compact_only', shouldCompact: false }), null);
});
