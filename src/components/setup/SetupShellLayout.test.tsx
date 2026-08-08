import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupShell } from './SetupFlowPanels';

test('setup shell keeps navigation actions reachable below overflowing step content', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={2}
      activeComplete
      eyebrow="Step 3 · Runtime"
      title="Data location"
      subtitle="Choose storage"
      logs={[]}
      previousAction={{ onClick: () => undefined }}
      nextAction={{ label: 'Continue', onClick: () => undefined }}
    >
      <div>Storage choices</div>
    </SetupShell>,
  );

  assert.match(html, /<main[^>]*overflow-x-hidden/);
  assert.match(html, /<main[^>]*overflow-y-auto/);
  assert.match(html, /grid-cols-6/);
  assert.doesNotMatch(html, /overflow-x-auto/);
  assert.match(html, /data-setup-step-current-complete="true"/);
  assert.match(html, /Step 3 · Runtime/);
  assert.match(html, /class="flex w-full min-w-0 max-w-full justify-center overflow-x-clip"/);
  assert.match(html, /<section[^>]*class="w-full max-w-3xl"/);
  assert.doesNotMatch(html, /<section[^>]*class="[^"]*my-auto/);
  assert.match(html, /<footer[^>]*shrink-0/);
  assert.match(html, />Continue</);
});
