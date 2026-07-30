import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StructuredPlanSettingsPanel } from './StructuredPlanSettingsPanel';

const noOp = () => undefined;

test('disconnected structured plan settings are disabled without pretending to load', () => {
  const html = renderToStaticMarkup(
    <StructuredPlanSettingsPanel
      mode="automatic"
      loading={false}
      saving={false}
      disabled
      error={null}
      onChange={noOp}
      onRetry={noOp}
    />,
  );

  assert.match(html, /role="radiogroup"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-loading-indicator=/);
});

test('structured plan settings expose real load progress only while reading config', () => {
  const html = renderToStaticMarkup(
    <StructuredPlanSettingsPanel
      mode="automatic"
      loading
      saving={false}
      error={null}
      onChange={noOp}
      onRetry={noOp}
    />,
  );

  assert.match(html, /data-loading-indicator="spinner"/);
});
