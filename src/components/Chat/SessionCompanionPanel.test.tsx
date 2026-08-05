import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionCompanionPanel } from './SessionCompanionPanel';

test('session companion panel identifies the Gateway-only read-only boundary', () => {
  const html = renderToStaticMarkup(
    <SessionCompanionPanel sessionKey="agent:main:main" connected={false} onClose={() => undefined} />,
  );
  assert.match(html, /Session companion/);
  assert.match(html, /never enter chat history/);
  assert.match(html, /Question for the session companion/);
});
