import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupShell } from './SetupFlowPanels';

test('setup shell keeps navigation actions reachable below overflowing step content', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={2}
      title="Data location"
      subtitle="Choose storage"
      logs={[]}
      previousAction={{ onClick: () => undefined }}
      nextAction={{ label: 'Continue', onClick: () => undefined }}
    >
      <div>Storage choices</div>
    </SetupShell>,
  );

  assert.match(html, /<main[^>]*overflow-auto/);
  assert.match(html, /class="flex w-full justify-center"/);
  assert.match(html, /<section[^>]*class="w-full max-w-3xl"/);
  assert.doesNotMatch(html, /<section[^>]*class="[^"]*my-auto/);
  assert.match(html, /<footer[^>]*shrink-0/);
  assert.match(html, />Continue</);
});
