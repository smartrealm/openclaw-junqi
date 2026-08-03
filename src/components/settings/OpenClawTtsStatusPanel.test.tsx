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
      mutation={null}
      mutationFailure={null}
      onRefresh={noOp}
      onSetEnabled={noOp}
      onSetProvider={noOp}
      onSetPersona={noOp}
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
  assert.match(html, /role="switch"/);
  assert.match(html, /<select/);
  assert.doesNotMatch(html, /prefsPath|fallbackProvider|gateway\/tts\.json/);
});

test('OpenClawTtsStatusPanel disables refresh without a Gateway connection', () => {
  const html = renderToStaticMarkup(
    <OpenClawTtsStatusPanel
      connected={false}
      loading={false}
      failure={null}
      mutation={null}
      mutationFailure={null}
      onRefresh={noOp}
      onSetEnabled={noOp}
      onSetProvider={noOp}
      onSetPersona={noOp}
      status={null}
    />,
  );

  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-loading-indicator=/);
});

test('OpenClawTtsStatusPanel locks native controls while a Gateway preference mutation is pending', () => {
  const html = renderToStaticMarkup(
    <OpenClawTtsStatusPanel
      connected
      loading={false}
      failure={null}
      mutation="provider"
      mutationFailure={null}
      onRefresh={noOp}
      onSetEnabled={noOp}
      onSetProvider={noOp}
      onSetPersona={noOp}
      status={{
        enabled: true,
        auto: 'always',
        provider: 'openai',
        persona: null,
        providerStates: [{ id: 'openai', label: 'OpenAI', configured: true }],
        personas: [],
      }}
    />,
  );

  assert.match(html, /disabled=""/);
  assert.match(html, /Saving Gateway setting/);
});
