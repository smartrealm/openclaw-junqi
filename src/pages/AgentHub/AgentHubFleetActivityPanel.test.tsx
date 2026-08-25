import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentHubFleetActivityPanel } from './AgentHubFleetActivityPanel';

function text(_key: string, fallback: string, values?: Record<string, unknown>): string {
  if (!values) return fallback;
  return Object.entries(values).reduce(
    (acc, [name, value]) => acc.replaceAll(`{{${name}}}`, String(value)),
    fallback,
  );
}

test('忙碌与空闲 Agent 分别投影到两个工位房间，只依据会话权威字段', () => {
  const html = renderToStaticMarkup(createElement(AgentHubFleetActivityPanel, {
    agents: [
      { id: 'writer', name: 'Writer' },
      { id: 'idle-agent', name: 'Idle Agent' },
    ],
    sessions: [
      { agentId: 'writer', running: true, updatedAt: 1000 },
      { agentId: 'idle-agent', running: false },
    ],
    text,
  }));

  assert.match(html, /data-agent-hub-fleet-zone="busy"/);
  assert.match(html, /data-agent-hub-fleet-zone="idle"/);
  assert.match(html, /data-agent-hub-fleet-agent-id="writer"[^>]*data-agent-hub-fleet-state="busy"/);
  assert.match(html, /data-agent-hub-fleet-agent-id="idle-agent"[^>]*data-agent-hub-fleet-state="idle"/);
  assert.match(html, /Writer/);
  assert.match(html, /Idle Agent/);
});

test('没有可配置 Agent 时不渲染任何内容', () => {
  const html = renderToStaticMarkup(createElement(AgentHubFleetActivityPanel, {
    agents: [],
    sessions: [],
    text,
  }));

  assert.equal(html, '');
});
