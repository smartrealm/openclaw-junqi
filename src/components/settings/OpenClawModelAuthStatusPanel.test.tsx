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
      onLogoutProvider={noOp}
      onProbeProvider={noOp}
      status={{
        providers: [{
          provider: 'openai',
          displayName: 'OpenAI',
          status: 'expiring',
          expiry: { label: '10m' },
          profiles: [{ type: 'oauth', status: 'expiring', expiry: { label: '10m' }, logoutSupported: true }],
        }],
      }}
    />,
  );

  assert.match(html, /OpenAI/);
  assert.match(html, /Expiring/);
  assert.match(html, /10m/);
  assert.match(html, /Verify now/);
  assert.match(html, /Log out/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|operator@example\.test|openai:default/);
});

test('OpenClawModelAuthStatusPanel represents an unavailable Gateway status without a false healthy state', () => {
  const html = renderToStaticMarkup(
    <OpenClawModelAuthStatusPanel
      loading={false}
      failure="unavailable"
      onRefresh={noOp}
      onLogoutProvider={noOp}
      onProbeProvider={noOp}
      status={null}
    />,
  );

  assert.match(html, /does not provide OpenClaw model authentication status/);
  assert.doesNotMatch(html, /Authentication ready/);
});

test('OpenClawModelAuthStatusPanel hides logout when OpenClaw does not authorize it', () => {
  const html = renderToStaticMarkup(
    <OpenClawModelAuthStatusPanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      onLogoutProvider={noOp}
      onProbeProvider={noOp}
      status={{
        providers: [{
          provider: 'ollama',
          displayName: 'Ollama',
          status: 'static',
          profiles: [{ type: 'api_key', status: 'static', logoutSupported: false }],
        }],
      }}
    />,
  );

  assert.match(html, /Ollama/);
  assert.match(html, /Verify now/);
  assert.doesNotMatch(html, /Log out/);
});

test('OpenClawModelAuthStatusPanel renders only user-triggered official probe summaries', () => {
  const html = renderToStaticMarkup(
    <OpenClawModelAuthStatusPanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      onLogoutProvider={noOp}
      onProbeProvider={noOp}
      probeResults={{ openai: { status: 'ok', latencyMs: 320, targetCount: 1 } }}
      status={{
        providers: [{
          provider: 'openai',
          displayName: 'OpenAI',
          status: 'ok',
          profiles: [{ type: 'oauth', status: 'ok', logoutSupported: true }],
        }],
      }}
    />,
  );

  assert.match(html, /Live verification passed/);
  assert.match(html, /320 ms/);
  assert.doesNotMatch(html, /profileId|account@example\.test/);
});
