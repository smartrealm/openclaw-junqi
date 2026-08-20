import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DingTalkToolTable, groupDingTalkToolsForTable } from './DingTalkToolTable';
import type { DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

function tool(id: string, domain: DingTalkEffectiveTool['domain']): DingTalkEffectiveTool {
  return {
    domain,
    effect: 'read',
    entry: {
      id,
      label: id,
      description: id,
      rawDescription: id,
      source: 'plugin',
      pluginId: 'junqi-dingtalk',
      risk: 'low',
      tags: ['dingtalk', domain, 'read'],
    },
  };
}

test('工具表格仅按真实输入中的业务域分组', () => {
  const groups = groupDingTalkToolsForTable([
    tool('dingtalk.contact.me', 'contact'),
    tool('dingtalk.calendar.list', 'calendar'),
    tool('dingtalk.contact.search', 'contact'),
  ]);

  assert.deepEqual(groups.map((group) => [group.domain, group.tools.map((entry) => entry.entry.id)]), [
    ['contact', ['dingtalk.contact.me', 'dingtalk.contact.search']],
    ['calendar', ['dingtalk.calendar.list']],
  ]);
});

test('工具表格把账号权限与 Session 暴露状态分开且不冒充业务授权', () => {
  const html = renderToStaticMarkup(createElement(DingTalkToolTable, {
    tools: [tool('junqi_dingtalk_approval_pending', 'approval')],
    selectedId: null,
    loading: false,
    emptyMessage: '',
    onSelect: () => {},
  }));

  assert.match(html, /账号权限/);
  assert.match(html, /调用时核验/);
  assert.match(html, /已暴露/);
  assert.doesNotMatch(html, /会话可见/);
  assert.doesNotMatch(html, />有效</);
});

test('Profile 探针加载期间不显示账号无操作的终态空文案', () => {
  const html = renderToStaticMarkup(createElement(DingTalkToolTable, {
    tools: [],
    selectedId: null,
    loading: true,
    emptyMessage: '请先登录或选择状态为 active 的 DWS Profile。',
    onSelect: () => {},
  }));

  assert.match(html, /正在读取插件操作目录/);
  assert.match(html, /等待 OpenClaw 与当前 DWS Profile 的核验结果/);
  assert.doesNotMatch(html, /当前账号没有可展示的操作/);
  assert.doesNotMatch(html, /请先登录或选择状态为 active 的 DWS Profile/);
});
