import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawHooksStatusPanel } from './OpenClawHooksStatusPanel';

const noOp = () => undefined;

test('OpenClawHooksStatusPanel renders the safe hook projection without paths or requirement details', () => {
  const html = renderToStaticMarkup(
    <OpenClawHooksStatusPanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      snapshot={{
        hooks: [{
          name: 'session-memory',
          description: 'Retain session context',
          pluginId: 'memory-plugin',
          events: ['command:new'],
          unknownEvents: ['command:typo'],
          enabledByConfig: true,
          requirementsSatisfied: true,
          loadable: true,
          managedByPlugin: true,
        }],
      }}
    />,
  );

  assert.match(html, /session-memory/);
  assert.match(html, /command:new/);
  assert.match(html, /Loadable/);
  assert.doesNotMatch(html, /workspaceDir|handlerPath|SECRET_NAME|hooks\.enabled/);
});

test('OpenClawHooksStatusPanel makes reading explicit and explains unavailability', () => {
  const ready = renderToStaticMarkup(
    <OpenClawHooksStatusPanel loading={false} failure={null} onRefresh={noOp} snapshot={null} />,
  );
  const unavailable = renderToStaticMarkup(
    <OpenClawHooksStatusPanel loading={false} failure="unavailable" onRefresh={noOp} snapshot={null} />,
  );

  assert.match(ready, /Read Gateway hook status/);
  assert.match(ready, /<button/);
  assert.match(unavailable, /not available/);
});
