import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawModelAuthStatusPanel } from './OpenClawModelAuthStatusPanel';

const noOp = () => undefined;

test('OpenClawModelAuthStatusPanel renders verified native authentication health without credential metadata', () => {
  const html = renderToStaticMarkup(
    <OpenClawModelAuthStatusPanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      status={{
        providers: [{
          provider: 'openai',
          displayName: 'OpenAI',
          status: 'expiring',
          expiry: { label: '10m' },
          profiles: [{ type: 'oauth', status: 'expiring', expiry: { label: '10m' } }],
        }],
      }}
    />,
  );

  assert.match(html, /OpenAI/);
  assert.match(html, /Expiring/);
  assert.match(html, /10m/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|operator@example\.test|openai:default/);
});

test('OpenClawModelAuthStatusPanel represents an unavailable Gateway status without a false healthy state', () => {
  const html = renderToStaticMarkup(
    <OpenClawModelAuthStatusPanel
      loading={false}
      failure="unavailable"
      onRefresh={noOp}
      status={null}
    />,
  );

  assert.match(html, /does not provide OpenClaw model authentication status/);
  assert.doesNotMatch(html, /Authentication ready/);
});
