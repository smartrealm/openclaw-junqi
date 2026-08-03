import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawTtsStatusPanel } from './OpenClawTtsStatusPanel';

const noOp = () => undefined;

test('OpenClawTtsStatusPanel renders a verified TTS projection without Gateway-local fields', () => {
  const html = renderToStaticMarkup(
    <OpenClawTtsStatusPanel
      connected
      loading={false}
      failure={null}
      onRefresh={noOp}
      status={{
        enabled: true,
        auto: 'always',
        provider: 'openai',
        persona: 'brief',
        providerStates: [{ id: 'openai', label: 'OpenAI', configured: true }],
        personas: [{
          id: 'brief',
          label: 'Brief',
          description: 'A concise voice.',
          provider: 'openai',
        }],
      }}
    />,
  );

  assert.match(html, /openai/);
  assert.match(html, /Brief/);
  assert.match(html, /OpenAI/);
  assert.doesNotMatch(html, /prefsPath|fallbackProvider|gateway\/tts\.json/);
});

test('OpenClawTtsStatusPanel disables refresh without a Gateway connection', () => {
  const html = renderToStaticMarkup(
    <OpenClawTtsStatusPanel
      connected={false}
      loading={false}
      failure={null}
      onRefresh={noOp}
      status={null}
    />,
  );

  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-loading-indicator=/);
});
