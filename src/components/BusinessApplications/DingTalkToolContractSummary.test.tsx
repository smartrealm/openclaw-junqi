import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DingTalkToolContractSummary } from './DingTalkToolContractSummary';
import type { DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

function tool(deniedBySession = false): DingTalkEffectiveTool {
  return {
    domain: 'approval',
    effect: 'read',
    entry: {
      id: 'junqi_dingtalk_approval_pending',
      label: '待审批',
      description: '读取待审批',
      rawDescription: '读取待审批',
      source: 'plugin',
      pluginId: 'junqi-dingtalk',
      risk: 'low',
      tags: ['dingtalk', 'approval', 'read'],
      ...(deniedBySession ? { deniedBySession: true } : {}),
    },
  };
}

test('正常工具摘要不把目录可见性展示为权限结果', () => {
  const html = renderToStaticMarkup(createElement(DingTalkToolContractSummary, { tool: tool() }));

  assert.match(html, /Effect/);
  assert.match(html, /Risk/);
  assert.doesNotMatch(html, /账号权限/);
  assert.doesNotMatch(html, /调用时核验/);
  assert.doesNotMatch(html, /已暴露/);
  assert.doesNotMatch(html, /Session/);
});

test('只有明确拒绝时才在工具摘要显示 Session 拒绝', () => {
  const html = renderToStaticMarkup(createElement(DingTalkToolContractSummary, { tool: tool(true) }));

  assert.match(html, /Session/);
  assert.match(html, /Denied by policy/);
});
