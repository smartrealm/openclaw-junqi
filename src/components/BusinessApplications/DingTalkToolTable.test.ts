import assert from 'node:assert/strict';
import test from 'node:test';
import { groupDingTalkToolsForTable } from './DingTalkToolTable';
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
