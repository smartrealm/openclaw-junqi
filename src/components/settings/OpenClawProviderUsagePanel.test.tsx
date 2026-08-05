import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawProviderUsagePanel } from './OpenClawProviderUsagePanel';

const noOp = () => undefined;

test('OpenClawProviderUsagePanel renders native quota windows without account or billing metadata', () => {
  const html = renderToStaticMarkup(
    <OpenClawProviderUsagePanel
      loading={false}
      failure={null}
      onRefresh={noOp}
      usage={{
        providers: [{
          provider: 'openai',
          displayName: 'OpenAI',
          windows: [{ label: '5h', usedPercent: 20.5, resetAt: 1_700_000_600_000 }],
        }],
      }}
    />,
  );

  assert.match(html, /OpenAI/);
  assert.match(html, /5h/);
  assert.match(html, /20.5% used/);
  assert.doesNotMatch(html, /operator@example\.test|OPENAI_API_KEY|private|balance/);
});

test('OpenClawProviderUsagePanel represents an unavailable Gateway response without a quota claim', () => {
  const html = renderToStaticMarkup(
    <OpenClawProviderUsagePanel
      loading={false}
      failure="unavailable"
      onRefresh={noOp}
      usage={null}
    />,
  );

  assert.match(html, /does not provide OpenClaw provider quota status/);
  assert.doesNotMatch(html, /0% used/);
});
