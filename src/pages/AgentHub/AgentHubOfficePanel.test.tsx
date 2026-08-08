import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentHubOfficePanel } from './AgentHubOfficePanel';
test('智能体中心办公室在 Gateway 未连接时不展示未经核验的运行数据', () => {
  const html = renderToStaticMarkup(
    <AgentHubOfficePanel connected={false} onOpenRun={() => undefined} onShowAgentList={() => undefined} />,
  );

  assert.match(html, /Collaboration office is unavailable/);
  assert.doesNotMatch(html, /data-agent-hub-office/);
  assert.doesNotMatch(html, /data-office-agent-id=/);
});
