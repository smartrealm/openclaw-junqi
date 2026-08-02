import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupShell } from './SetupFlowPanels';

test('setup footer renders Back separately from a loading primary action', () => {
  const markup = renderToStaticMarkup(
    <SetupShell
      active={2}
      title="Storage"
      subtitle="Configure the workspace"
      logs={[]}
      previousAction={{ label: 'Back' }}
      secondaryAction={{ label: 'Choose location' }}
      nextAction={{ label: 'Confirming storage location', loading: true }}
    >
      <div>Storage setup</div>
    </SetupShell>,
  );

  assert.match(markup, /data-setup-footer-layout="responsive"/);
  assert.match(markup, /data-setup-footer-previous="true"/);
  assert.match(markup, /data-setup-footer-actions="true"/);
  assert.match(markup, /data-setup-footer-primary="true"/);
  assert.match(markup, /Confirming storage location/);
});
