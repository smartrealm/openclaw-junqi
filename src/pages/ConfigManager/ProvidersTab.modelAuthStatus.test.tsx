import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderCardStatus, ProviderRuntimeAuthDetails } from './ProvidersTab';

const noOp = () => undefined;

test('ProviderCardStatus places Gateway authentication health in the provider summary', () => {
  const html = renderToStaticMarkup(
    <ProviderCardStatus
      statusTone="info"
      statusLabel="Credential reference configured"
      runtimeAuth={{
        displayName: 'OpenAI',
        status: 'expiring',
        expiryLabel: '10m',
        logoutSupported: true,
        loggingOut: false,
        probing: false,
        busy: false,
        onProbe: noOp,
        onLogout: noOp,
      }}
    />,
  );

  assert.match(html, /Expiring/);
  assert.match(html, /Expires in 10m/);
  assert.match(html, /Verify now/);
  assert.doesNotMatch(html, /OpenClaw authentication status/);
  assert.doesNotMatch(html, /Log out/);
});

test('ProviderRuntimeAuthDetails keeps live probe evidence and logout in the secondary area', () => {
  const html = renderToStaticMarkup(
    <ProviderRuntimeAuthDetails
      runtimeAuth={{
        displayName: 'OpenAI',
        status: 'ok',
        logoutSupported: true,
        loggingOut: false,
        probing: false,
        busy: false,
        probeResult: { provider: 'openai', status: 'ok', latencyMs: 320, targetCount: 1 },
        onProbe: noOp,
        onLogout: noOp,
      }}
    />,
  );

  assert.match(html, /Live verification passed/);
  assert.match(html, /320 ms/);
  assert.match(html, /Log out/);
  assert.doesNotMatch(html, /profileId|account@example\.test|OPENAI_API_KEY/);
});

test('ProviderCardStatus preserves the local configuration label without a Gateway projection', () => {
  const html = renderToStaticMarkup(
    <ProviderCardStatus
      statusTone="ok"
      statusLabel="Runtime credential configured"
    />,
  );

  assert.match(html, /Runtime credential configured/);
  assert.doesNotMatch(html, /Verify now|Log out/);
});
