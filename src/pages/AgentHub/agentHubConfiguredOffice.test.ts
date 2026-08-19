import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentHubConfiguredOffice } from './AgentHubConfiguredOffice';
import { buildConfiguredOfficeRoster } from './agentHubConfiguredOfficeRoster';

test('配置员工席位只投影 Gateway 返回的配置字段', () => {
  const roster = buildConfiguredOfficeRoster([
    { id: 'worker', runtimeType: 'native', allowed: true, coordinator: false },
    { id: 'main', name: '主智能体', description: '协调任务', runtimeType: 'native', allowed: true, coordinator: true },
  ]);

  assert.deepEqual(roster, [
    {
      id: 'main',
      displayName: '主智能体',
      description: '协调任务',
      coordinator: true,
      allowed: true,
      runtimeType: 'native',
    },
    {
      id: 'worker',
      displayName: 'worker',
      description: null,
      coordinator: false,
      allowed: true,
      runtimeType: 'native',
    },
  ]);
});

test('新建 Agent 在未运行协作时仍展示为配置工位，不伪造执行状态', () => {
  const html = renderToStaticMarkup(createElement(AgentHubConfiguredOffice, {
    agents: [{
      id: 'new-worker',
      name: 'New Worker',
      runtimeType: 'native',
      allowed: true,
      coordinator: false,
    }],
  }));

  assert.match(html, /data-agent-hub-configured-agent-id="new-worker"/);
  assert.match(html, /data-agent-hub-configured-seat-state="authorized"/);
  assert.match(html, /New Worker/);
  assert.match(html, /Configured desks/);
  assert.match(html, /shown separately/);
});

test('配置 Agent 与协作许可成员分区展示，不把未许可成员放入协作席位', () => {
  const html = renderToStaticMarkup(createElement(AgentHubConfiguredOffice, {
    agents: [
      { id: 'main', name: 'Coordinator', runtimeType: 'native', allowed: true, coordinator: true },
      { id: 'authorized', name: 'Authorized', runtimeType: 'native', allowed: true, coordinator: false },
      { id: 'configured-only', name: 'Configured only', runtimeType: 'acp', allowed: false, coordinator: false },
    ],
  }));

  assert.match(html, /data-agent-hub-configured-office-layout="spatial"/);
  assert.match(html, /data-agent-hub-configured-agent-id="authorized"[^>]*data-agent-hub-configured-seat-state="authorized"/);
  assert.match(html, /data-agent-hub-configured-agent-id="configured-only"[^>]*data-agent-hub-configured-seat-state="configured-only"/);
  assert.match(html, /Configured, not in collaboration permission/);
  assert.doesNotMatch(html, /Not allowed to participate/);
});
