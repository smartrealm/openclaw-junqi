import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawDiagnosticStabilityPanel } from './OpenClawDiagnosticStabilityPanel';

const noOp = () => undefined;

test('OpenClawDiagnosticStabilityPanel renders only the safe stability projection', () => {
  const html = renderToStaticMarkup(
    <OpenClawDiagnosticStabilityPanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      snapshot={{
        generatedAt: '2026-08-04T00:00:00.000Z',
        capacity: 1_000,
        count: 2,
        dropped: 0,
        events: [
          { seq: 1, ts: 1_754_265_600_000, type: 'message.queued' },
          { seq: 2, ts: 1_754_265_601_000, type: 'session.state' },
        ],
        byType: { 'message.queued': 1, 'session.state': 1 },
      }}
    />,
  );

  assert.match(html, /message\.queued/);
  assert.match(html, /session\.state/);
  assert.match(html, /2026-08-04T00:00:00\.000Z/);
  assert.doesNotMatch(html, /channel|provider|toolResult|transcript/);
});

test('OpenClawDiagnosticStabilityPanel makes reading an explicit command and explains unavailability', () => {
  const ready = renderToStaticMarkup(
    <OpenClawDiagnosticStabilityPanel loading={false} failure={null} onRefresh={noOp} snapshot={null} />,
  );
  const unavailable = renderToStaticMarkup(
    <OpenClawDiagnosticStabilityPanel loading={false} failure="unavailable" onRefresh={noOp} snapshot={null} />,
  );

  assert.match(ready, /Read Gateway stability diagnostics/);
  assert.match(ready, /<button/);
  assert.match(unavailable, /not available/);
});
